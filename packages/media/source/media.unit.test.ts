import { AuthError, DecodeError, Device, OnvifError, SoapFaultError, TimeoutError, TransportError } from '@2bad/onvif'
import { afterEach, describe, expect, it } from 'vitest'
import { fixture } from '../../../tools/fixtures/corpus.ts'
import {
  type ActionOverride,
  MOCK_JPEG,
  type MockCamera,
  type MockCameraOptions,
  startMockCamera
} from '../../../tools/mock-camera/server.ts'
import {
  defaultProfile,
  fetchSnapshot,
  getProfiles,
  getSnapshotUri,
  getStreamUri,
  getVideoEncoderConfigurations,
  getVideoSourceConfigurations
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

const connect = async (
  mock: MockCamera,
  options: { serviceAddresses?: 'rewrite' | 'reject' | 'sameHost'; timeoutMs?: number } = {}
): Promise<Device> => {
  const url = new URL(mock.url)
  const device = await Device.connect({
    hostname: url.hostname,
    port: Number(url.port),
    username: 'admin',
    password: 'password',
    ...options
  })
  cleanups.push(() => device.close())
  return device
}

const answer = (body: string): ActionOverride => ({ kind: 'status', status: 200, body })

const withoutMedia2: ActionOverride = answer(
  live('device.GetServices').replace(
    /<tds:Service><tds:Namespace>http:\/\/www\.onvif\.org\/ver20\/media\/wsdl<\/tds:Namespace>[\s\S]*?<\/tds:Service>/,
    ''
  )
)

const mediaOnly = (overrides: Record<string, ActionOverride> = {}): MockCameraOptions => ({
  overrides: { 'device.GetServices': withoutMedia2, ...overrides }
})

type UriFixture = 'media.GetSnapshotUri' | 'media.GetStreamUri' | 'media2.GetSnapshotUri' | 'media2.GetStreamUri'

const withUri = (name: UriFixture, uri: string): ActionOverride =>
  answer(live(name).replace(/<(tt|trt2):Uri>[^<]*/, `<$1:Uri>${uri}`))

const rejection = async (action: () => Promise<unknown>): Promise<unknown> => {
  try {
    await action()
  } catch (error) {
    return error
  }
  throw new Error('Expected a rejection')
}

const fault = (subcode: string, reason: string, status = 400): ActionOverride => ({
  kind: 'status',
  status,
  body:
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:ter="http://www.onvif.org/ver10/error">' +
    `<s:Body><s:Fault><s:Code><s:Value>s:Sender</s:Value><s:Subcode><s:Value>${subcode}</s:Value></s:Subcode>` +
    `</s:Code><s:Reason><s:Text xml:lang="en">${reason}</s:Text></s:Reason></s:Fault></s:Body></s:Envelope>`
})

const noProfile: ActionOverride = {
  kind: 'status',
  status: 400,
  body:
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:ter="http://www.onvif.org/ver10/error">' +
    '<s:Body><s:Fault><s:Code><s:Value>s:Sender</s:Value><s:Subcode><s:Value>ter:InvalidArgVal</s:Value><s:Subcode>' +
    '<s:Value>ter:NoProfile</s:Value></s:Subcode></s:Subcode></s:Code><s:Reason>' +
    '<s:Text xml:lang="en">The media profile does not exist.</s:Text></s:Reason></s:Fault></s:Body></s:Envelope>'
}

const mustUnderstand: ActionOverride = {
  kind: 'status',
  status: 500,
  body:
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><s:Fault><s:Code>' +
    '<s:Value>s:MustUnderstand</s:Value></s:Code><s:Reason><s:Text xml:lang="en">The data in element ' +
    "'Security' must be understood but cannot be processed</s:Text></s:Reason></s:Fault></s:Body></s:Envelope>"
}

const media1 = { service: 'media', token: 'profile1' } as const
const media2 = { service: 'media2', token: 'profile1' } as const

const requestBody = (mock: MockCamera, service: string, action: string): string =>
  mock.requests.find((request) => request.service === service && request.action === action)?.body ?? ''

const actionsOf = (mock: MockCamera, service: string): string[] =>
  mock.requests.filter((request) => request.service === service).map(({ action }) => action)

describe('getProfiles', () => {
  it('asks Media2 for every configuration and summarizes the video ones', async () => {
    const mock = await camera()
    const profiles = await getProfiles(await connect(mock))
    expect(profiles.map(({ token, name, fixed, service }) => ({ token, name, fixed, service }))).toEqual([
      { token: 'profile1', name: 'profile1', fixed: true, service: 'media2' },
      { token: 'profile2', name: 'profile2', fixed: true, service: 'media2' },
      { token: 'profile3', name: 'profile3', fixed: true, service: 'media2' }
    ])
    const [first] = profiles
    expect(first?.videoEncoder).toMatchObject({
      token: 'VideoEncode_token_1',
      name: 'VideoEncode_1',
      encoding: 'H264',
      resolution: { width: 1920, height: 1080 },
      quality: 3,
      frameRateLimit: 25,
      bitrateLimit: 3072,
      govLength: 100,
      service: 'media2'
    })
    expect(first?.videoSource).toMatchObject({ token: 'VideoSource_token_1', sourceToken: 'VideoSource_token_1' })
    expect(first?.service === 'media2' && first.reported.configurations?.audioEncoder?.encoding).toBe('PCMA')
    expect(requestBody(mock, 'media2', 'GetProfiles')).toContain('<tr2:Type>All</tr2:Type>')
    expect(actionsOf(mock, 'media')).toEqual([])
  })

  it('reports an H.265 encoder from Media2', async () => {
    const h265 = live('media2.GetProfiles').replace(
      '<tt:Encoding>H264</tt:Encoding>',
      '<tt:Encoding>H265</tt:Encoding>'
    )
    const mock = await camera({ overrides: { 'media2.GetProfiles': answer(h265) } })
    const [first] = await getProfiles(await connect(mock))
    expect(first?.videoEncoder?.encoding).toBe('H265')
  })

  it('leaves out what a profile does not have', async () => {
    const bare = live('media2.GetProfiles').replace(
      /(token="profile1">[\s\S]*?)<trt2:Configurations>[\s\S]*?<\/trt2:Configurations>/,
      '$1'
    )
    const noRateControl = bare.replace(/<tt:RateControl [\s\S]*?<\/tt:RateControl>/, '').replace(/ GovLength="\d+"/, '')
    const mock = await camera({ overrides: { 'media2.GetProfiles': answer(noRateControl) } })
    const [first, second] = await getProfiles(await connect(mock))
    expect(first).not.toHaveProperty('videoSource')
    expect(first).not.toHaveProperty('videoEncoder')
    expect(second?.videoEncoder).not.toHaveProperty('frameRateLimit')
    expect(second?.videoEncoder).not.toHaveProperty('govLength')
  })

  it('uses Media v1 when the device does not offer Media2', async () => {
    const mock = await camera(mediaOnly())
    const profiles = await getProfiles(await connect(mock))
    expect(profiles.map(({ token, service }) => ({ token, service }))).toEqual([
      { token: 'profile1', service: 'media' },
      { token: 'profile2', service: 'media' },
      { token: 'profile3', service: 'media' }
    ])
    expect(profiles[0]?.videoEncoder).toMatchObject({
      encoding: 'H264',
      resolution: { width: 1920, height: 1080 },
      quality: 3,
      frameRateLimit: 30,
      bitrateLimit: 3072,
      govLength: 120,
      service: 'media'
    })
    expect(profiles[0]?.service === 'media' && profiles[0].reported.videoEncoderConfiguration?.multicast.port).toBe(
      50554
    )
    expect(profiles[0]?.videoSource?.sourceToken).toBe('VideoSource_token_1')
    expect(actionsOf(mock, 'media2')).toEqual([])
  })

  it('names Media v1 MPEG-4 by its media subtype and takes its GOP length', async () => {
    const mpeg4 = live('media.GetProfiles').replace(
      /<tt:Encoding>H264<\/tt:Encoding>([\s\S]*?)<tt:H264><tt:GovLength>120<\/tt:GovLength><tt:H264Profile>Baseline<\/tt:H264Profile><\/tt:H264>/,
      '<tt:Encoding>MPEG4</tt:Encoding>$1<tt:MPEG4><tt:GovLength>30</tt:GovLength><tt:Mpeg4Profile>SP</tt:Mpeg4Profile></tt:MPEG4>'
    )
    const mjpeg = mpeg4.replace(
      /(token="profile2">[\s\S]*?)<tt:Encoding>H264<\/tt:Encoding>/,
      '$1<tt:Encoding>JPEG</tt:Encoding>'
    )
    const mock = await camera(mediaOnly({ 'media.GetProfiles': answer(mjpeg) }))
    const [first, second] = await getProfiles(await connect(mock))
    expect(first?.videoEncoder).toMatchObject({ encoding: 'MPV4-ES', govLength: 30 })
    expect(second?.videoEncoder?.encoding).toBe('JPEG')
    expect(second?.videoEncoder).not.toHaveProperty('govLength')
  })

  it.each([
    ['a MustUnderstand fault (D-Link)', mustUnderstand],
    ['an InvalidArgVal fault', fault('ter:InvalidArgVal', 'Unknown element Type')],
    ['an HTML error page', { kind: 'status', status: 500, body: '<html><body>Internal error</body></html>' }],
    [
      'a response without profile names',
      answer(live('media2.GetProfiles').replaceAll(/<trt2:Name>[^<]*<\/trt2:Name>/g, ''))
    ]
  ] satisfies [string, ActionOverride][])('falls back to Media v1 after %s from Media2', async (_name, override) => {
    const mock = await camera({ overrides: { 'media2.GetProfiles': override } })
    const profiles = await getProfiles(await connect(mock))
    expect(profiles.map(({ service }) => service)).toEqual(['media', 'media', 'media'])
    expect(actionsOf(mock, 'media2')).toEqual(['GetProfiles'])
  })

  it('does not fall back when Media2 rejects the credentials', async () => {
    const mock = await camera({
      overrides: { 'media2.GetProfiles': fault('ter:NotAuthorized', 'Sender not Authorized') }
    })
    const error = await rejection(async () => getProfiles(await connect(mock)))
    expect(error).toBeInstanceOf(AuthError)
    expect(error).toMatchObject({ service: 'tr2', action: 'GetProfiles' })
    expect(actionsOf(mock, 'media')).toEqual([])
  })

  it('does not fall back after a timeout', async () => {
    const mock = await camera({ overrides: { 'media2.GetProfiles': { kind: 'delay', ms: 500 } } })
    const device = await connect(mock)
    await expect(getProfiles(device, { timeoutMs: 100 })).rejects.toBeInstanceOf(TimeoutError)
    expect(actionsOf(mock, 'media')).toEqual([])
  })

  it('passes the Media2 error on when Media v1 is not available', async () => {
    const services = live('device.GetServices').replace(
      /<tds:Service><tds:Namespace>http:\/\/www\.onvif\.org\/ver10\/media\/wsdl<\/tds:Namespace>[\s\S]*?<\/tds:Service>/,
      ''
    )
    const mock = await camera({
      overrides: { 'device.GetServices': answer(services), 'media2.GetProfiles': mustUnderstand }
    })
    const error = await rejection(async () => getProfiles(await connect(mock)))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ code: 'MustUnderstand', service: 'tr2' })
  })

  it('fits Media2 and the fallback into one timeout', async () => {
    const mock = await camera({
      overrides: {
        'media2.GetProfiles': { ...mustUnderstand, delayMs: 200 },
        'media.GetProfiles': { kind: 'delay', ms: 200 }
      }
    })
    const device = await connect(mock)
    const error = await rejection(async () => getProfiles(device, { timeoutMs: 300 }))
    expect(error).toBeInstanceOf(TimeoutError)
    expect(error).toMatchObject({ service: 'trt', action: 'GetProfiles' })
    await expect(getProfiles(device, { timeoutMs: 1_000 })).resolves.toHaveLength(3)
  })

  it('stops at the connection timeout when the call sets none', async () => {
    const mock = await camera({
      overrides: {
        'media2.GetProfiles': { ...mustUnderstand, delayMs: 200 },
        'media.GetProfiles': { kind: 'delay', ms: 200 }
      }
    })
    await expect(getProfiles(await connect(mock, { timeoutMs: 300 }))).rejects.toBeInstanceOf(TimeoutError)
  })

  it('decodes the profiles of the upstream mock device', async () => {
    const mock = await camera(mediaOnly({ 'media.GetProfiles': answer(fixture('upstream/GetProfiles.xml').xml) }))
    const profiles = await getProfiles(await connect(mock))
    expect(profiles.length).toBeGreaterThan(0)
    expect(profiles[0]?.token).toBe('main')
  })

  it('returns a single profile as an array and keeps a numeric token a string (Illustra)', async () => {
    const xml = live('media.GetProfiles')
    const first = xml.indexOf('<trt:Profiles ')
    const second = xml.indexOf('<trt:Profiles ', first + 1)
    const end = xml.lastIndexOf('</trt:Profiles>') + '</trt:Profiles>'.length
    const single = (xml.slice(0, second) + xml.slice(end)).replace('token="profile1"', 'token="0"')
    const mock = await camera(mediaOnly({ 'media.GetProfiles': answer(single) }))
    const profiles = await getProfiles(await connect(mock))
    expect(profiles).toHaveLength(1)
    expect(profiles[0]?.token).toBe('0')
  })

  it('returns an empty list when the device has no profiles', async () => {
    const empty = live('media2.GetProfiles').replace(/<trt2:Profiles [\s\S]*<\/trt2:Profiles>/, '')
    const mock = await camera({ overrides: { 'media2.GetProfiles': answer(empty) } })
    expect(await getProfiles(await connect(mock))).toEqual([])
    const emptyV1 = live('media.GetProfiles').replace(/<trt:Profiles [\s\S]*<\/trt:Profiles>/, '')
    const v1 = await camera(mediaOnly({ 'media.GetProfiles': answer(emptyV1) }))
    expect(await getProfiles(await connect(v1))).toEqual([])
  })

  it('reads an HTML 401 page as an AuthError (Hikvision)', async () => {
    const page = '<html><head><title>Document Error: Unauthorized</title></head><body>Access Error: 401</body></html>'
    const mock = await camera(mediaOnly({ 'media.GetProfiles': { kind: 'status', status: 401, body: page } }))
    const error = await rejection(async () => getProfiles(await connect(mock)))
    expect(error).toBeInstanceOf(AuthError)
    expect(error).toMatchObject({ service: 'trt', action: 'GetProfiles' })
  })

  it('fails with the reason when the media service is unavailable', async () => {
    const mock = await camera({ advertisedHost: '10.0.0.5' })
    const error = await rejection(async () => getProfiles(await connect(mock, { serviceAddresses: 'reject' })))
    expect(error).toBeInstanceOf(OnvifError)
    expect((error as OnvifError).message).toMatch(/media\/wsdl is unavailable: .* not the configured origin/)
  })
})

