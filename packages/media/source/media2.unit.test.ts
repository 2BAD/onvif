import { Device, SoapFaultError } from '@2bad/onvif'
import { decode, type Operation, parseEnvelope, type XmlObject } from '@2bad/onvif/soap'
import { afterEach, describe, expect, it } from 'vitest'
import { corpus, fixture } from '../../../tools/fixtures/corpus.ts'
import {
  type ActionOverride,
  type MockCamera,
  type MockCameraOptions,
  startMockCamera
} from '../../../tools/mock-camera/server.ts'
import { Media2, media } from '#index.ts'

const cam = (name: string): string => fixture(`live/dvc/dcn-bm2220lpr/${name}.xml`).xml
const hik = (name: string): string => fixture(`live/ezviz/ds-2de2c400ig-w-w/${name}.xml`).xml
const dahua = (name: string): string => fixture(`live/dahua/dhi-itc413-pw4d-z1/${name}.xml`).xml
const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const connect = async (options?: MockCameraOptions) => {
  const mock = await startMockCamera(options)
  cleanups.push(() => mock.close())
  const url = new URL(mock.url)
  const device = await Device.connect({
    hostname: url.hostname,
    port: Number(url.port),
    username: 'admin',
    password: 'password'
  })
  cleanups.push(() => device.close())
  return { mock, v2: device.use(media).media.v2 }
}

const answer = (body: string, status = 200): ActionOverride => ({ kind: 'status', status, body })

const requestOf = (mock: MockCamera, action: string): XmlObject =>
  parseEnvelope(mock.requests.findLast((request) => request.action === action)?.body ?? '').body

const rawRequestOf = (mock: MockCamera, action: string): string =>
  mock.requests.findLast((request) => request.action === action)?.body ?? ''

const rejection = async (action: () => Promise<unknown>): Promise<unknown> => {
  try {
    await action()
  } catch (error) {
    return error
  }
  throw new Error('Expected a rejection')
}

const operations = Object.values(Media2).filter(
  (value): value is Operation<never, never> => typeof value === 'object' && 'response' in value
)

const topics = 'http://www.onvif.org/ver10/topics'
const concreteSet = 'http://www.onvif.org/ver10/tev/topicExpression/ConcreteSet'

describe('generated media2 operations', () => {
  // captures of one operation in another state are named after it, such as media2.GetProfilesAfterAdd
  const operationOf = (action: string) =>
    operations
      .filter(({ name }) => action.startsWith(name))
      .reduce<(typeof operations)[number] | undefined>(
        (longest, operation) => (operation.name.length > (longest?.name.length ?? 0) ? operation : longest),
        undefined
      )
  const fixtures = corpus.flatMap((entry) => {
    const action = /^(?:live|simulator)\/.+\/media2\.(\w+)\.xml$/.exec(entry.name)?.[1]
    const operation = action === undefined ? undefined : operationOf(action)
    return operation && entry.status === 200 && !entry.fault ? [{ name: entry.name, xml: entry.xml, operation }] : []
  })

  it('cover a camera capture for every operation', () => {
    const captured = new Set(
      fixtures.filter(({ name }) => name.startsWith('live/')).map(({ operation }) => operation.name)
    )
    expect(operations.map(({ name }) => name).filter((name) => !captured.has(name))).toEqual([])
  })

  it('parse only the metadata configurations with namespaces', () => {
    expect(operations.filter((operation) => operation.namespaces === true).map(({ name }) => name)).toEqual([
      'GetMetadataConfigurations'
    ])
  })

  it.each(fixtures.map((entry) => [entry.name, entry] as const))('decode %s', (_name, { xml, operation }) => {
    const { body } = parseEnvelope(xml, {}, undefined, { namespaces: operation.namespaces === true })
    const response = body[operation.response.name]
    expect(response).toBeDefined()
    expect(() => decode(operation.schema, operation.response.type, response ?? '')).not.toThrow()
  })
})

