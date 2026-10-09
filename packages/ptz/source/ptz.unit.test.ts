import { DecodeError, Device, OnvifError, SoapFaultError } from '@2bad/onvif'
import { decode, parseEnvelope, type XmlObject } from '@2bad/onvif/soap'
import { afterEach, describe, expect, it } from 'vitest'
import { corpus, fixture } from '../../../tools/fixtures/corpus.ts'
import {
  type ActionOverride,
  type MockCamera,
  type MockCameraOptions,
  startMockCamera
} from '../../../tools/mock-camera/server.ts'
import { PTZ, ptz } from '#index.ts'

const lab = (name: string): string => fixture(`live/dvc/dcn-bm2220lpr/${name}.xml`).xml
const hik = (name: string): string => fixture(`live/ezviz/ds-2de2c400ig-w-w/${name}.xml`).xml
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
  return { mock, device: device.use(ptz) }
}

const answer = (body: string, status = 200): ActionOverride => ({ kind: 'status', status, body })

const requestOf = (mock: MockCamera, action: string): XmlObject => {
  const body = mock.requests.findLast((request) => request.action === action)?.body ?? ''
  return parseEnvelope(body).body
}

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

const profileToken = 'Profile_1'

const operations = [
  PTZ.GetServiceCapabilities,
  PTZ.GetNodes,
  PTZ.GetNode,
  PTZ.GetConfigurations,
  PTZ.GetConfiguration,
  PTZ.GetConfigurationOptions,
  PTZ.SetConfiguration,
  PTZ.GetStatus,
  PTZ.ContinuousMove,
  PTZ.RelativeMove,
  PTZ.AbsoluteMove,
  PTZ.Stop,
  PTZ.GetPresets,
  PTZ.SetPreset,
  PTZ.RemovePreset,
  PTZ.GotoPreset,
  PTZ.GotoHomePosition,
  PTZ.SetHomePosition,
  PTZ.SendAuxiliaryCommand
]

describe('generated ptz operations', () => {
  // captures of one operation in another state are named after it, such as ptz.GetStatusMoving
  const operationOf = (action: string) =>
    operations
      .filter(({ name }) => action.startsWith(name))
      .reduce<(typeof operations)[number] | undefined>(
        (longest, operation) => (operation.name.length > (longest?.name.length ?? 0) ? operation : longest),
        undefined
      )
  const fixtures = corpus.flatMap((entry) => {
    const action = /^(?:live\/.+|upstream)\/ptz\.(\w+)\.xml$/.exec(entry.name)?.[1]
    const operation = action === undefined ? undefined : operationOf(action)
    return operation && entry.status === 200 ? [{ name: entry.name, xml: entry.xml, operation }] : []
  })

  it('cover a lab capture for every operation', () => {
    const captured = new Set(
      fixtures.filter(({ name }) => name.startsWith('live/')).map(({ operation }) => operation.name)
    )
    const faultOnly = ['RelativeMove', 'AbsoluteMove', 'SendAuxiliaryCommand']
    expect(
      operations.map(({ name }) => name).filter((name) => !captured.has(name) && !faultOnly.includes(name))
    ).toEqual([])
  })

  it.each(fixtures.map((entry) => [entry.name, entry] as const))('decode %s', (_name, { xml, operation }) => {
    const { body } = parseEnvelope(xml)
    const response = body[operation.response.name]
    expect(response).toBeDefined()
    expect(() => decode(operation.schema, operation.response.type, response ?? '')).not.toThrow()
  })
})

