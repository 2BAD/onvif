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
import { Imaging, imaging } from '#index.ts'

const cam = (name: string): string => fixture(`live/dvc/dcn-bm2220lpr/${name}.xml`).xml
const hik = (name: string): string => fixture(`live/ezviz/ds-2de2c400ig-w-w/${name}.xml`).xml
const moved: Record<string, ActionOverride> = {
  'imaging.Move': { kind: 'status', status: 200, body: cam('imaging.MoveContinuous') }
}
const presets = cam('imaging.GetPresets').replace(
  '<timg:GetPresetsResponse></timg:GetPresetsResponse>',
  '<timg:GetPresetsResponse><timg:Preset token="preset_1" type="Sunny &amp; Bright"><timg:Name>Day</timg:Name></timg:Preset>' +
    '</timg:GetPresetsResponse>'
)
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
  return { mock, device: device.use(imaging) }
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

const videoSourceToken = 'VideoSource_token_1'

const operations = [
  Imaging.GetServiceCapabilities,
  Imaging.GetImagingSettings,
  Imaging.SetImagingSettings,
  Imaging.GetOptions,
  Imaging.Move,
  Imaging.GetMoveOptions,
  Imaging.Stop,
  Imaging.GetStatus,
  Imaging.GetPresets,
  Imaging.GetCurrentPreset,
  Imaging.SetCurrentPreset
]

describe('generated imaging operations', () => {
  // captures of one operation in another state are named after it, such as imaging.MoveContinuous
  const operationOf = (action: string) =>
    operations
      .filter(({ name }) => action.startsWith(name))
      .reduce<(typeof operations)[number] | undefined>(
        (longest, operation) => (operation.name.length > (longest?.name.length ?? 0) ? operation : longest),
        undefined
      )
  const fixtures = corpus.flatMap((entry) => {
    const action = /^(?:live|simulator)\/.+\/imaging\.(\w+)\.xml$/.exec(entry.name)?.[1]
    const operation = action === undefined ? undefined : operationOf(action)
    return operation && entry.status === 200 && !entry.fault ? [{ name: entry.name, xml: entry.xml, operation }] : []
  })

  it('cover a camera capture for every operation', () => {
    const captured = new Set(
      fixtures.filter(({ name }) => name.startsWith('live/')).map(({ operation }) => operation.name)
    )
    const withoutPresets = ['SetCurrentPreset']
    expect(
      operations.map(({ name }) => name).filter((name) => !captured.has(name) && !withoutPresets.includes(name))
    ).toEqual([])
  })

  it.each(fixtures.map((entry) => [entry.name, entry] as const))('decode %s', (_name, { xml, operation }) => {
    const { body } = parseEnvelope(xml)
    const response = body[operation.response.name]
    expect(response).toBeDefined()
    expect(() => decode(operation.schema, operation.response.type, response ?? '')).not.toThrow()
  })
})

