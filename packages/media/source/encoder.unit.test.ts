import { Device, OnvifError, SoapFaultError } from '@2bad/onvif'
import { afterEach, describe, expect, it } from 'vitest'
import { fixture } from '../../../tools/fixtures/corpus.ts'
import {
  type ActionOverride,
  type MockCamera,
  type MockCameraOptions,
  startMockCamera
} from '../../../tools/mock-camera/server.ts'
import {
  getProfiles,
  getVideoEncoderConfigurationOptions,
  getVideoEncoderConfigurations,
  setVideoEncoderConfiguration,
  type VideoEncoder
} from '#index.ts'

const live = (name: string): string => fixture(`live/dvc/dcn-bm2220lpr/${name}.xml`).xml
const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const camera = async (options?: MockCameraOptions): Promise<MockCamera> => {
  const mock = await startMockCamera(options)
  cleanups.push(() => mock.close())
  return mock
}

const connect = async (mock: MockCamera): Promise<Device> => {
  const url = new URL(mock.url)
  const device = await Device.connect({
    hostname: url.hostname,
    port: Number(url.port),
    username: 'admin',
    password: 'password'
  })
  cleanups.push(() => device.close())
  return device
}

const answer = (body: string): ActionOverride => ({ kind: 'status', status: 200, body })

const mediaOnly = (overrides: Record<string, ActionOverride> = {}): MockCameraOptions => ({
  overrides: {
    'device.GetServices': answer(
      live('device.GetServices').replace(
        /<tds:Service><tds:Namespace>http:\/\/www\.onvif\.org\/ver20\/media\/wsdl<\/tds:Namespace>[\s\S]*?<\/tds:Service>/,
        ''
      )
    ),
    ...overrides
  }
})

const mustUnderstand: ActionOverride = {
  kind: 'status',
  status: 500,
  body:
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><s:Fault><s:Code>' +
    '<s:Value>s:MustUnderstand</s:Value></s:Code><s:Reason><s:Text xml:lang="en">The data in element ' +
    "'Security' must be understood but cannot be processed</s:Text></s:Reason></s:Fault></s:Body></s:Envelope>"
}

const configModify: ActionOverride = {
  kind: 'status',
  status: 400,
  body:
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:ter="http://www.onvif.org/ver10/error">' +
    '<s:Body><s:Fault><s:Code><s:Value>s:Sender</s:Value><s:Subcode><s:Value>ter:InvalidArgVal</s:Value><s:Subcode>' +
    '<s:Value>ter:ConfigModify</s:Value></s:Subcode></s:Subcode></s:Code><s:Reason>' +
    '<s:Text xml:lang="en">The configuration parameters are not possible to set.</s:Text></s:Reason></s:Fault>' +
    '</s:Body></s:Envelope>'
}

const rejection = async (action: () => Promise<unknown>): Promise<unknown> => {
  try {
    await action()
  } catch (error) {
    return error
  }
  throw new Error('Expected a rejection')
}

const requestBody = (mock: MockCamera, service: string, action: string): string =>
  mock.requests.find((request) => request.service === service && request.action === action)?.body ?? ''

const firstEncoder = async (mock: MockCamera): Promise<[Device, VideoEncoder]> => {
  const device = await connect(mock)
  const [encoder] = await getVideoEncoderConfigurations(device)
  if (!encoder) throw new Error('The mock camera reported no encoders')
  return [device, encoder]
}