describe('ptz', () => {
  it('adds a method for every operation as device.ptz', async () => {
    const { device } = await connect()
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(device.ptz))
    const expected = operations.map(({ name }) => `${name.charAt(0).toLowerCase()}${name.slice(1)}`)
    expect(methods.filter((name) => name !== 'constructor').toSorted()).toEqual([...expected, 'forProfile'].toSorted())
    expect(Object.getOwnPropertyDescriptor(device, 'ptz')).toMatchObject({ writable: false, enumerable: true })
  })

  it('adds a method for every operation that takes a profile token to forProfile()', async () => {
    const { device } = await connect()
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(device.ptz.forProfile(profileToken)))
    expect(methods.filter((name) => name !== 'constructor').toSorted()).toEqual(
      [
        'getStatus',
        'continuousMove',
        'relativeMove',
        'absoluteMove',
        'stop',
        'getPresets',
        'setPreset',
        'removePreset',
        'gotoPreset',
        'gotoHomePosition',
        'setHomePosition',
        'sendAuxiliaryCommand'
      ].toSorted()
    )
  })

  it('sends the same request through forProfile() as with the profile token', async () => {
    const { mock, device } = await connect({
      overrides: {
        'ptz.ContinuousMove': answer(hik('ptz.ContinuousMove')),
        'ptz.Stop': answer(hik('ptz.Stop')),
        'ptz.GetStatus': answer(hik('ptz.GetStatus'))
      }
    })
    const profile = device.ptz.forProfile(profileToken)
    const velocity = { panTilt: { x: 0.3, y: 0 } }
    await device.ptz.continuousMove({ profileToken, velocity, timeout: 'PT1S' })
    await profile.continuousMove({ velocity, timeout: 'PT1S' })
    await device.ptz.stop({ profileToken })
    await profile.stop()
    for (const action of ['ContinuousMove', 'Stop']) {
      const [direct, scoped] = mock.requests.filter((request) => request.action === action)
      expect(parseEnvelope(scoped?.body ?? '').body).toEqual(parseEnvelope(direct?.body ?? '').body)
    }
    expect(await profile.getStatus()).toEqual(await device.ptz.getStatus({ profileToken }))
  })

  it('keeps one profile per forProfile() client', async () => {
    const { mock, device } = await connect({ overrides: { 'ptz.Stop': answer(hik('ptz.Stop')) } })
    await device.ptz.forProfile('Profile_1').stop()
    await device.ptz.forProfile('Profile_2').stop()
    expect(mock.requests.filter(({ action }) => action === 'Stop').map(({ body }) => parseEnvelope(body).body)).toEqual(
      [{ Stop: { ProfileToken: 'Profile_1' } }, { Stop: { ProfileToken: 'Profile_2' } }]
    )
  })

  it('sends the same request as Device.call', async () => {
    const { mock, device } = await connect({ overrides: { 'ptz.ContinuousMove': answer(hik('ptz.ContinuousMove')) } })
    const request = { profileToken, velocity: { panTilt: { x: 0.3, y: 0 } }, timeout: 'PT1S' }
    await device.call(PTZ.ContinuousMove, request)
    await device.ptz.continuousMove(request)
    const [byCall, byMethod] = mock.requests.filter(({ action }) => action === 'ContinuousMove')
    expect(parseEnvelope(byMethod?.body ?? '').body).toEqual(parseEnvelope(byCall?.body ?? '').body)
    expect(byMethod?.path).toBe('/onvif/PTZ')
  })

  it('reports a device without a PTZ service before sending anything', async () => {
    const services = lab('device.GetServices').replace(
      /<tds:Service>(?:(?!<\/tds:Service>)[\s\S])*?ver20\/ptz\/wsdl[\s\S]*?<\/tds:Service>/,
      ''
    )
    const { mock, device } = await connect({ overrides: { 'device.GetServices': answer(services) } })
    const error = await rejection(() => device.ptz.stop({ profileToken }))
    expect(error).toBeInstanceOf(OnvifError)
    expect(error).toMatchObject({ service: 'tptz', action: 'Stop' })
    expect(mock.requests.some(({ action }) => action === 'Stop')).toBe(false)
  })
})