describe('imaging', () => {
  it('adds a method for every operation as device.imaging', async () => {
    const { device } = await connect()
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(device.imaging))
    const expected = operations.map(({ name }) => `${name.charAt(0).toLowerCase()}${name.slice(1)}`)
    expect(methods.filter((name) => name !== 'constructor').toSorted()).toEqual(
      [...expected, 'forVideoSource'].toSorted()
    )
    expect(Object.getOwnPropertyDescriptor(device, 'imaging')).toMatchObject({ writable: false, enumerable: true })
  })

  it('adds every operation but GetServiceCapabilities to forVideoSource()', async () => {
    const { device } = await connect()
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(device.imaging.forVideoSource(videoSourceToken)))
    const expected = operations
      .filter(({ name }) => name !== 'GetServiceCapabilities')
      .map(({ name }) => `${name.charAt(0).toLowerCase()}${name.slice(1)}`)
    expect(methods.filter((name) => name !== 'constructor').toSorted()).toEqual(expected.toSorted())
  })

  it('sends the same request through forVideoSource() as with the video source token', async () => {
    const { mock, device } = await connect({ overrides: moved })
    const source = device.imaging.forVideoSource(videoSourceToken)
    const focus = { continuous: { speed: 1 } }
    await device.imaging.move({ videoSourceToken, focus })
    await source.move({ focus })
    await device.imaging.setImagingSettings({ videoSourceToken, imagingSettings: { brightness: 25 } })
    await source.setImagingSettings({ imagingSettings: { brightness: 25 } })
    for (const action of ['Move', 'SetImagingSettings']) {
      const [direct, scoped] = mock.requests.filter((request) => request.action === action)
      expect(parseEnvelope(scoped?.body ?? '').body).toEqual(parseEnvelope(direct?.body ?? '').body)
    }
    expect(await source.getImagingSettings()).toEqual(await device.imaging.getImagingSettings({ videoSourceToken }))
  })

  it('sends the video source token with every forVideoSource() method', async () => {
    const { mock, device } = await connect({
      overrides: {
        ...moved,
        'imaging.GetPresets': answer(presets),
        'imaging.SetCurrentPreset': answer(
          cam('imaging.SetImagingSettings').replaceAll('SetImagingSettings', 'SetCurrentPreset')
        )
      }
    })
    const source = device.imaging.forVideoSource(videoSourceToken)
    const calls = [
      ['GetImagingSettings', () => source.getImagingSettings()],
      ['SetImagingSettings', () => source.setImagingSettings({ imagingSettings: {} })],
      ['GetOptions', () => source.getOptions()],
      ['Move', () => source.move({ focus: { continuous: { speed: 0 } } })],
      ['GetMoveOptions', () => source.getMoveOptions()],
      ['Stop', () => source.stop()],
      ['GetStatus', () => source.getStatus()],
      ['GetPresets', () => source.getPresets()],
      ['GetCurrentPreset', () => source.getCurrentPreset()],
      ['SetCurrentPreset', () => source.setCurrentPreset({ presetToken: 'preset_1' })]
    ] as const
    for (const [action, call] of calls) {
      await call()
      expect(requestOf(mock, action)[action]).toMatchObject({ VideoSourceToken: videoSourceToken })
    }
    expect(requestOf(mock, 'SetCurrentPreset')).toEqual({
      SetCurrentPreset: { VideoSourceToken: videoSourceToken, PresetToken: 'preset_1' }
    })
  })

  it('reads a preset list with its token, type and name', async () => {
    const { device } = await connect({ overrides: { 'imaging.GetPresets': answer(presets) } })
    expect(await device.imaging.getPresets({ videoSourceToken })).toEqual({
      preset: [{ token: 'preset_1', type: 'Sunny & Bright', name: 'Day' }]
    })
  })

  it('stops and sets the current preset with the video source token in the request', async () => {
    const { mock, device } = await connect({
      overrides: {
        'imaging.SetCurrentPreset': answer(
          cam('imaging.SetImagingSettings').replaceAll('SetImagingSettings', 'SetCurrentPreset')
        )
      }
    })
    expect(await device.imaging.stop({ videoSourceToken })).toEqual({})
    expect(await device.imaging.setCurrentPreset({ videoSourceToken, presetToken: 'preset_1' })).toEqual({})
    expect(requestOf(mock, 'SetCurrentPreset')).toEqual({
      SetCurrentPreset: { VideoSourceToken: videoSourceToken, PresetToken: 'preset_1' }
    })
  })

  it('keeps one video source per forVideoSource() client', async () => {
    const { mock, device } = await connect()
    await device.imaging.forVideoSource('VideoSource_1').stop()
    await device.imaging.forVideoSource('VideoSource_2').stop()
    expect(mock.requests.filter(({ action }) => action === 'Stop').map(({ body }) => parseEnvelope(body).body)).toEqual(
      [{ Stop: { VideoSourceToken: 'VideoSource_1' } }, { Stop: { VideoSourceToken: 'VideoSource_2' } }]
    )
  })

  it('sends the same request as Device.call', async () => {
    const { mock, device } = await connect()
    const request = { videoSourceToken, imagingSettings: { brightness: 25, irCutFilter: 'AUTO' } }
    await device.call(Imaging.SetImagingSettings, request)
    await device.imaging.setImagingSettings(request)
    const [byCall, byMethod] = mock.requests.filter(({ action }) => action === 'SetImagingSettings')
    expect(parseEnvelope(byMethod?.body ?? '').body).toEqual(parseEnvelope(byCall?.body ?? '').body)
    expect(byMethod?.path).toBe('/onvif/Imaging')
  })

  it('reports a device without an imaging service before sending anything', async () => {
    const services = cam('device.GetServices').replace(
      /<tds:Service>(?:(?!<\/tds:Service>)[\s\S])*?ver20\/imaging\/wsdl[\s\S]*?<\/tds:Service>/,
      ''
    )
    const { mock, device } = await connect({ overrides: { 'device.GetServices': answer(services) } })
    const error = await rejection(() => device.imaging.getImagingSettings({ videoSourceToken }))
    expect(error).toBeInstanceOf(OnvifError)
    expect(error).toMatchObject({ service: 'timg', action: 'GetImagingSettings' })
    expect(mock.requests.some(({ action }) => action === 'GetImagingSettings')).toBe(false)
  })
})

