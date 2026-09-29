import { AuthError, DecodeError, Device, OnvifError, SoapFaultError, TransportError } from '@2bad/onvif'
import { afterEach, describe, expect, it } from 'vitest'
import { fixture } from '../../../tools/fixtures/corpus.ts'
import {
  type ActionOverride,
  MOCK_JPEG,
  type MockCamera,
  type MockCameraOptions,
  startMockCamera
} from '../../../tools/mock-camera/server.ts'
import { defaultProfile, fetchSnapshot, getProfiles, getSnapshotUri, getStreamUri } from '#index.ts'

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

const connect = async (mock: MockCamera, serviceAddresses?: 'rewrite' | 'reject' | 'sameHost'): Promise<Device> => {
  const url = new URL(mock.url)
  const device = await Device.connect({
    hostname: url.hostname,
    port: Number(url.port),
    username: 'admin',
    password: 'password',
    ...(serviceAddresses ? { serviceAddresses } : {})
  })
  cleanups.push(() => device.close())
  return device
}

const answer = (body: string): ActionOverride => ({ kind: 'status', status: 200, body })

const withUri = (name: 'media.GetSnapshotUri' | 'media.GetStreamUri', uri: string): ActionOverride =>
  answer(live(name).replace(/<tt:Uri>[^<]*/, `<tt:Uri>${uri}`))

const rejection = async (action: () => Promise<unknown>): Promise<unknown> => {
  try {
    await action()
  } catch (error) {
    return error
  }
  throw new Error('Expected a rejection')
}

const noProfile: ActionOverride = {
  kind: 'status',
  status: 400,
  body:
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:ter="http://www.onvif.org/ver10/error">' +
    '<s:Body><s:Fault><s:Code><s:Value>s:Sender</s:Value><s:Subcode><s:Value>ter:InvalidArgVal</s:Value><s:Subcode>' +
    '<s:Value>ter:NoProfile</s:Value></s:Subcode></s:Subcode></s:Code><s:Reason>' +
    '<s:Text xml:lang="en">The media profile does not exist.</s:Text></s:Reason></s:Fault></s:Body></s:Envelope>'
}

const requestBody = (mock: MockCamera, action: string): string =>
  mock.requests.find((request) => request.action === action)?.body ?? ''

describe('getProfiles', () => {
  it('decodes every profile with typed configurations', async () => {
    const profiles = await getProfiles(await connect(await camera()))
    expect(profiles.map(({ token, name, fixed }) => ({ token, name, fixed }))).toEqual([
      { token: 'profile1', name: 'profile1', fixed: true },
      { token: 'profile2', name: 'profile2', fixed: true },
      { token: 'profile3', name: 'profile3', fixed: true }
    ])
    expect(profiles[0]?.videoEncoderConfiguration).toMatchObject({
      encoding: 'H264',
      resolution: { width: 1920, height: 1080 },
      rateControl: { frameRateLimit: 30, bitrateLimit: 3072 },
      multicast: { port: 50554, autoStart: false }
    })
    expect(profiles[0]?.videoSourceConfiguration?.sourceToken).toBe('VideoSource_token_1')
  })

  it('decodes the profiles of the upstream mock device', async () => {
    const mock = await camera({ overrides: { 'media.GetProfiles': answer(fixture('upstream/GetProfiles.xml').xml) } })
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
    const mock = await camera({ overrides: { 'media.GetProfiles': answer(single) } })
    const profiles = await getProfiles(await connect(mock))
    expect(profiles).toHaveLength(1)
    expect(profiles[0]?.token).toBe('0')
  })

  it('returns an empty list when the device has no profiles', async () => {
    const empty = live('media.GetProfiles').replace(/<trt:Profiles [\s\S]*<\/trt:Profiles>/, '')
    const mock = await camera({ overrides: { 'media.GetProfiles': answer(empty) } })
    expect(await getProfiles(await connect(mock))).toEqual([])
  })

  it('reads an HTML 401 page as an AuthError (Hikvision)', async () => {
    const page = '<html><head><title>Document Error: Unauthorized</title></head><body>Access Error: 401</body></html>'
    const mock = await camera({ overrides: { 'media.GetProfiles': { kind: 'status', status: 401, body: page } } })
    const error = await rejection(async () => getProfiles(await connect(mock)))
    expect(error).toBeInstanceOf(AuthError)
    expect(error).toMatchObject({ service: 'trt', action: 'GetProfiles' })
  })

  it('fails with the reason when the media service is unavailable', async () => {
    const mock = await camera({ advertisedHost: '10.0.0.5' })
    const error = await rejection(async () => getProfiles(await connect(mock, 'reject')))
    expect(error).toBeInstanceOf(OnvifError)
    expect((error as OnvifError).message).toMatch(/media\/wsdl is unavailable: .* not the configured origin/)
  })
})