describe('defaultProfile', () => {
  it('prefers a profile with a video source and an encoder, then one with a video source, then the first', async () => {
    const xml = live('media2.GetProfiles')
    const noEncoder = xml.replace(/(token="profile1">[\s\S]*?)<trt2:VideoEncoder [\s\S]*?<\/trt2:VideoEncoder>/, '$1')
    const mock = await camera({ overrides: { 'media2.GetProfiles': answer(noEncoder) } })
    const profiles = await getProfiles(await connect(mock))
    expect(profiles[0]?.videoEncoder).toBeUndefined()
    expect(defaultProfile(profiles)?.token).toBe('profile2')

    const sourceOnly = profiles.map(({ videoEncoder: _encoder, ...profile }) => profile)
    expect(defaultProfile(sourceOnly)?.token).toBe('profile1')
    const bare = sourceOnly.map(({ videoSource: _source, ...profile }) => profile).reverse()
    expect(defaultProfile(bare)?.token).toBe('profile3')
    expect(defaultProfile([])).toBeUndefined()
  })
})

describe('getVideoSourceConfigurations', () => {
  it('reads them from Media2, or from Media v1 without it', async () => {
    const mock = await camera()
    const configurations = await getVideoSourceConfigurations(await connect(mock))
    expect(configurations).toEqual([
      expect.objectContaining({
        token: 'VideoSource_token_1',
        sourceToken: 'VideoSource_token_1',
        bounds: { x: 0, y: 0, width: 1920, height: 1080 }
      })
    ])
    expect(actionsOf(mock, 'media2')).toEqual(['GetVideoSourceConfigurations'])

    const v1 = await camera(mediaOnly())
    const fromV1 = await getVideoSourceConfigurations(await connect(v1))
    expect(fromV1.map(({ token }) => token)).toEqual(['VideoSource_token_1'])
    expect(actionsOf(v1, 'media')).toEqual(['GetVideoSourceConfigurations'])
  })

  it('falls back to Media v1 after a fault from Media2', async () => {
    const mock = await camera({ overrides: { 'media2.GetVideoSourceConfigurations': mustUnderstand } })
    expect(await getVideoSourceConfigurations(await connect(mock))).toHaveLength(1)
    expect(actionsOf(mock, 'media')).toEqual(['GetVideoSourceConfigurations'])
  })

  it('returns an empty list when the device reports none', async () => {
    const empty = live('media2.GetVideoSourceConfigurations').replace(
      /<trt2:Configurations [\s\S]*<\/trt2:Configurations>/,
      ''
    )
    const mock = await camera({ overrides: { 'media2.GetVideoSourceConfigurations': answer(empty) } })
    expect(await getVideoSourceConfigurations(await connect(mock))).toEqual([])
  })
})