describe('imaging requests', () => {
  it('sends only the settings it was given, in schema order, as tt elements', async () => {
    const { mock, device } = await connect()
    await device.imaging.setImagingSettings({
      videoSourceToken,
      imagingSettings: { whiteBalance: { mode: 'MANUAL', crGain: 40 }, brightness: 60, irCutFilter: 'OFF' },
      forcePersistence: true
    })
    expect(requestOf(mock, 'SetImagingSettings')).toEqual({
      SetImagingSettings: {
        VideoSourceToken: videoSourceToken,
        ImagingSettings: { Brightness: '60', IrCutFilter: 'OFF', WhiteBalance: { Mode: 'MANUAL', CrGain: '40' } },
        ForcePersistence: 'true'
      }
    })
    const raw = rawRequestOf(mock, 'SetImagingSettings')
    expect(raw.indexOf('Brightness>')).toBeLessThan(raw.indexOf('IrCutFilter>'))
    expect(raw.indexOf('IrCutFilter>')).toBeLessThan(raw.indexOf('WhiteBalance>'))
    const brightness = /<(\w+):Brightness\b/.exec(raw)?.[1] ?? ''
    expect(raw).toContain(`xmlns:${brightness}="http://www.onvif.org/ver10/schema"`)
  })

  it('sends the settings back as they were read', async () => {
    const { mock, device } = await connect()
    const { imagingSettings } = await device.imaging.getImagingSettings({ videoSourceToken })
    await device.imaging.setImagingSettings({ videoSourceToken, imagingSettings, forcePersistence: true })
    const read = parseEnvelope(cam('imaging.GetImagingSettings')).body['GetImagingSettingsResponse']
    expect(requestOf(mock, 'SetImagingSettings')).toEqual({
      SetImagingSettings: {
        VideoSourceToken: videoSourceToken,
        ImagingSettings: (read as XmlObject)['ImagingSettings'],
        ForcePersistence: 'true'
      }
    })
  })

  it('writes the focus move of each kind', async () => {
    const { mock, device } = await connect({ overrides: moved })
    await device.imaging.move({ videoSourceToken, focus: { absolute: { position: 0.5, speed: 1 } } })
    expect(requestOf(mock, 'Move')).toEqual({
      Move: { VideoSourceToken: videoSourceToken, Focus: { Absolute: { Position: '0.5', Speed: '1' } } }
    })
    await device.imaging.move({ videoSourceToken, focus: { relative: { distance: -0.1 } } })
    expect(requestOf(mock, 'Move')).toEqual({
      Move: { VideoSourceToken: videoSourceToken, Focus: { Relative: { Distance: '-0.1' } } }
    })
    await device.imaging.move({ videoSourceToken, focus: { continuous: { speed: -8 } } })
    expect(requestOf(mock, 'Move')).toEqual({
      Move: { VideoSourceToken: videoSourceToken, Focus: { Continuous: { Speed: '-8' } } }
    })
  })

  it('writes small and infinite values as valid xs:float', async () => {
    const { mock, device } = await connect({ overrides: moved })
    await device.imaging.move({
      videoSourceToken,
      focus: { relative: { distance: 1e-7, speed: Number.POSITIVE_INFINITY } }
    })
    expect(requestOf(mock, 'Move')).toMatchObject({
      Move: { Focus: { Relative: { Distance: '1e-7', Speed: 'INF' } } }
    })
  })
})