describe('media.v2 configurations', () => {
  it('has a method for every operation', async () => {
    const { v2 } = await connect()
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(v2)).filter((name) => name !== 'constructor')
    expect(methods.toSorted()).toEqual(
      operations.map(({ name }) => `${name.charAt(0).toLowerCase()}${name.slice(1)}`).toSorted()
    )
  })

  it('adds a metadata and an analytics configuration to a profile and removes them again', async () => {
    const { mock, v2 } = await connect()
    const [metadata] = (await v2.getMetadataConfigurations()).configurations ?? []
    const [analytics] = (await v2.getAnalyticsConfigurations()).configurations ?? []
    const profileToken = 'profile1'
    const configuration = [
      { type: 'Metadata', token: metadata?.token ?? '' },
      { type: 'Analytics', token: analytics?.token ?? '' }
    ]
    await expect(v2.addConfiguration({ profileToken, configuration })).resolves.toEqual({})
    await expect(
      v2.removeConfiguration({ profileToken, configuration: [{ type: 'Metadata' }, { type: 'Analytics' }] })
    ).resolves.toEqual({})
    expect(requestOf(mock, 'AddConfiguration')).toEqual({
      AddConfiguration: {
        ProfileToken: profileToken,
        Configuration: [
          { Type: 'Metadata', Token: 'Metadata_token_1' },
          { Type: 'Analytics', Token: 'VideoAnalytics0' }
        ]
      }
    })
    expect(rawRequestOf(mock, 'RemoveConfiguration')).toContain(
      '<tr2:RemoveConfiguration xmlns:tr2="http://www.onvif.org/ver20/media/wsdl"><tr2:ProfileToken>profile1' +
        '</tr2:ProfileToken><tr2:Configuration><tr2:Type>Metadata</tr2:Type></tr2:Configuration><tr2:Configuration>' +
        '<tr2:Type>Analytics</tr2:Type></tr2:Configuration></tr2:RemoveConfiguration>'
    )
  })

  it('reads the metadata options for a configuration or a profile', async () => {
    const { mock, v2 } = await connect()
    const { options } = await v2.getMetadataConfigurationOptions({ profileToken: 'profile1' })
    expect(options.ptzStatusFilterOptions).toEqual({
      panTiltStatusSupported: false,
      zoomStatusSupported: true,
      panTiltPositionSupported: false,
      zoomPositionSupported: true
    })
    expect(requestOf(mock, 'GetMetadataConfigurationOptions')).toEqual({
      GetMetadataConfigurationOptions: { ProfileToken: 'profile1' }
    })
  })

  it('sends a metadata configuration back exactly as the camera reported it', async () => {
    const { mock, v2 } = await connect()
    const [configuration] = (await v2.getMetadataConfigurations()).configurations ?? []
    if (!configuration) throw new Error('no metadata configuration')
    await v2.setMetadataConfiguration({ configuration })
    const reported = parseEnvelope(cam('media2.GetMetadataConfigurations')).body
    expect(requestOf(mock, 'SetMetadataConfiguration')).toEqual({
      SetMetadataConfiguration: {
        Configuration: (reported['GetMetadataConfigurationsResponse'] as XmlObject)['Configurations']
      }
    })
  })

  it('reads the analytics modules and rules of an analytics configuration', async () => {
    const { v2 } = await connect()
    const [configuration] = (await v2.getAnalyticsConfigurations()).configurations ?? []
    expect(configuration?.analyticsEngineConfiguration?.analyticsModule?.map(({ name, type }) => [name, type])).toEqual(
      [['CellMotionModule', 'tt:CellMotionEngine']]
    )
    expect(configuration?.ruleEngineConfiguration?.rule?.map(({ name, type }) => [name, type])).toEqual([
      ['MotionDetectorRule0', 'tt:CellMotionDetector']
    ])
  })
})