describe('PTZ requests', () => {
  const moves: Record<string, ActionOverride> = {
    'ptz.ContinuousMove': answer(hik('ptz.ContinuousMove')),
    'ptz.RelativeMove': answer(hik('ptz.ContinuousMove').replaceAll('ContinuousMove', 'RelativeMove')),
    'ptz.AbsoluteMove': answer(hik('ptz.ContinuousMove').replaceAll('ContinuousMove', 'AbsoluteMove')),
    'ptz.Stop': answer(hik('ptz.Stop')),
    'ptz.GotoPreset': answer(hik('ptz.GotoPreset')),
    'ptz.GotoHomePosition': answer(hik('ptz.GotoHomePosition')),
    'ptz.SetPreset': answer(hik('ptz.SetPreset'))
  }

  it('writes vectors as tt elements with attributes', async () => {
    const { mock, device } = await connect({ overrides: moves })
    await device.ptz.continuousMove({
      profileToken,
      velocity: { panTilt: { x: 0.5, y: -0.25 }, zoom: { x: 1 } },
      timeout: 'PT2S'
    })
    const raw = rawRequestOf(mock, 'ContinuousMove')
    expect(raw).toMatch(/<(\w+:)?PanTilt [^>]*x="0.5" y="-0.25"/)
    expect(requestOf(mock, 'ContinuousMove')).toEqual({
      ContinuousMove: {
        ProfileToken: profileToken,
        Velocity: { PanTilt: { $: { x: '0.5', y: '-0.25' } }, Zoom: { $: { x: '1' } } },
        Timeout: 'PT2S'
      }
    })
    const panTilt = /<(\w+):PanTilt\b/.exec(raw)?.[1] ?? ''
    expect(raw).toContain(`xmlns:${panTilt}="http://www.onvif.org/ver10/schema"`)
  })

  it('sends only the axes it was given, so pan only cameras accept the move', async () => {
    const { mock, device } = await connect({ overrides: moves })
    await device.ptz.continuousMove({ profileToken, velocity: { panTilt: { x: 0, y: 0 } } })
    expect(requestOf(mock, 'ContinuousMove')).toEqual({
      ContinuousMove: { ProfileToken: profileToken, Velocity: { PanTilt: { $: { x: '0', y: '0' } } } }
    })
    await device.ptz.relativeMove({ profileToken, translation: { zoom: { x: -0.5 } } })
    expect(requestOf(mock, 'RelativeMove')).toEqual({
      RelativeMove: { ProfileToken: profileToken, Translation: { Zoom: { $: { x: '-0.5' } } } }
    })
  })

  it('writes the space of a vector as given', async () => {
    const { mock, device } = await connect({ overrides: moves })
    const space = 'http://www.onvif.org/ver10/tptz/PanTiltSpaces/VelocitySpaceFOV?a=1&b="2"'
    await device.ptz.absoluteMove({
      profileToken,
      position: { panTilt: { x: 1, y: 1, space } },
      speed: { panTilt: { x: 0.1, y: 0.1 } }
    })
    expect(requestOf(mock, 'AbsoluteMove')).toEqual({
      AbsoluteMove: {
        ProfileToken: profileToken,
        Position: { PanTilt: { $: { x: '1', y: '1', space } } },
        Speed: { PanTilt: { $: { x: '0.1', y: '0.1' } } }
      }
    })
  })

  it('writes small and infinite values as valid xs:float', async () => {
    const { mock, device } = await connect({ overrides: moves })
    await device.ptz.continuousMove({
      profileToken,
      velocity: { panTilt: { x: 1e-7, y: Number.NEGATIVE_INFINITY } }
    })
    expect(requestOf(mock, 'ContinuousMove')).toMatchObject({
      ContinuousMove: { Velocity: { PanTilt: { $: { x: '1e-7', y: '-INF' } } } }
    })
  })

  it('stops only the axes asked for, and sends false when asked', async () => {
    const { mock, device } = await connect({ overrides: moves })
    await device.ptz.stop({ profileToken })
    expect(requestOf(mock, 'Stop')).toEqual({ Stop: { ProfileToken: profileToken } })
    await device.ptz.stop({ profileToken, panTilt: true, zoom: false })
    expect(requestOf(mock, 'Stop')).toEqual({ Stop: { ProfileToken: profileToken, PanTilt: 'true', Zoom: 'false' } })
  })

  it('sends the speed of GotoPreset and GotoHomePosition as Speed', async () => {
    const { mock, device } = await connect({ overrides: moves })
    const speed = { panTilt: { x: 0.5, y: 0.5 } }
    await device.ptz.gotoPreset({ profileToken, presetToken: '1', speed })
    await device.ptz.gotoHomePosition({ profileToken, speed })
    for (const action of ['GotoPreset', 'GotoHomePosition']) {
      expect(requestOf(mock, action)[action]).toMatchObject({ Speed: { PanTilt: { $: { x: '0.5', y: '0.5' } } } })
    }
  })

  it('escapes preset names and tokens', async () => {
    const { mock, device } = await connect({ overrides: moves })
    const presetName = '<Gate> & "Door"'
    await device.ptz.setPreset({ profileToken: 'a&b', presetName })
    expect(requestOf(mock, 'SetPreset')).toEqual({ SetPreset: { ProfileToken: 'a&b', PresetName: presetName } })
    expect(rawRequestOf(mock, 'SetPreset')).not.toContain('<Gate>')
  })
})