describe('imaging failure modes of other clients', () => {
  const settingsWith = (content: string) =>
    cam('imaging.GetImagingSettings').replace(
      /<timg:ImagingSettings>[\s\S]*<\/timg:ImagingSettings>/,
      `<timg:ImagingSettings>${content}</timg:ImagingSettings>`
    )

  it('sends zero values and false', async () => {
    const { mock, device } = await connect({ overrides: moved })
    await device.imaging.setImagingSettings({
      videoSourceToken,
      imagingSettings: { brightness: 0, exposure: { mode: 'MANUAL', gain: 0, minGain: 0 } },
      forcePersistence: false
    })
    expect(requestOf(mock, 'SetImagingSettings')).toEqual({
      SetImagingSettings: {
        VideoSourceToken: videoSourceToken,
        ImagingSettings: { Brightness: '0', Exposure: { Mode: 'MANUAL', MinGain: '0', Gain: '0' } },
        ForcePersistence: 'false'
      }
    })
    await device.imaging.move({ videoSourceToken, focus: { absolute: { position: 0 } } })
    expect(requestOf(mock, 'Move')).toEqual({
      Move: { VideoSourceToken: videoSourceToken, Focus: { Absolute: { Position: '0' } } }
    })
  })

  it('sends IrCutFilter before Sharpness, as the schema orders them', async () => {
    const { mock, device } = await connect()
    await device.imaging.setImagingSettings({ videoSourceToken, imagingSettings: { sharpness: 10, irCutFilter: 'ON' } })
    expect(rawRequestOf(mock, 'SetImagingSettings')).toMatch(/IrCutFilter>ON<.*Sharpness>10</)
  })

  it('qualifies every settings element and every focus move in the tt namespace', async () => {
    const { mock, device } = await connect({ overrides: moved })
    await device.imaging.setImagingSettings({
      videoSourceToken,
      imagingSettings: {
        exposure: { mode: 'AUTO', window: { bottom: 1, top: 0, right: 1, left: 0 } },
        focus: { autoFocusMode: 'AUTO' }
      }
    })
    await device.imaging.move({ videoSourceToken, focus: { continuous: { speed: 1 } } })
    for (const action of ['SetImagingSettings', 'Move']) {
      const raw = rawRequestOf(mock, action)
      const tt = /xmlns:(\w+)="http:\/\/www\.onvif\.org\/ver10\/schema"/.exec(raw)?.[1]
      const timg = /xmlns:(\w+)="http:\/\/www\.onvif\.org\/ver20\/imaging\/wsdl"/.exec(raw)?.[1]
      const body = /<\w+:Body>(.*)<\/\w+:Body>/.exec(raw)?.[1] ?? ''
      const names = [...body.matchAll(/<(\w+):(\w+)/g)].map(
        ([, prefix, name]) => `${prefix === tt ? 'tt' : prefix === timg ? 'timg' : prefix}:${name}`
      )
      const own = new Set([`timg:${action}`, 'timg:VideoSourceToken', 'timg:ImagingSettings', 'timg:Focus'])
      expect(names.filter((name) => !own.has(name)).every((name) => name.startsWith('tt:'))).toBe(true)
    }
    expect(rawRequestOf(mock, 'SetImagingSettings')).toMatch(/<\w+:Window [^>]*top="0"/)
  })

  it('sends the settings it read back with their known extensions', async () => {
    const extended = settingsWith(
      '<tt:Brightness>50</tt:Brightness><tt:Extension><tt:ImageStabilization><tt:Mode>AUTO</tt:Mode>' +
        '<tt:Level>0.5</tt:Level></tt:ImageStabilization><tt:Extension><tt:IrCutFilterAutoAdjustment>' +
        '<tt:BoundaryType>ToOn</tt:BoundaryType><tt:BoundaryOffset>0</tt:BoundaryOffset></tt:IrCutFilterAutoAdjustment>' +
        '</tt:Extension><vendor:Night xmlns:vendor="urn:example">1</vendor:Night></tt:Extension>'
    )
    const { mock, device } = await connect({ overrides: { 'imaging.GetImagingSettings': answer(extended) } })
    const { imagingSettings } = await device.imaging.getImagingSettings({ videoSourceToken })
    expect(imagingSettings.extension).toEqual({
      imageStabilization: { mode: 'AUTO', level: 0.5 },
      extension: { irCutFilterAutoAdjustment: [{ boundaryType: 'ToOn', boundaryOffset: 0 }] },
      $any: { Night: '1' }
    })
    await device.imaging.setImagingSettings({ videoSourceToken, imagingSettings })
    expect(requestOf(mock, 'SetImagingSettings')).toEqual({
      SetImagingSettings: {
        VideoSourceToken: videoSourceToken,
        ImagingSettings: {
          Brightness: '50',
          Extension: {
            ImageStabilization: { Mode: 'AUTO', Level: '0.5' },
            Extension: { IrCutFilterAutoAdjustment: { BoundaryType: 'ToOn', BoundaryOffset: '0' } }
          }
        }
      }
    })
  })

  it('keeps numeric tokens and names as strings', async () => {
    const numeric = presets.replace('token="preset_1"', 'token="0"').replace('>Day<', '>007<')
    const { mock, device } = await connect({ overrides: { 'imaging.GetPresets': answer(numeric) } })
    expect(await device.imaging.forVideoSource('0').getPresets()).toEqual({
      preset: [{ token: '0', type: 'Sunny & Bright', name: '007' }]
    })
    expect(requestOf(mock, 'GetPresets')).toEqual({ GetPresets: { VideoSourceToken: '0' } })
  })

  it('reads a single mode as an array', async () => {
    const single = cam('imaging.GetOptions').replace(
      /<tt:IrCutFilterModes>ON<\/tt:IrCutFilterModes><tt:IrCutFilterModes>OFF<\/tt:IrCutFilterModes>/,
      ''
    )
    const { device } = await connect({ overrides: { 'imaging.GetOptions': answer(single) } })
    expect((await device.imaging.getOptions({ videoSourceToken })).imagingOptions.irCutFilterModes).toEqual(['AUTO'])
  })

  it('reads xs:boolean 1 and 0 as booleans', async () => {
    const numeric = cam('imaging.GetServiceCapabilities').replace(
      'Presets="false" ImageStabilization="false"',
      'Presets="1" ImageStabilization="0"'
    )
    const { device } = await connect({ overrides: { 'imaging.GetServiceCapabilities': answer(numeric) } })
    expect(await device.imaging.getServiceCapabilities()).toEqual({
      capabilities: { imageStabilization: false, presets: true }
    })
  })

  it('escapes the video source token and the enumerations', async () => {
    const { mock, device } = await connect()
    const injected = 'a</VideoSourceToken><x>'
    await device.imaging.setImagingSettings({ videoSourceToken: injected, imagingSettings: { irCutFilter: '<ON>' } })
    expect(requestOf(mock, 'SetImagingSettings')).toEqual({
      SetImagingSettings: { VideoSourceToken: injected, ImagingSettings: { IrCutFilter: '<ON>' } }
    })
    expect(rawRequestOf(mock, 'SetImagingSettings')).not.toContain('<x>')
  })
})