describe('media.v2 metadata event filters', () => {
  const dahuaMetadata = () =>
    connect({ overrides: { 'media2.GetMetadataConfigurations': answer(dahua('media2.GetMetadataConfigurations')) } })

  it('reads the topic expression of the event filter', async () => {
    const { v2 } = await dahuaMetadata()
    const [configuration] = (await v2.getMetadataConfigurations()).configurations ?? []
    expect(configuration?.events?.filter?.topicExpression).toEqual([
      { dialect: concreteSet, value: 'tns1:RuleEngine/CellMotionDetector/Motion' }
    ])
  })

  it('sends the event filter back with its topic namespace declared', async () => {
    const { mock, v2 } = await dahuaMetadata()
    const [configuration] = (await v2.getMetadataConfigurations()).configurations ?? []
    if (!configuration) throw new Error('no metadata configuration')
    await v2.setMetadataConfiguration({ configuration })
    const raw = rawRequestOf(mock, 'SetMetadataConfiguration')
    expect(raw).toContain(
      `<tt:Events><tt:Filter><wsnt:TopicExpression Dialect="${concreteSet}">` +
        'tns1:RuleEngine/CellMotionDetector/Motion</wsnt:TopicExpression></tt:Filter></tt:Events>'
    )
    expect(raw).toContain(`xmlns:tns1="${topics}"`)
    expect(raw).toContain('xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2"')
  })

  it('reads a topic prefix the device picked as tns1', async () => {
    const xml = dahua('media2.GetMetadataConfigurations')
      .replace(`xmlns:tns1="${topics}"`, `xmlns:ev="${topics}"`)
      .replace('>tns1:RuleEngine', '>ev:RuleEngine')
    const { v2 } = await connect({ overrides: { 'media2.GetMetadataConfigurations': answer(xml) } })
    const [configuration] = (await v2.getMetadataConfigurations()).configurations ?? []
    expect(configuration?.events?.filter?.topicExpression?.[0]?.value).toBe('tns1:RuleEngine/CellMotionDetector/Motion')
  })

  it('sends a topic in a vendor namespace with its namespace declared', async () => {
    const { mock, v2 } = await connect()
    const [configuration] = (await v2.getMetadataConfigurations()).configurations ?? []
    if (!configuration) throw new Error('no metadata configuration')
    const value = '{urn:example:vendor}Zone/Intrusion|tns1:VideoSource/MotionAlarm'
    await v2.setMetadataConfiguration({
      configuration: { ...configuration, events: { filter: { topicExpression: [{ dialect: concreteSet, value }] } } }
    })
    const raw = rawRequestOf(mock, 'SetMetadataConfiguration')
    const prefix = /(\w+):Zone\/Intrusion/.exec(raw)?.[1] ?? ''
    expect(raw).toContain(`xmlns:${prefix}="urn:example:vendor"`)
    expect(raw).toContain(`>${prefix}:Zone/Intrusion|tns1:VideoSource/MotionAlarm</wsnt:TopicExpression>`)
  })

  it('rejects a topic with a prefix it cannot declare before sending anything', async () => {
    const { mock, v2 } = await connect()
    const [configuration] = (await v2.getMetadataConfigurations()).configurations ?? []
    if (!configuration) throw new Error('no metadata configuration')
    const filter = { topicExpression: [{ dialect: concreteSet, value: 'hik:Zone' }] }
    await expect(
      v2.setMetadataConfiguration({ configuration: { ...configuration, events: { filter } } })
    ).rejects.toThrow(
      'Unknown prefix hik at SetMetadataConfiguration.configuration.events.filter.topicExpression[0].value'
    )
    expect(mock.requests.some(({ action }) => action === 'SetMetadataConfiguration')).toBe(false)
  })

  it('keeps the topic of a profile read without namespaces as the device sent it', async () => {
    const { v2 } = await connect({ overrides: { 'media2.GetProfiles': answer(dahua('media2.GetProfiles')) } })
    const { profiles = [] } = await v2.getProfiles({ type: ['All'] })
    const filters = profiles.flatMap(
      ({ configurations }) => configurations?.metadata?.events?.filter?.topicExpression ?? []
    )
    expect(filters.map(({ value }) => value)).toEqual(filters.map(() => 'tns1:RuleEngine/CellMotionDetector/Motion'))
  })
})

describe('media.v2 on the Hikvision DS-2DE2C400IG-W-W', () => {
  it('reads a metadata configuration without events and with an empty analytics engine', async () => {
    const { v2 } = await connect({
      overrides: { 'media2.GetMetadataConfigurations': answer(hik('media2.GetMetadataConfigurations')) }
    })
    const [configuration] = (await v2.getMetadataConfigurations()).configurations ?? []
    expect(configuration).toMatchObject({
      token: 'MetaDataToken',
      geoLocation: false,
      ptzStatus: { status: false, position: false },
      sessionTimeout: 'PT5S',
      analyticsEngineConfiguration: {}
    })
    expect(configuration?.events).toBeUndefined()
  })

  it('reports a configuration that does not exist as a SOAP fault with its subcodes', async () => {
    const { v2 } = await connect({
      overrides: {
        'media2.GetMetadataConfigurations': answer(hik('media2.GetMetadataConfigurationsMissingFault'), 500)
      }
    })
    const error = await rejection(() => v2.getMetadataConfigurations({ configurationToken: 'missing' }))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({
      subcodes: ['InvalidArgVal', 'NoConfig'],
      service: 'tr2',
      action: 'GetMetadataConfigurations'
    })
  })
})