describe('PTZ on the Hikvision DS-2DE2C400IG-W-W', () => {
  const hikAnswers = (names: string[]): Record<string, ActionOverride> =>
    Object.fromEntries(names.map((name) => [`ptz.${name}`, answer(hik(`ptz.${name}`))]))

  it('reads a pan and tilt node with two velocity spaces and no zoom', async () => {
    const { device } = await connect({ overrides: hikAnswers(['GetNodes', 'GetConfigurations']) })
    const { ptzNode: [node] = [] } = await device.ptz.getNodes()
    expect(node?.supportedPTZSpaces.continuousPanTiltVelocitySpace?.map(({ URI, xRange }) => [URI, xRange])).toEqual([
      ['http://www.onvif.org/ver10/tptz/PanTiltSpaces/VelocityGenericSpace', { min: -1, max: 1 }],
      ['http://www.onvif.org/ver10/tptz/PanTiltSpaces/VelocitySpaceFOV', { min: -7, max: 7 }]
    ])
    expect(node?.supportedPTZSpaces.continuousZoomVelocitySpace).toBeUndefined()
    expect(node?.supportedPTZSpaces.absolutePanTiltPositionSpace).toBeUndefined()
    expect(node).toMatchObject({ maximumNumberOfPresets: 12, homeSupported: false })
    const { ptzConfiguration: [configuration] = [] } = await device.ptz.getConfigurations()
    expect(configuration).toMatchObject({ defaultContinuousZoomVelocitySpace: '', defaultPTZTimeout: 'PT300S' })
  })

  it('reads a status without a position while it moves', async () => {
    const { device } = await connect({ overrides: { 'ptz.GetStatus': answer(hik('ptz.GetStatusMoving')) } })
    expect(await device.ptz.getStatus({ profileToken })).toEqual({
      ptzStatus: {
        moveStatus: { panTilt: 'MOVING', zoom: 'MOVING' },
        error: 'NO error',
        utcTime: new Date('2026-10-07T20:19:04Z')
      }
    })
  })

  it('reads no presets as no array and a preset token as a string', async () => {
    const { device } = await connect({ overrides: hikAnswers(['GetPresets', 'SetPreset']) })
    expect(await device.ptz.getPresets({ profileToken })).toEqual({})
    expect(await device.ptz.setPreset({ profileToken, presetName: 'onviftest' })).toEqual({ presetToken: '1' })
  })

  it('reads a preset without a position', async () => {
    const { device } = await connect({ overrides: { 'ptz.GetPresets': answer(hik('ptz.GetPresetsWithPreset')) } })
    expect(await device.ptz.getPresets({ profileToken })).toEqual({ preset: [{ token: '1', name: 'onviftest' }] })
  })

  it.each([
    ['ContinuousMoveZoom', 'continuousMove', ['InvalidArgVal', 'SpaceNotSupported']],
    ['RelativeMove', 'relativeMove', ['InvalidArgVal', 'SpaceNotSupported']],
    ['AbsoluteMove', 'absoluteMove', ['InvalidArgVal', 'SpaceNotSupported']],
    ['SendAuxiliaryCommand', 'sendAuxiliaryCommand', ['InvalidArgVal', 'AuxiliaryDataNotSupported']],
    ['GotoPresetMissing', 'gotoPreset', ['InvalidArgVal', 'InvalidParameter']]
  ] as const)('reports the %s fault with its subcodes', async (name, method, subcodes) => {
    const action = name.replace(/Zoom$|Missing$/, '')
    const { device } = await connect({ overrides: { [`ptz.${action}`]: answer(hik(`ptz.${name}`), 500) } })
    const requests = {
      continuousMove: () => device.ptz.continuousMove({ profileToken, velocity: { zoom: { x: 0.5 } } }),
      relativeMove: () => device.ptz.relativeMove({ profileToken, translation: { panTilt: { x: 0.1, y: 0 } } }),
      absoluteMove: () => device.ptz.absoluteMove({ profileToken, position: { panTilt: { x: 0, y: 0 } } }),
      sendAuxiliaryCommand: () => device.ptz.sendAuxiliaryCommand({ profileToken, auxiliaryData: 'tt:Wiper|On' }),
      gotoPreset: () => device.ptz.gotoPreset({ profileToken, presetToken: 'missing' })
    }
    const error = await rejection(requests[method])
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes, service: 'tptz', action })
  })
})

describe('PTZ on the DCN-BM2220LPR', () => {
  it('reads a default speed with an empty space', async () => {
    const { device } = await connect()
    const { ptzConfiguration: [configuration] = [] } = await device.ptz.getConfigurations()
    expect(configuration?.defaultPTZSpeed).toEqual({ panTilt: { x: 0, y: 0, space: '' }, zoom: { x: 0, space: '' } })
  })
})

describe('PTZ responses the schema does not allow', () => {
  it('rejects a nil status with the path of the element', async () => {
    const nil = hik('ptz.GetStatus').replace(
      /<tptz:PTZStatus>[\s\S]*<\/tptz:PTZStatus>/,
      '<tptz:PTZStatus xsi:nil="true"/>'
    )
    const { device } = await connect({ overrides: { 'ptz.GetStatus': answer(nil) } })
    const error = await rejection(() => device.ptz.getStatus({ profileToken }))
    expect(error).toBeInstanceOf(DecodeError)
    expect(error).toMatchObject({ path: 'GetStatusResponse.PTZStatus', service: 'tptz', action: 'GetStatus' })
  })

  it('rejects a status without UtcTime with the path of the element', async () => {
    const missing = hik('ptz.GetStatus').replace(/<tt:UtcTime>[^<]*<\/tt:UtcTime>/, '')
    const { device } = await connect({ overrides: { 'ptz.GetStatus': answer(missing) } })
    const error = await rejection(() => device.ptz.getStatus({ profileToken }))
    expect(error).toBeInstanceOf(DecodeError)
    expect(error).toMatchObject({ path: 'GetStatusResponse.PTZStatus', action: 'GetStatus' })
    expect((error as Error).message).toContain('UtcTime')
  })
})
