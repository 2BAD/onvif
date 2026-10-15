import { DecodeError, Device, SoapFaultError } from '@2bad/onvif'
import { decode, type Operation, parseEnvelope, type XmlObject } from '@2bad/onvif/soap'
import { afterEach, describe, expect, it } from 'vitest'
import { corpus, fixture } from '../../../tools/fixtures/corpus.ts'
import {
  type ActionOverride,
  type MockCamera,
  type MockCameraOptions,
  startMockCamera
} from '../../../tools/mock-camera/server.ts'
import { Media, media } from '#index.ts'

const cam = (name: string): string => fixture(`live/dvc/dcn-bm2220lpr/${name}.xml`).xml
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
  return { mock, v1: device.use(media).media.v1 }
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

const operations = Object.values(Media).filter(
  (value): value is Operation<never, never> => typeof value === 'object' && 'response' in value
)

describe('generated media operations', () => {
  const fixtures = corpus.flatMap((entry) => {
    const action = /^(?:live|simulator)\/.+\/media\.(\w+)\.xml$/.exec(entry.name)?.[1]
    const operation = operations.find(({ name }) => name === action)
    return operation && entry.status === 200 && !entry.fault ? [{ name: entry.name, xml: entry.xml, operation }] : []
  })

  it('cover a camera capture for every operation', () => {
    const captured = new Set(
      fixtures.filter(({ name }) => name.startsWith('live/')).map(({ operation }) => operation.name)
    )
    expect(operations.map(({ name }) => name).filter((name) => !captured.has(name))).toEqual([])
  })

  it.each(fixtures.map((entry) => [entry.name, entry] as const))('decode %s', (_name, { xml, operation }) => {
    const { body } = parseEnvelope(xml)
    const response = body[operation.response.name]
    expect(response).toBeDefined()
    expect(() => decode(operation.schema, operation.response.type, response ?? '')).not.toThrow()
  })
})