describe('defaultProfile', () => {
  it('prefers a profile with a video source and an encoder, then one with a video source, then the first', async () => {
    const xml = live('media.GetProfiles')
    const noEncoder = xml.replace(
      /(token="profile1">[\s\S]*?)<tt:VideoEncoderConfiguration [\s\S]*?<\/tt:VideoEncoderConfiguration>/,
      '$1'
    )
    const mock = await camera({ overrides: { 'media.GetProfiles': answer(noEncoder) } })
    const profiles = await getProfiles(await connect(mock))
    expect(profiles[0]?.videoEncoderConfiguration).toBeUndefined()
    expect(defaultProfile(profiles)?.token).toBe('profile2')

    const sourceOnly = profiles.map(({ videoEncoderConfiguration: _encoder, ...profile }) => profile)
    expect(defaultProfile(sourceOnly)?.token).toBe('profile1')
    const bare = sourceOnly.map(({ videoSourceConfiguration: _source, ...profile }) => profile).reverse()
    expect(defaultProfile(bare)?.token).toBe('profile3')
    expect(defaultProfile([])).toBeUndefined()
  })
})

describe('getSnapshotUri', () => {
  it('returns the address with the fields the device reported', async () => {
    const mock = await camera()
    const snapshot = await getSnapshotUri(await connect(mock), 'profile1')
    expect(snapshot).toEqual({
      uri: new URL(`${mock.url}/snapshot.JPG`),
      reported: `${mock.url}/snapshot.JPG`,
      invalidAfterConnect: false,
      invalidAfterReboot: false,
      timeout: 'PT0S'
    })
    expect(requestBody(mock, 'GetSnapshotUri')).toContain('<trt:ProfileToken>profile1</trt:ProfileToken>')
  })

  it('escapes the profile token', async () => {
    const mock = await camera()
    await getSnapshotUri(await connect(mock), 'a<b&"c')
    expect(requestBody(mock, 'GetSnapshotUri')).toContain('<trt:ProfileToken>a&lt;b&amp;"c</trt:ProfileToken>')
  })

  it('rewrites an address on another host to the configured origin and keeps the reported one (NAT)', async () => {
    const mock = await camera({ advertisedHost: '10.0.0.5:8080' })
    const snapshot = await getSnapshotUri(await connect(mock), 'profile1')
    expect(snapshot.uri.href).toBe(`${mock.url}/snapshot.JPG`)
    expect(snapshot.reported).toBe('http://10.0.0.5:8080/snapshot.JPG')
  })

  it('refuses an address on another host under the reject policy', async () => {
    const mock = await camera({
      overrides: { 'media.GetSnapshotUri': withUri('media.GetSnapshotUri', 'http://10.0.0.5/s.jpg') }
    })
    const error = await rejection(async () => getSnapshotUri(await connect(mock, 'reject'), 'profile1'))
    expect(error).toBeInstanceOf(OnvifError)
    expect(error).toMatchObject({
      message: 'Snapshot address refused: Service address http://10.0.0.5 is not the configured origin',
      service: 'trt',
      action: 'GetSnapshotUri',
      cause: expect.any(OnvifError)
    })
  })

  it('refuses an address that is not HTTP', async () => {
    const mock = await camera({ overrides: { 'media.GetSnapshotUri': withUri('media.GetSnapshotUri', 'rtsp://x/s') } })
    await expect(getSnapshotUri(await connect(mock), 'profile1')).rejects.toThrow(
      'Snapshot address refused: Unsupported service address protocol rtsp:'
    )
  })

  it('fails with a DecodeError when the address is missing', async () => {
    const missing = live('media.GetSnapshotUri').replace(/<tt:Uri>[^<]*<\/tt:Uri>/, '')
    const mock = await camera({ overrides: { 'media.GetSnapshotUri': answer(missing) } })
    const error = await rejection(async () => getSnapshotUri(await connect(mock), 'profile1'))
    expect(error).toBeInstanceOf(DecodeError)
    expect(error).toMatchObject({ action: 'GetSnapshotUri' })
  })

  it('passes a missing profile on as a SoapFaultError', async () => {
    const mock = await camera({ overrides: { 'media.GetSnapshotUri': noProfile } })
    const error = await rejection(async () => getSnapshotUri(await connect(mock), 'nope'))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: ['InvalidArgVal', 'NoProfile'], action: 'GetSnapshotUri' })
  })
})