describe('getVideoEncoderConfigurations', () => {
  it('summarizes them from Media2, or from Media v1 without it', async () => {
    const mock = await camera()
    const encoders = await getVideoEncoderConfigurations(await connect(mock))
    expect(encoders.map(({ token, resolution, service }) => ({ token, ...resolution, service }))).toEqual([
      { token: 'VideoEncode_token_1', width: 1920, height: 1080, service: 'media2' },
      { token: 'VideoEncode_token_2', width: 1280, height: 720, service: 'media2' },
      { token: 'VideoEncode_token_3', width: 480, height: 240, service: 'media2' }
    ])

    const v1 = await camera(mediaOnly())
    const fromV1 = await getVideoEncoderConfigurations(await connect(v1))
    expect(fromV1[0]).toMatchObject({ token: 'VideoEncode_token_1', encoding: 'H264', service: 'media' })
    expect(fromV1[0]?.service === 'media' && fromV1[0].reported.sessionTimeout).toBeTypeOf('string')
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

describe('getSnapshotUri', () => {
  it('asks the service the profile came from', async () => {
    const mock = await camera()
    const device = await connect(mock)
    const [profile] = await getProfiles(device)
    const snapshot = await getSnapshotUri(device, profile ?? media2)
    expect(snapshot).toEqual({
      uri: new URL(`${mock.url}/snapshot.JPG`),
      reported: `${mock.url}/snapshot.JPG`,
      invalidAfterConnect: false,
      invalidAfterReboot: false,
      timeout: 'PT0S'
    })
    expect(requestBody(mock, 'media2', 'GetSnapshotUri')).toContain('<tr2:ProfileToken>profile1</tr2:ProfileToken>')
    expect(actionsOf(mock, 'media')).toEqual([])
  })

  it('returns the Media v1 address with the fields the device reported', async () => {
    const mock = await camera()
    const snapshot = await getSnapshotUri(await connect(mock), media1)
    expect(snapshot).toEqual({
      uri: new URL(`${mock.url}/snapshot.JPG`),
      reported: `${mock.url}/snapshot.JPG`,
      invalidAfterConnect: false,
      invalidAfterReboot: false,
      timeout: 'PT0S'
    })
    expect(requestBody(mock, 'media', 'GetSnapshotUri')).toContain('<trt:ProfileToken>profile1</trt:ProfileToken>')
  })

  it.each([media1, media2])('escapes the profile token on $service', async ({ service }) => {
    const mock = await camera()
    await getSnapshotUri(await connect(mock), { service, token: 'a<b&"c' })
    expect(requestBody(mock, service, 'GetSnapshotUri')).toContain('ProfileToken>a&lt;b&amp;"c</')
  })

  it.each([media1, media2])(
    'rewrites an address on another host to the configured origin on $service (NAT)',
    async (profile) => {
      const mock = await camera({ advertisedHost: '10.0.0.5:8080' })
      const snapshot = await getSnapshotUri(await connect(mock), profile)
      expect(snapshot.uri.href).toBe(`${mock.url}/snapshot.JPG`)
      expect(snapshot.reported).toBe('http://10.0.0.5:8080/snapshot.JPG')
    }
  )

  it('refuses an address on another host under the reject policy', async () => {
    const mock = await camera({
      overrides: {
        'media.GetSnapshotUri': withUri('media.GetSnapshotUri', 'http://10.0.0.5/s.jpg'),
        'media2.GetSnapshotUri': withUri('media2.GetSnapshotUri', 'http://10.0.0.5/s.jpg')
      }
    })
    const device = await connect(mock, { serviceAddresses: 'reject' })
    const error = await rejection(async () => getSnapshotUri(device, media1))
    expect(error).toBeInstanceOf(OnvifError)
    expect(error).toMatchObject({
      message: 'Snapshot address refused: Service address http://10.0.0.5 is not the configured origin',
      service: 'trt',
      action: 'GetSnapshotUri',
      cause: expect.any(OnvifError)
    })
    await expect(getSnapshotUri(device, media2)).rejects.toMatchObject({ service: 'tr2', action: 'GetSnapshotUri' })
  })

  it('refuses an address that is not HTTP', async () => {
    const mock = await camera({ overrides: { 'media.GetSnapshotUri': withUri('media.GetSnapshotUri', 'rtsp://x/s') } })
    await expect(getSnapshotUri(await connect(mock), media1)).rejects.toThrow(
      'Snapshot address refused: Unsupported service address protocol rtsp:'
    )
  })

  it.each([
    ['media.GetSnapshotUri', /<tt:Uri>[^<]*<\/tt:Uri>/, media1],
    ['media2.GetSnapshotUri', /<trt2:Uri>[^<]*<\/trt2:Uri>/, media2]
  ] as const)('fails with a DecodeError when %s has no address', async (name, uri, profile) => {
    const mock = await camera({ overrides: { [name]: answer(live(name).replace(uri, '')) } })
    const error = await rejection(async () => getSnapshotUri(await connect(mock), profile))
    expect(error).toBeInstanceOf(DecodeError)
    expect(error).toMatchObject({ action: 'GetSnapshotUri' })
  })

  it('passes a missing profile on as a SoapFaultError', async () => {
    const mock = await camera({ overrides: { 'media.GetSnapshotUri': noProfile, 'media2.GetSnapshotUri': noProfile } })
    const device = await connect(mock)
    const error = await rejection(async () => getSnapshotUri(device, { service: 'media', token: 'nope' }))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: ['InvalidArgVal', 'NoProfile'], action: 'GetSnapshotUri' })
    await expect(getSnapshotUri(device, { service: 'media2', token: 'nope' })).rejects.toBeInstanceOf(SoapFaultError)
  })
})

describe('getStreamUri', () => {
  it('asks Media2 for RTSP over TCP by default and treats the address as stable', async () => {
    const mock = await camera()
    const stream = await getStreamUri(await connect(mock), media2)
    expect(stream).toMatchObject({
      reported: 'rtsp://192.0.2.14:554/profile1',
      invalidAfterConnect: false,
      invalidAfterReboot: false,
      timeout: 'PT0S'
    })
    expect(stream.uri.href).toBe(`rtsp://${new URL(mock.url).hostname}:554/profile1`)
    expect(requestBody(mock, 'media2', 'GetStreamUri')).toContain(
      '<tr2:Protocol>RTSP</tr2:Protocol><tr2:ProfileToken>profile1</tr2:ProfileToken>'
    )
  })

  it.each([
    [{ protocol: 'UDP' }, 'RtspUnicast'],
    [{ protocol: 'HTTP' }, 'RtspOverHttp'],
    [{ protocol: 'RTSP', multicast: true }, 'RtspMulticast'],
    [{ protocol: 'UDP', multicast: true }, 'RtspMulticast']
  ] as const)('asks Media2 for %o as %s', async (options, protocol) => {
    const mock = await camera()
    await getStreamUri(await connect(mock), media2, options)
    expect(requestBody(mock, 'media2', 'GetStreamUri')).toContain(`<tr2:Protocol>${protocol}</tr2:Protocol>`)
  })

  it('refuses multicast over HTTP on Media2 without asking the device', async () => {
    const mock = await camera()
    const error = await rejection(async () =>
      getStreamUri(await connect(mock), media2, { protocol: 'HTTP', multicast: true })
    )
    expect(error).toBeInstanceOf(OnvifError)
    expect(error).toMatchObject({
      message: 'Media2 has no multicast stream over HTTP',
      service: 'tr2',
      action: 'GetStreamUri'
    })
    expect(actionsOf(mock, 'media2')).toEqual([])
  })

  it('asks Media v1 for unicast RTSP by default with namespaced stream setup elements (Pelco)', async () => {
    const mock = await camera()
    const stream = await getStreamUri(await connect(mock), media1)
    expect(stream).toMatchObject({ reported: 'rtsp://192.0.2.14:554/profile1', timeout: 'PT6S' })
    expect(stream.uri.href).toBe(`rtsp://${new URL(mock.url).hostname}:554/profile1`)
    expect(requestBody(mock, 'media', 'GetStreamUri')).toContain(
      '<trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol>' +
        '</tt:Transport></trt:StreamSetup><trt:ProfileToken>profile1</trt:ProfileToken>'
    )
  })

  it('sends the protocol and multicast to Media v1 as given', async () => {
    const mock = await camera()
    const device = await connect(mock)
    await getStreamUri(device, media1, { protocol: 'UDP', multicast: true })
    await getStreamUri(device, media1, { protocol: 'HTTP' })
    const bodies = mock.requests.filter(({ action }) => action === 'GetStreamUri').map(({ body }) => body)
    expect(bodies[0]).toContain('<tt:Stream>RTP-Multicast</tt:Stream><tt:Transport><tt:Protocol>UDP</tt:Protocol>')
    expect(bodies[1]).toContain('<tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>HTTP</tt:Protocol>')
  })

  it.each([
    ['keeps the scheme and port of another host (NAT)', 'rtsp://10.0.0.5:554/a?b=1', 'rtsp://HOST:554/a?b=1'],
    ['keeps RTSP on port 80 (IVSEC)', 'rtsp://10.0.0.5:80/ch1', 'rtsp://HOST:80/ch1'],
    ['keeps an HTTP tunnel address', 'http://10.0.0.5/profile1', 'http://HOST/profile1'],
    ['fills in a missing host', 'rtsp:///live', 'rtsp://HOST/live'],
    ['keeps RTSPS on the configured host', 'rtsps://127.0.0.1:322/x', 'rtsps://HOST:322/x']
  ])('%s', async (_name, reported, expected) => {
    const mock = await camera({
      overrides: {
        'media.GetStreamUri': withUri('media.GetStreamUri', reported),
        'media2.GetStreamUri': withUri('media2.GetStreamUri', reported)
      }
    })
    const device = await connect(mock)
    const host = device.address.hostname
    for (const profile of [media1, media2]) {
      const stream = await getStreamUri(device, profile)
      expect(stream.uri.href).toBe(expected.replace('HOST', host))
      expect(stream.reported).toBe(reported)
    }
  })

  it('keeps a stream address on the configured host under the reject policy and refuses another host', async () => {
    const mock = await camera({
      overrides: { 'media.GetStreamUri': withUri('media.GetStreamUri', 'rtsp://127.0.0.1:554/profile1') }
    })
    const device = await connect(mock, { serviceAddresses: 'reject' })
    const host = device.address.hostname
    expect((await getStreamUri(device, media1)).uri.href).toBe(`rtsp://${host}:554/profile1`)

    const other = await camera({
      overrides: { 'media2.GetStreamUri': withUri('media2.GetStreamUri', 'rtsp://10.0.0.5/a') }
    })
    const error = await rejection(async () =>
      getStreamUri(await connect(other, { serviceAddresses: 'reject' }), media2)
    )
    expect(error).toBeInstanceOf(OnvifError)
    expect(error).toMatchObject({
      message: 'Stream address host 10.0.0.5 is not the configured host',
      service: 'tr2',
      action: 'GetStreamUri'
    })
  })

  it.each([
    ['not a url', "Invalid stream address 'not a url'"],
    ['ftp://10.0.0.5/a', 'Unsupported stream address protocol ftp:']
  ])('refuses %s', async (reported, message) => {
    const mock = await camera({ overrides: { 'media.GetStreamUri': withUri('media.GetStreamUri', reported) } })
    await expect(getStreamUri(await connect(mock), media1)).rejects.toThrow(message)
  })

  it('passes a missing profile on as a SoapFaultError', async () => {
    const mock = await camera({ overrides: { 'media.GetStreamUri': noProfile, 'media2.GetStreamUri': noProfile } })
    const device = await connect(mock)
    await expect(getStreamUri(device, media1)).rejects.toBeInstanceOf(SoapFaultError)
    await expect(getStreamUri(device, media2)).rejects.toBeInstanceOf(SoapFaultError)
  })
})

describe('fetchSnapshot', () => {
  it('fetches the JPEG with HTTP Digest', async () => {
    const mock = await camera()
    const device = await connect(mock)
    const { uri } = await getSnapshotUri(device, media2)
    expect(await fetchSnapshot(device, uri)).toEqual(MOCK_JPEG)
    const authorizations = mock.requests
      .filter(({ service }) => service === 'snapshot')
      .map((r) => r.headers.authorization)
    expect(authorizations).toEqual([undefined, expect.stringMatching(/^Digest /)])
  })

  it('applies the service address policy to an address from elsewhere', async () => {
    const mock = await camera()
    const device = await connect(mock, { serviceAddresses: 'reject' })
    await expect(fetchSnapshot(device, new URL('http://10.0.0.5/snapshot.JPG'))).rejects.toThrow(
      'is not the configured origin'
    )
    expect(mock.requests.some(({ service }) => service === 'snapshot')).toBe(false)
  })

  it('rejects a body that is not a JPEG', async () => {
    const page = Buffer.from('<html><body>Please log in</body></html>')
    const mock = await camera({ snapshot: { contentType: 'text/htmlé', body: page } })
    const device = await connect(mock)
    const error = await rejection(async () => fetchSnapshot(device, new URL(`${mock.url}/snapshot.JPG`)))
    expect(error).toBeInstanceOf(TransportError)
    expect(error).toMatchObject({
      message: `Expected a JPEG snapshot, got ${page.length} bytes with Content-Type 'text/html?'`,
      service: 'trt',
      action: 'GET'
    })
  })

  it('rejects an empty body without a content type', async () => {
    const mock = await camera({ snapshot: { body: Buffer.alloc(0), contentType: '' } })
    const device = await connect(mock)
    await expect(fetchSnapshot(device, new URL(`${mock.url}/snapshot.JPG`))).rejects.toThrow(
      "Expected a JPEG snapshot, got 0 bytes with Content-Type ''"
    )
  })

  it('fails with an AuthError when the snapshot needs HTTP Basic', async () => {
    const mock = await camera({ snapshot: { auth: 'basic' } })
    const device = await connect(mock)
    await expect(fetchSnapshot(device, new URL(`${mock.url}/snapshot.JPG`))).rejects.toBeInstanceOf(AuthError)
  })
})