describe('media.v1', () => {
  it('has a method for every operation', async () => {
    const { v1 } = await connect()
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(v1)).filter((name) => name !== 'constructor')
    expect(methods.toSorted()).toEqual(
      operations.map(({ name }) => `${name.charAt(0).toLowerCase()}${name.slice(1)}`).toSorted()
    )
  })

  it('builds a profile from the configurations of the camera and removes it again', async () => {
    const { mock, v1 } = await connect()
    const { profile } = await v1.createProfile({ name: 'onviftest' })
    const profileToken = profile.token
    const [videoSource] = (await v1.getCompatibleVideoSourceConfigurations({ profileToken })).configurations ?? []
    const [videoEncoder] = (await v1.getCompatibleVideoEncoderConfigurations({ profileToken })).configurations ?? []
    const [audioSource] = (await v1.getCompatibleAudioSourceConfigurations({ profileToken })).configurations ?? []
    const [audioEncoder] = (await v1.getCompatibleAudioEncoderConfigurations({ profileToken })).configurations ?? []
    const [metadata] = (await v1.getCompatibleMetadataConfigurations({ profileToken })).configurations ?? []
    const token = (configuration: { token: string } | undefined) => ({
      profileToken,
      configurationToken: configuration?.token ?? ''
    })
    await v1.addVideoSourceConfiguration(token(videoSource))
    await v1.addVideoEncoderConfiguration(token(videoEncoder))
    await v1.addAudioSourceConfiguration(token(audioSource))
    await v1.addAudioEncoderConfiguration(token(audioEncoder))
    await v1.addMetadataConfiguration(token(metadata))
    await v1.addPTZConfiguration({ profileToken, configurationToken: 'PTZConfiguration_token_1' })
    await v1.startMulticastStreaming({ profileToken })
    await v1.stopMulticastStreaming({ profileToken })
    await v1.removePTZConfiguration({ profileToken })
    await v1.removeMetadataConfiguration({ profileToken })
    await v1.removeAudioEncoderConfiguration({ profileToken })
    await v1.removeAudioSourceConfiguration({ profileToken })
    await v1.removeVideoEncoderConfiguration({ profileToken })
    await v1.removeVideoSourceConfiguration({ profileToken })
    await expect(v1.deleteProfile({ profileToken })).resolves.toEqual({})
    expect(requestOf(mock, 'AddVideoEncoderConfiguration')).toEqual({
      AddVideoEncoderConfiguration: { ProfileToken: profileToken, ConfigurationToken: videoEncoder?.token }
    })
    expect(mock.requests.filter(({ service }) => service === 'media')).toHaveLength(21)
  })

  it('lists the sources and configurations of the camera', async () => {
    const { v1 } = await connect()
    expect(
      (await v1.getServiceCapabilities()).capabilities.profileCapabilities?.maximumNumberOfProfiles
    ).toBeGreaterThan(0)
    expect((await v1.getVideoSources()).videoSources?.length).toBeGreaterThan(0)
    expect((await v1.getAudioSources()).audioSources?.length).toBeGreaterThan(0)
    expect((await v1.getAudioSourceConfigurations()).configurations?.length).toBeGreaterThan(0)
    expect((await v1.getAudioEncoderConfigurations()).configurations?.length).toBeGreaterThan(0)
    expect((await v1.getMetadataConfigurations()).configurations?.length).toBeGreaterThan(0)
  })

  it('reads the options of each configuration kind', async () => {
    const { v1 } = await connect()
    const configurationToken = 'any'
    const { options: videoSource } = await v1.getVideoSourceConfigurationOptions({ configurationToken })
    expect(videoSource.boundsRange.widthRange.max).toBeGreaterThan(0)
    const { options: audioSource } = await v1.getAudioSourceConfigurationOptions({ configurationToken })
    expect(audioSource.inputTokensAvailable.length).toBeGreaterThan(0)
    const { options: audioEncoder } = await v1.getAudioEncoderConfigurationOptions({ configurationToken })
    expect(audioEncoder.options?.length).toBeGreaterThan(0)
    const { options: metadata } = await v1.getMetadataConfigurationOptions({ configurationToken })
    expect(metadata.ptzStatusFilterOptions).toBeDefined()
  })
})