describe('imaging on the DCN-BM2220LPR', () => {
  it('reads the service capabilities without presets', async () => {
    const { device } = await connect()
    expect(await device.imaging.getServiceCapabilities()).toEqual({
      capabilities: { imageStabilization: false, presets: false }
    })
  })

  it('reads the settings as numbers and modes', async () => {
    const { device } = await connect()
    expect(await device.imaging.getImagingSettings({ videoSourceToken })).toEqual({
      imagingSettings: {
        brightness: 25,
        colorSaturation: 50,
        contrast: 50,
        exposure: {
          mode: 'AUTO',
          minExposureTime: 10_000,
          maxExposureTime: 100,
          minGain: 0,
          maxGain: 50,
          minIris: 0,
          maxIris: 13
        },
        focus: { autoFocusMode: 'MANUAL', defaultSpeed: 4 },
        irCutFilter: 'AUTO',
        sharpness: 50,
        whiteBalance: { mode: 'AUTO', crGain: 50, cbGain: 50 }
      }
    })
  })

  it('reads the options with every mode as an array and the white balance gains as YrGain and YbGain', async () => {
    const { device } = await connect()
    const { imagingOptions: options } = await device.imaging.getOptions({ videoSourceToken })
    expect(options.brightness).toEqual({ min: 0, max: 100 })
    expect(options.exposure?.mode).toEqual(['MANUAL', 'AUTO'])
    expect(options.focus?.autoFocusModes).toEqual(['AUTO', 'MANUAL'])
    expect(options.focus?.nearLimit).toEqual({ min: 0.300000012, max: 10 })
    expect(options.irCutFilterModes).toEqual(['ON', 'OFF', 'AUTO'])
    expect(options.whiteBalance).toEqual({
      mode: ['AUTO', 'MANUAL'],
      yrGain: { min: 0, max: 100 },
      ybGain: { min: 0, max: 100 }
    })
  })

  it('reads continuous focus as the only move', async () => {
    const { device } = await connect()
    expect(await device.imaging.getMoveOptions({ videoSourceToken })).toEqual({
      moveOptions: { continuous: { speed: { min: -8, max: 8 } } }
    })
    expect(await device.imaging.getStatus({ videoSourceToken })).toEqual({
      status: { focusStatus20: { position: 0, moveStatus: 'IDLE', error: 'success.' } }
    })
  })

  it('reads no current preset as an empty response', async () => {
    const { device } = await connect()
    expect(await device.imaging.getCurrentPreset({ videoSourceToken })).toEqual({})
  })

  it('reads a preset list without a preset as no array', async () => {
    const { device } = await connect()
    expect(await device.imaging.getPresets({ videoSourceToken })).toEqual({})
  })

  it('reports a missing video source as a SOAP fault with its subcodes', async () => {
    const { device } = await connect({
      overrides: { 'imaging.GetImagingSettings': answer(cam('imaging.GetImagingSettingsMissingFault'), 400) }
    })
    const error = await rejection(() => device.imaging.getImagingSettings({ videoSourceToken: 'missing' }))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({
      subcodes: ['InvalidArgVal', 'NoSource'],
      service: 'timg',
      action: 'GetImagingSettings'
    })
  })
})