describe('getVideoEncoderConfigurations', () => {
  it('summarizes them from Media2, or from Media v1 without it', async () => {
    const mock = await camera()
    const encoders = await getVideoEncoderConfigurations(await connect(mock))
    expect(encoders.map(({ token, resolution, service }) => ({ token, ...resolution, service }))).toEqual([
      { token: 'VideoEncode_token_1', width: 1920, height: 1080, service: 'media2' },
      { token: 'VideoEncode_token_2', width: 1280, height: 720, service: 'media2' },
      { token: 'VideoEncode_token_3', width: 480, height: 240, service: 'media2' }
    ])
    expect(encoders[0]).toMatchObject({ govLength: 100, profile: 'High' })

    const v1 = await camera(mediaOnly())
    const fromV1 = await getVideoEncoderConfigurations(await connect(v1))
    expect(fromV1[0]).toMatchObject({
      token: 'VideoEncode_token_1',
      encoding: 'H264',
      govLength: 120,
      profile: 'Baseline',
      service: 'media'
    })
    expect(fromV1[0]?.service === 'media' && fromV1[0].reported.sessionTimeout).toBe('PT60S')
  })

  it('names Media v1 MPEG-4 profiles as Media2 does', async () => {
    const mpeg4 = live('media.GetVideoEncoderConfigurations').replace(
      /<tt:Encoding>H264<\/tt:Encoding>([\s\S]*?)<tt:H264>[\s\S]*?<\/tt:H264>/,
      '<tt:Encoding>MPEG4</tt:Encoding>$1<tt:MPEG4><tt:GovLength>30</tt:GovLength><tt:Mpeg4Profile>ASP</tt:Mpeg4Profile></tt:MPEG4>'
    )
    const mock = await camera(mediaOnly({ 'media.GetVideoEncoderConfigurations': answer(mpeg4) }))
    const [encoder] = await getVideoEncoderConfigurations(await connect(mock))
    expect(encoder).toMatchObject({ encoding: 'MPV4-ES', govLength: 30, profile: 'AdvancedSimple' })
  })

  it('falls back to Media v1 after a fault from Media2', async () => {
    const mock = await camera({ overrides: { 'media2.GetVideoEncoderConfigurations': mustUnderstand } })
    const encoders = await getVideoEncoderConfigurations(await connect(mock))
    expect(encoders.map(({ service }) => service)).toContain('media')
  })

  it('returns an empty list when the device reports none', async () => {
    const empty = live('media.GetVideoEncoderConfigurations').replace(
      /<trt:Configurations [\s\S]*<\/trt:Configurations>/,
      ''
    )
    const mock = await camera(mediaOnly({ 'media.GetVideoEncoderConfigurations': answer(empty) }))
    expect(await getVideoEncoderConfigurations(await connect(mock))).toEqual([])
  })
})

describe('getVideoEncoderConfigurationOptions', () => {
  it('lists the options of each Media2 codec', async () => {
    const mock = await camera()
    const [device, encoder] = await firstEncoder(mock)
    const [h264, h265] = await getVideoEncoderConfigurationOptions(device, encoder)
    expect(h264).toEqual({
      encoding: 'H264',
      resolutions: [
        { width: 1920, height: 1080 },
        { width: 1280, height: 720 }
      ],
      qualityRange: { min: 1, max: 5 },
      frameRateRange: { min: 1, max: 25 },
      frameRates: Array.from({ length: 25 }, (_, index) => 25 - index),
      bitrateRange: { min: 512, max: 6144 },
      govLengthRange: { min: 1, max: 1500 },
      profiles: ['Base', 'Main', 'High']
    })
    expect(h265).toMatchObject({ encoding: 'H265', bitrateRange: { min: 256, max: 4096 } })
    expect(h265).not.toHaveProperty('profiles')
    expect(requestBody(mock, 'media2', 'GetVideoEncoderConfigurationOptions')).toContain(
      '<tr2:ConfigurationToken>VideoEncode_token_1</tr2:ConfigurationToken>'
    )
  })

  it('leaves out the Media2 options the device does not list', async () => {
    const bare = live('media2.GetVideoEncoderConfigurationOptions').replaceAll(
      / (?:ProfilesSupported|FrameRatesSupported|GovLengthRange)="[^"]*"/g,
      ''
    )
    const mock = await camera({ overrides: { 'media2.GetVideoEncoderConfigurationOptions': answer(bare) } })
    const [device, encoder] = await firstEncoder(mock)
    const [h264] = await getVideoEncoderConfigurationOptions(device, encoder)
    expect(Object.keys(h264 ?? {})).toEqual(['encoding', 'resolutions', 'qualityRange', 'bitrateRange'])
  })

  it('lists the options of the Media v1 codecs with the bitrate from the extension', async () => {
    const mock = await camera(mediaOnly())
    const [device, encoder] = await firstEncoder(mock)
    const options = await getVideoEncoderConfigurationOptions(device, encoder)
    expect(options).toEqual([
      {
        encoding: 'H264',
        resolutions: [
          { width: 1920, height: 1080 },
          { width: 1280, height: 720 }
        ],
        qualityRange: { min: 1, max: 5 },
        frameRateRange: { min: 1, max: 25 },
        bitrateRange: { min: 512, max: 6144 },
        govLengthRange: { min: 1, max: 1500 },
        profiles: ['Baseline', 'Main', 'High']
      }
    ])
    expect(requestBody(mock, 'media', 'GetVideoEncoderConfigurationOptions')).toContain(
      '<trt:ConfigurationToken>VideoEncode_token_1</trt:ConfigurationToken>'
    )
  })

  it('names Media v1 JPEG and MPEG-4 options as Media2 does', async () => {
    const resolution =
      '<tt:ResolutionsAvailable><tt:Width>640</tt:Width><tt:Height>480</tt:Height></tt:ResolutionsAvailable>'
    const range = (name: string, min: number, max: number) =>
      `<tt:${name}><tt:Min>${min}</tt:Min><tt:Max>${max}</tt:Max></tt:${name}>`
    const codecs =
      `<tt:JPEG>${resolution}${range('FrameRateRange', 1, 15)}${range('EncodingIntervalRange', 1, 1)}</tt:JPEG>` +
      `<tt:MPEG4>${resolution}${range('GovLengthRange', 1, 60)}${range('FrameRateRange', 1, 30)}` +
      `${range('EncodingIntervalRange', 1, 1)}<tt:Mpeg4ProfilesSupported>SP</tt:Mpeg4ProfilesSupported>` +
      '<tt:Mpeg4ProfilesSupported>ASP</tt:Mpeg4ProfilesSupported></tt:MPEG4>'
    const xml = live('media.GetVideoEncoderConfigurationOptions').replace(/<tt:H264>[\s\S]*<\/tt:Extension>/, codecs)
    const mock = await camera(mediaOnly({ 'media.GetVideoEncoderConfigurationOptions': answer(xml) }))
    const [device, encoder] = await firstEncoder(mock)
    expect(await getVideoEncoderConfigurationOptions(device, encoder)).toEqual([
      {
        encoding: 'JPEG',
        resolutions: [{ width: 640, height: 480 }],
        qualityRange: { min: 1, max: 5 },
        frameRateRange: { min: 1, max: 15 }
      },
      {
        encoding: 'MPV4-ES',
        resolutions: [{ width: 640, height: 480 }],
        qualityRange: { min: 1, max: 5 },
        frameRateRange: { min: 1, max: 30 },
        govLengthRange: { min: 1, max: 60 },
        profiles: ['Simple', 'AdvancedSimple']
      }
    ])
  })
})