describe('media.v1 requests', () => {
  const kinds = ['VideoSource', 'VideoEncoder', 'AudioSource', 'AudioEncoder', 'Metadata'] as const

  it.each(kinds)('sends a %s configuration back exactly as the camera reported it', async (kind) => {
    const { mock, v1 } = await connect()
    const get = v1[`get${kind}Configuration`].bind(v1) as (request: {
      configurationToken: string
    }) => Promise<{ configuration: never }>
    const set = v1[`set${kind}Configuration`].bind(v1) as (request: {
      configuration: never
      forcePersistence: boolean
    }) => Promise<unknown>
    const { configuration } = await get({ configurationToken: 'any' })
    await set({ configuration, forcePersistence: false })
    const reported = parseEnvelope(cam(`media.Get${kind}Configuration`)).body
    const sent = requestOf(mock, `Set${kind}Configuration`)
    expect(sent).toEqual({
      [`Set${kind}Configuration`]: {
        Configuration: (reported[`Get${kind}ConfigurationResponse`] as XmlObject)['Configuration'],
        ForcePersistence: 'false'
      }
    })
  })

  it('puts the configuration content in the schema namespace and ForcePersistence after it', async () => {
    const { mock, v1 } = await connect()
    const { configuration } = await v1.getAudioEncoderConfiguration({ configurationToken: 'any' })
    await v1.setAudioEncoderConfiguration({ configuration, forcePersistence: true })
    const raw = rawRequestOf(mock, 'SetAudioEncoderConfiguration')
    expect(raw).toMatch(/<trt:Configuration token="[^"]+"><tt:Name>/)
    expect(raw).toMatch(/<\/trt:Configuration><trt:ForcePersistence>true<\/trt:ForcePersistence><\/trt:Set/)
  })

  it('sends tokens of 0 and zero values', async () => {
    const { mock, v1 } = await connect()
    await v1.createProfile({ name: 'zero', token: '0' })
    await v1.addVideoEncoderConfiguration({ profileToken: '0', configurationToken: '0' })
    const { configuration } = await v1.getAudioEncoderConfiguration({ configurationToken: '0' })
    await v1.setAudioEncoderConfiguration({
      configuration: { ...configuration, useCount: 0, bitrate: 0, sampleRate: 0 },
      forcePersistence: false
    })
    expect(requestOf(mock, 'CreateProfile')).toEqual({ CreateProfile: { Name: 'zero', Token: '0' } })
    expect(requestOf(mock, 'AddVideoEncoderConfiguration')).toEqual({
      AddVideoEncoderConfiguration: { ProfileToken: '0', ConfigurationToken: '0' }
    })
    expect(requestOf(mock, 'SetAudioEncoderConfiguration')).toMatchObject({
      SetAudioEncoderConfiguration: { Configuration: { UseCount: '0', Bitrate: '0', SampleRate: '0' } }
    })
  })

  it('sends the scene orientation and lens description in their schema form', async () => {
    const { mock, v1 } = await connect()
    const { configuration } = await v1.getVideoSourceConfiguration({ configurationToken: 'any' })
    await v1.setVideoSourceConfiguration({
      configuration: {
        ...configuration,
        extension: {
          rotate: { mode: 'OFF' },
          extension: {
            lensDescription: [
              { offset: { x: 0, y: 0 }, projection: [{ angle: 0, radius: 0 }], xFactor: 1, focalLength: 4 }
            ],
            sceneOrientation: { mode: 'MANUAL', orientation: 'Right' }
          }
        }
      },
      forcePersistence: false
    })
    const raw = rawRequestOf(mock, 'SetVideoSourceConfiguration')
    expect(raw).toContain('<tt:LensDescription FocalLength="4">')
    expect(raw).toContain('<tt:SceneOrientation><tt:Mode>MANUAL</tt:Mode><tt:Orientation>Right</tt:Orientation>')
  })
})

describe('media.v1 responses', () => {
  it('keeps tokens that look like numbers as strings', async () => {
    const xml = cam('media.GetProfile').replace(/(<trt:Profile\b[^>]*\btoken=")[^"]*"/, '$1007"')
    const { v1 } = await connect({ overrides: { 'media.GetProfile': answer(xml) } })
    expect((await v1.getProfile({ profileToken: '007' })).profile.token).toBe('007')
  })

  it('rejects deleting a fixed profile with the fault of the device', async () => {
    const refused =
      '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:ter="http://www.onvif.org/ver10/error">' +
      '<s:Body><s:Fault><s:Code><s:Value>s:Receiver</s:Value><s:Subcode><s:Value>ter:Action</s:Value><s:Subcode>' +
      '<s:Value>ter:DeletionOfFixedProfile</s:Value></s:Subcode></s:Subcode></s:Code><s:Reason>' +
      '<s:Text xml:lang="en">The fixed Profile cannot be deleted.</s:Text></s:Reason></s:Fault></s:Body></s:Envelope>'
    const { v1 } = await connect({ overrides: { 'media.DeleteProfile': answer(refused, 500) } })
    const error = await rejection(() => v1.deleteProfile({ profileToken: 'profile1' }))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: ['Action', 'DeletionOfFixedProfile'], action: 'DeleteProfile' })
  })

  it('rejects a multicast configuration without an address with the path of the element', async () => {
    const xml = cam('media.GetAudioEncoderConfiguration').replace(/<tt:Address>[\s\S]*?<\/tt:Address>/, '')
    const { v1 } = await connect({ overrides: { 'media.GetAudioEncoderConfiguration': answer(xml) } })
    const error = await rejection(() => v1.getAudioEncoderConfiguration({ configurationToken: 'any' }))
    expect(error).toBeInstanceOf(DecodeError)
    expect(error).toMatchObject({
      message: expect.stringContaining('Address'),
      path: 'GetAudioEncoderConfigurationResponse.Configuration.Multicast'
    })
  })
})