describe('imaging on the Hikvision DS-2DE2C400IG-W-W', () => {
  const hikAnswers = (names: string[]): Record<string, ActionOverride> =>
    Object.fromEntries(names.map((name) => [`imaging.${name}`, answer(hik(`imaging.${name}`))]))

  it('reads the service capabilities without the presets attribute', async () => {
    const { device } = await connect({ overrides: hikAnswers(['GetServiceCapabilities']) })
    expect(await device.imaging.getServiceCapabilities()).toEqual({ capabilities: { imageStabilization: false } })
  })

  it('reads backlight compensation, wide dynamic range and noise reduction in the third extension', async () => {
    const { device } = await connect({ overrides: hikAnswers(['GetImagingSettings']) })
    const { imagingSettings } = await device.imaging.getImagingSettings({ videoSourceToken })
    expect(imagingSettings).toMatchObject({
      backlightCompensation: { mode: 'OFF' },
      focus: { autoFocusMode: 'MANUAL', defaultSpeed: 1 },
      wideDynamicRange: { mode: 'OFF' },
      whiteBalance: { mode: 'AUTO' },
      extension: { extension: { extension: { noiseReduction: { level: 0.5 } } } }
    })
  })

  it('sends the settings back with the noise reduction it read', async () => {
    const { mock, device } = await connect({ overrides: hikAnswers(['GetImagingSettings', 'SetImagingSettings']) })
    const { imagingSettings } = await device.imaging.getImagingSettings({ videoSourceToken })
    expect(await device.imaging.setImagingSettings({ videoSourceToken, imagingSettings })).toEqual({})
    expect(requestOf(mock, 'SetImagingSettings')).toMatchObject({
      SetImagingSettings: {
        ImagingSettings: {
          BacklightCompensation: { Mode: 'OFF' },
          Extension: { Extension: { Extension: { NoiseReduction: { Level: '0.5' } } } }
        }
      }
    })
  })

  it('reads one auto focus mode as an array and noise reduction options as a boolean', async () => {
    const { device } = await connect({ overrides: hikAnswers(['GetOptions']) })
    const { imagingOptions: options } = await device.imaging.getOptions({ videoSourceToken })
    expect(options.focus).toEqual({ autoFocusModes: ['MANUAL'], defaultSpeed: { min: 1, max: 1 } })
    expect(options.wideDynamicRange).toEqual({ mode: ['ON', 'OFF'], level: { min: 1, max: 100 } })
    expect(options.extension?.extension?.extension?.noiseReductionOptions).toEqual({ level: true })
  })

  it('reads a focus status of UNKNOWN with a position of 0.0', async () => {
    const { device } = await connect({ overrides: hikAnswers(['GetMoveOptions', 'GetStatus']) })
    expect(await device.imaging.getMoveOptions({ videoSourceToken })).toEqual({
      moveOptions: { continuous: { speed: { min: -7, max: 7 } } }
    })
    expect(await device.imaging.getStatus({ videoSourceToken })).toEqual({
      status: { focusStatus20: { position: 0, moveStatus: 'UNKNOWN', error: 'no error' } }
    })
  })

  it.each([
    ['GetPresets', 'getPresets', ['ActionNotSupported', 'InvalidOperation']],
    ['GetCurrentPreset', 'getCurrentPreset', ['ActionNotSupported', 'InvalidOperation']],
    ['GetImagingSettingsMissingFault', 'getImagingSettings', ['InvalidArgVal', 'NoSource']]
  ] as const)('reports the %s fault with its subcodes', async (name, method, subcodes) => {
    const action = name.replace(/MissingFault$/, '')
    const { device } = await connect({ overrides: { [`imaging.${action}`]: answer(hik(`imaging.${name}`), 500) } })
    const error = await rejection(() => device.imaging[method]({ videoSourceToken }))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes, service: 'timg', action })
  })
})