describe('setVideoEncoderConfiguration', () => {
  it('sends the Media2 configuration with the changes and keeps the rest', async () => {
    const mock = await camera()
    const [device, encoder] = await firstEncoder(mock)
    const changed = await setVideoEncoderConfiguration(device, encoder, {
      resolution: { width: 1280, height: 720 },
      quality: 4,
      frameRateLimit: 15,
      bitrateLimit: 2048,
      govLength: 50
    })
    expect(changed).toMatchObject({
      token: 'VideoEncode_token_1',
      encoding: 'H264',
      resolution: { width: 1280, height: 720 },
      quality: 4,
      frameRateLimit: 15,
      bitrateLimit: 2048,
      govLength: 50,
      profile: 'High',
      service: 'media2'
    })
    const body = requestBody(mock, 'media2', 'SetVideoEncoderConfiguration')
    expect(body).toMatch(/<tr2:Configuration [^>]*token="VideoEncode_token_1"/)
    expect(body).toMatch(/<tr2:Configuration [^>]*GovLength="50"/)
    expect(body).toMatch(/<tr2:Configuration [^>]*Profile="High"/)
    expect(body).toContain('<tt:Resolution><tt:Width>1280</tt:Width><tt:Height>720</tt:Height></tt:Resolution>')
    expect(body).toMatch(/<tt:RateControl[^>]*><tt:FrameRateLimit>15<\/tt:FrameRateLimit><tt:BitrateLimit>2048</)
    expect(body).toContain('<tt:Multicast>')
    expect(body).toContain('<tt:Quality>4</tt:Quality>')
  })

  it('drops the Media2 codec profile when the codec changes, unless one is given', async () => {
    const mock = await camera()
    const [device, encoder] = await firstEncoder(mock)
    const h265 = await setVideoEncoderConfiguration(device, encoder, { encoding: 'H265' })
    expect(h265).not.toHaveProperty('profile')
    expect(requestBody(mock, 'media2', 'SetVideoEncoderConfiguration')).not.toContain('Profile=')
    const main = await setVideoEncoderConfiguration(device, encoder, { encoding: 'H265', profile: 'Main' })
    expect(main).toMatchObject({ encoding: 'H265', profile: 'Main' })
    const same = await setVideoEncoderConfiguration(device, encoder, { encoding: 'H264' })
    expect(same.profile).toBe('High')
  })

  it('sends the Media v1 configuration with the changes and asks to persist it', async () => {
    const mock = await camera(mediaOnly())
    const device = await connect(mock)
    const [profile] = await getProfiles(device)
    if (!profile?.videoEncoder) throw new Error('The mock camera reported no encoder')
    const changed = await setVideoEncoderConfiguration(device, profile.videoEncoder, { quality: 5, profile: 'Main' })
    expect(changed).toMatchObject({ quality: 5, profile: 'Main', govLength: 120, service: 'media' })
    const body = requestBody(mock, 'media', 'SetVideoEncoderConfiguration')
    expect(body).toContain('<tt:H264><tt:GovLength>120</tt:GovLength><tt:H264Profile>Main</tt:H264Profile></tt:H264>')
    expect(body).toContain('<trt:ForcePersistence>true</trt:ForcePersistence>')
    expect(body).toContain('<tt:SessionTimeout>PT60S</tt:SessionTimeout>')
  })

  it('switches Media v1 to MPEG-4 only with a GOP length and a profile', async () => {
    const mock = await camera(mediaOnly())
    const [device, encoder] = await firstEncoder(mock)
    const error = await rejection(async () => setVideoEncoderConfiguration(device, encoder, { encoding: 'MPV4-ES' }))
    expect(error).toBeInstanceOf(OnvifError)
    expect(error).toMatchObject({
      message: 'Media v1 needs govLength and profile for MPV4-ES',
      service: 'trt',
      action: 'SetVideoEncoderConfiguration'
    })
    expect(mock.requests.some(({ action }) => action === 'SetVideoEncoderConfiguration')).toBe(false)

    const mpeg4 = await setVideoEncoderConfiguration(device, encoder, {
      encoding: 'MPV4-ES',
      govLength: 30,
      profile: 'Simple'
    })
    expect(mpeg4).toMatchObject({ encoding: 'MPV4-ES', govLength: 30, profile: 'Simple' })
    expect(requestBody(mock, 'media', 'SetVideoEncoderConfiguration')).toContain('<tt:Encoding>MPEG4</tt:Encoding>')
    expect(requestBody(mock, 'media', 'SetVideoEncoderConfiguration')).toContain(
      '<tt:MPEG4><tt:GovLength>30</tt:GovLength><tt:Mpeg4Profile>SP</tt:Mpeg4Profile></tt:MPEG4>'
    )
  })

  it('keeps the Media v1 MPEG-4 settings and needs them for H264', async () => {
    const mpeg4 = live('media.GetVideoEncoderConfigurations').replace(
      /<tt:Encoding>H264<\/tt:Encoding>([\s\S]*?)<tt:H264>[\s\S]*?<\/tt:H264>/,
      '<tt:Encoding>MPEG4</tt:Encoding>$1<tt:MPEG4><tt:GovLength>30</tt:GovLength><tt:Mpeg4Profile>ASP</tt:Mpeg4Profile></tt:MPEG4>'
    )
    const mock = await camera(mediaOnly({ 'media.GetVideoEncoderConfigurations': answer(mpeg4) }))
    const [device, encoder] = await firstEncoder(mock)
    expect(await setVideoEncoderConfiguration(device, encoder, { govLength: 60 })).toMatchObject({
      govLength: 60,
      profile: 'AdvancedSimple'
    })
    await expect(setVideoEncoderConfiguration(device, encoder, { encoding: 'H264' })).rejects.toThrow(
      'Media v1 needs govLength and profile for H264'
    )
  })

  it('switches Media v1 to JPEG and refuses a GOP length for it', async () => {
    const mock = await camera(mediaOnly())
    const [device, encoder] = await firstEncoder(mock)
    expect(await setVideoEncoderConfiguration(device, encoder, { encoding: 'JPEG' })).toMatchObject({
      encoding: 'JPEG'
    })
    await expect(setVideoEncoderConfiguration(device, encoder, { encoding: 'JPEG', govLength: 10 })).rejects.toThrow(
      'Media v1 has no GOP length or profile for JPEG'
    )
  })

  it('refuses a rate change for an encoder without rate control', async () => {
    const noRateControl = live('media2.GetVideoEncoderConfigurations').replace(
      /<tt:RateControl [\s\S]*?<\/tt:RateControl>/,
      ''
    )
    const mock = await camera({ overrides: { 'media2.GetVideoEncoderConfigurations': answer(noRateControl) } })
    const [device, encoder] = await firstEncoder(mock)
    const error = await rejection(async () => setVideoEncoderConfiguration(device, encoder, { frameRateLimit: 10 }))
    expect(error).toBeInstanceOf(OnvifError)
    expect(error).toMatchObject({ message: 'The encoder reports no rate control to change', service: 'tr2' })
    expect(await setVideoEncoderConfiguration(device, encoder, { quality: 2 })).not.toHaveProperty('frameRateLimit')
  })

  it('passes a refused configuration on as a SoapFaultError', async () => {
    const mock = await camera({ overrides: { 'media2.SetVideoEncoderConfiguration': configModify } })
    const [device, encoder] = await firstEncoder(mock)
    const error = await rejection(async () => setVideoEncoderConfiguration(device, encoder, { quality: 9 }))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({
      subcodes: ['InvalidArgVal', 'ConfigModify'],
      service: 'tr2',
      action: 'SetVideoEncoderConfiguration'
    })
  })
})