describe('getStreamUri', () => {
  it('asks for unicast RTSP by default with namespaced stream setup elements (Pelco)', async () => {
    const mock = await camera()
    const stream = await getStreamUri(await connect(mock), 'profile1')
    expect(stream).toMatchObject({ reported: 'rtsp://192.0.2.14:554/profile1', timeout: 'PT6S' })
    expect(stream.uri.href).toBe(`rtsp://${new URL(mock.url).hostname}:554/profile1`)
    expect(requestBody(mock, 'GetStreamUri')).toContain(
      '<trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol>' +
        '</tt:Transport></trt:StreamSetup><trt:ProfileToken>profile1</trt:ProfileToken>'
    )
  })

  it('sends the protocol and multicast as given', async () => {
    const mock = await camera()
    const device = await connect(mock)
    await getStreamUri(device, 'profile1', { protocol: 'UDP', multicast: true })
    await getStreamUri(device, 'profile1', { protocol: 'HTTP' })
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
    const mock = await camera({ overrides: { 'media.GetStreamUri': withUri('media.GetStreamUri', reported) } })
    const device = await connect(mock)
    const host = device.address.hostname
    const stream = await getStreamUri(device, 'profile1')
    expect(stream.uri.href).toBe(expected.replace('HOST', host))
    expect(stream.reported).toBe(reported)
  })

  it('keeps a stream address on the configured host under the reject policy and refuses another host', async () => {
    const mock = await camera({
      overrides: { 'media.GetStreamUri': withUri('media.GetStreamUri', 'rtsp://127.0.0.1:554/profile1') }
    })
    const device = await connect(mock, 'reject')
    const host = device.address.hostname
    expect((await getStreamUri(device, 'profile1')).uri.href).toBe(`rtsp://${host}:554/profile1`)

    const other = await camera({
      overrides: { 'media.GetStreamUri': withUri('media.GetStreamUri', 'rtsp://10.0.0.5/a') }
    })
    const error = await rejection(async () => getStreamUri(await connect(other, 'reject'), 'profile1'))
    expect(error).toBeInstanceOf(OnvifError)
    expect(error).toMatchObject({
      message: 'Stream address host 10.0.0.5 is not the configured host',
      service: 'trt',
      action: 'GetStreamUri'
    })
  })

  it.each([
    ['not a url', "Invalid stream address 'not a url'"],
    ['ftp://10.0.0.5/a', 'Unsupported stream address protocol ftp:']
  ])('refuses %s', async (reported, message) => {
    const mock = await camera({ overrides: { 'media.GetStreamUri': withUri('media.GetStreamUri', reported) } })
    await expect(getStreamUri(await connect(mock), 'profile1')).rejects.toThrow(message)
  })

  it('passes a missing profile on as a SoapFaultError', async () => {
    const mock = await camera({ overrides: { 'media.GetStreamUri': noProfile } })
    await expect(getStreamUri(await connect(mock), 'nope')).rejects.toBeInstanceOf(SoapFaultError)
  })
})

describe('fetchSnapshot', () => {
  it('fetches the JPEG with HTTP Digest', async () => {
    const mock = await camera()
    const device = await connect(mock)
    const { uri } = await getSnapshotUri(device, 'profile1')
    expect(await fetchSnapshot(device, uri)).toEqual(MOCK_JPEG)
    const authorizations = mock.requests
      .filter(({ service }) => service === 'snapshot')
      .map((r) => r.headers.authorization)
    expect(authorizations).toEqual([undefined, expect.stringMatching(/^Digest /)])
  })

  it('applies the service address policy to an address from elsewhere', async () => {
    const mock = await camera()
    const device = await connect(mock, 'reject')
    await expect(fetchSnapshot(device, new URL('http://10.0.0.5/snapshot.JPG'))).rejects.toThrow(
      'is not the configured origin'
    )
    expect(mock.requests.some(({ service }) => service === 'snapshot')).toBe(false)
  })

  it('rejects a body that is not a JPEG', async () => {
    const page = Buffer.from('<html><body>Please log in</body></html>')
    const mock = await camera({ snapshot: { contentType: 'text/html\u00e9', body: page } })
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