describe('imaging responses the schema does not allow', () => {
  it('rejects a preset with its token as an element instead of an attribute', async () => {
    const text = cam('imaging.GetCurrentPreset').replace(
      '<timg:GetCurrentPresetResponse></timg:GetCurrentPresetResponse>',
      '<timg:GetCurrentPresetResponse><timg:Preset><tt:token>main</tt:token><tt:type>128</tt:type>' +
        '<tt:Name>main</tt:Name></timg:Preset></timg:GetCurrentPresetResponse>'
    )
    const { device } = await connect({ overrides: { 'imaging.GetCurrentPreset': answer(text) } })
    const error = await rejection(() => device.imaging.getCurrentPreset({ videoSourceToken }))
    expect(error).toBeInstanceOf(DecodeError)
    expect(error).toMatchObject({ path: 'GetCurrentPresetResponse.Preset', action: 'GetCurrentPreset' })
  })

  it('rejects a brightness that is not a number with the path of the element', async () => {
    const text = cam('imaging.GetImagingSettings').replace('<tt:Brightness>25<', '<tt:Brightness>bright<')
    const { device } = await connect({ overrides: { 'imaging.GetImagingSettings': answer(text) } })
    const error = await rejection(() => device.imaging.getImagingSettings({ videoSourceToken }))
    expect(error).toBeInstanceOf(DecodeError)
    expect(error).toMatchObject({
      path: 'GetImagingSettingsResponse.ImagingSettings.Brightness',
      service: 'timg',
      action: 'GetImagingSettings'
    })
  })

  it('rejects a response without ImagingSettings', async () => {
    const missing = cam('imaging.GetImagingSettings').replace(
      /<timg:ImagingSettings>[\s\S]*<\/timg:ImagingSettings>/,
      ''
    )
    const { device } = await connect({ overrides: { 'imaging.GetImagingSettings': answer(missing) } })
    const error = await rejection(() => device.imaging.getImagingSettings({ videoSourceToken }))
    expect(error).toBeInstanceOf(DecodeError)
    expect((error as Error).message).toContain('ImagingSettings')
  })
})
