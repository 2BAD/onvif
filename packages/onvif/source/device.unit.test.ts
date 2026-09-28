import { afterEach, describe, expect, it, vi } from 'vitest'
import { type MockCamera, type MockCameraOptions, startMockCamera } from '../../../tools/mock-camera/server.ts'
import { type ConnectOptions, DEVICE_NAMESPACE, Device } from '#device.ts'
import { AuthError, DecodeError, OnvifError, SoapFaultError, TransportError } from '#errors.ts'
import { GetDeviceInformation, GetScopes } from '#generated/device.ts'

const MEDIA = 'http://www.onvif.org/ver10/media/wsdl'
const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  vi.useRealTimers()
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const camera = async (options?: MockCameraOptions): Promise<MockCamera> => {
  const mock = await startMockCamera(options)
  cleanups.push(() => mock.close())
  return mock
}

const connect = async (mock: MockCamera, options: Partial<ConnectOptions> = {}): Promise<Device> => {
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

const actions = (mock: MockCamera): string[] => mock.requests.map(({ action }) => action)

const rejection = async (action: () => Promise<unknown>): Promise<unknown> => {
  try {
    await action()
  } catch (error) {
    return error
  }
  throw new Error('Expected a rejection')
}

describe('Device.connect', () => {
  it('measures the clock skew, reads the service addresses and verifies the credentials', async () => {
    const mock = await camera({ clockSkewMs: 3_600_000 })
    const device = await connect(mock)
    expect(device.clock.source).toBe('device')
    expect(Math.abs(device.clock.skewMs - 3_600_000)).toBeLessThan(1_500)
    expect(device.services.get(DEVICE_NAMESPACE)?.href).toBe(`${mock.url}/onvif/device_service`)
    expect(device.services.get(MEDIA)?.href).toBe(`${mock.url}/onvif/Media`)
    expect(actions(mock)).toEqual(['GetSystemDateAndTime', 'GetServices', 'GetDeviceInformation'])
  })

  it('needs two round trips when credential verification is turned off', async () => {
    const mock = await camera()
    await connect(mock, { verifyCredentials: false })
    expect(actions(mock)).toEqual(['GetSystemDateAndTime', 'GetServices'])
  })

  it('rejects wrong credentials at connect even when the connect calls need no auth', async () => {
    const mock = await camera({ unauthenticated: ['device.GetSystemDateAndTime', 'device.GetServices'] })
    await expect(connect(mock, { password: 'wrong' })).rejects.toThrow(AuthError)
    const unchecked = await connect(mock, { password: 'wrong', verifyCredentials: false })
    await expect(unchecked.call(GetDeviceInformation)).rejects.toThrow(AuthError)
  })

  it('accepts a device that answers the verification with a fault other than an auth failure', async () => {
    const mock = await camera({ overrides: { 'device.GetDeviceInformation': { kind: 'status', status: 400 } } })
    await expect(connect(mock)).resolves.toBeInstanceOf(Device)
  })

  it('does not verify when no credentials are given', async () => {
    const mock = await camera({ auth: 'none' })
    const url = new URL(mock.url)
    const device = await Device.connect({ hostname: url.hostname, port: Number(url.port) })
    cleanups.push(() => device.close())
    expect(actions(mock)).toEqual(['GetSystemDateAndTime', 'GetServices'])
  })

  it('sends GetSystemDateAndTime without credentials first', async () => {
    const mock = await camera()
    await connect(mock)
    expect(mock.requests[0]?.body).not.toContain('UsernameToken')
  })

  it('retries GetSystemDateAndTime with credentials when the device requires them', async () => {
    const mock = await camera({ unauthenticated: [], clockSkewMs: -120_000 })
    const device = await connect(mock)
    expect(Math.abs(device.clock.skewMs + 120_000)).toBeLessThan(1_500)
    expect(actions(mock)).toEqual([
      'GetSystemDateAndTime',
      'GetSystemDateAndTime',
      'GetServices',
      'GetDeviceInformation'
    ])
  })

  it('falls back to the local clock when the device reports no UTC time', async () => {
    const mock = await camera({ utcTime: false })
    const device = await connect(mock)
    expect(device.clock).toEqual({ skewMs: 0, source: 'local' })
    await expect(device.call(GetDeviceInformation)).resolves.toMatchObject({ manufacturer: 'DVC' })
  })

  it('falls back to GetCapabilities when GetServices fails', async () => {
    const mock = await camera({ overrides: { 'device.GetServices': { kind: 'status', status: 400 } } })
    const device = await connect(mock)
    expect(actions(mock)).toEqual(['GetSystemDateAndTime', 'GetServices', 'GetCapabilities', 'GetDeviceInformation'])
    expect(device.services.get(MEDIA)?.href).toBe(`${mock.url}/onvif/Media`)
    expect(device.services.get('http://www.onvif.org/ver10/recording/wsdl')?.pathname).toBe('/onvif/Recording')
  })

  it('rejects wrong credentials', async () => {
    const mock = await camera()
    await expect(connect(mock, { password: 'wrong' })).rejects.toThrow(AuthError)
  })

  it('rejects wrong credentials over HTTP digest', async () => {
    const mock = await camera({ auth: 'digest', digestAlgorithm: 'SHA-256' })
    await expect(connect(mock, { password: 'wrong' })).rejects.toThrow(AuthError)
    const device = await connect(mock)
    await expect(device.call(GetDeviceInformation)).resolves.toMatchObject({ manufacturer: 'DVC' })
  })

  it('works without credentials on devices that allow it', async () => {
    const mock = await camera({ auth: 'none' })
    const url = new URL(mock.url)
    const device = await Device.connect({
      hostname: url.hostname,
      port: Number(url.port),
      signal: new AbortController().signal
    })
    cleanups.push(() => device.close())
    await expect(device.call(GetDeviceInformation)).resolves.toMatchObject({ manufacturer: 'DVC' })
    expect(mock.requests.every(({ body }) => !body.includes('UsernameToken'))).toBe(true)
  })

  it('fails when the device needs credentials for its clock and none are given', async () => {
    const mock = await camera({ unauthenticated: [] })
    const url = new URL(mock.url)
    await expect(Device.connect({ hostname: url.hostname, port: Number(url.port) })).rejects.toThrow(AuthError)
  })

  it('applies the timeout and response size options', async () => {
    const slow = await camera({ overrides: { 'device.GetServices': { kind: 'hang' } } })
    await expect(connect(slow, { timeoutMs: 100 })).rejects.toThrow('No response within 100 ms')
    const mock = await camera()
    await expect(connect(mock, { maxResponseBytes: 1024 })).rejects.toThrow(/exceeds 1024/)
  })

  it('applies the timeout of a call over the connection timeout', async () => {
    const mock = await camera({ overrides: { 'device.GetScopes': { kind: 'delay', ms: 200 } } })
    const device = await connect(mock, { timeoutMs: 100 })
    await expect(device.call(GetScopes, {}, { timeoutMs: 2_000 })).resolves.toHaveProperty('scopes')
    await expect(device.call(GetScopes, {}, { timeoutMs: 50 })).rejects.toThrow('No response within 50 ms')
  })

  it('connects over HTTPS with TLS options and formats IPv6 hosts', async () => {
    const mock = await camera()
    const port = Number(new URL(mock.url).port)
    const secure = await rejection(() =>
      Device.connect({ hostname: '127.0.0.1', port, secure: true, tls: { rejectUnauthorized: true } })
    )
    expect(secure).toBeInstanceOf(TransportError)
    const ipv6 = await rejection(() => Device.connect({ hostname: '::1', port: 9, timeoutMs: 1_000 }))
    expect(ipv6).toMatchObject({ host: '[::1]:9' })
  })

  it('stops when the caller aborts', async () => {
    const mock = await camera({ overrides: { 'device.GetSystemDateAndTime': { kind: 'hang' } } })
    const controller = new AbortController()
    const connecting = connect(mock, { signal: controller.signal })
    controller.abort(new Error('cancelled'))
    await expect(connecting).rejects.toThrow('cancelled')
  })
})

describe('service addresses', () => {
  it('rewrites addresses that point to another host by default', async () => {
    const mock = await camera({ advertisedHost: '10.0.0.5:8080' })
    const device = await connect(mock)
    expect(device.services.get(MEDIA)?.href).toBe(`${mock.url}/onvif/Media`)
  })

  it('drops them under the reject policy', async () => {
    const mock = await camera({ advertisedHost: '10.0.0.5:8080' })
    const device = await connect(mock, { serviceAddresses: 'reject' })
    expect(device.services.has(MEDIA)).toBe(false)
    expect(device.services.has(DEVICE_NAMESPACE)).toBe(true)
    expect(() => device.resolveAddress('http://10.0.0.5:8080/onvif/Media')).toThrow('is not the configured host')
  })

  it('keeps them under the trust policy', async () => {
    const mock = await camera({ advertisedHost: '10.0.0.5:8080' })
    const device = await connect(mock, { serviceAddresses: 'trust' })
    expect(device.services.get(MEDIA)?.href).toBe('http://10.0.0.5:8080/onvif/Media')
  })

  it('keeps a different port on the configured host', async () => {
    const mock = await camera()
    const device = await connect(mock)
    const host = new URL(mock.url).hostname
    expect(device.resolveAddress(`https://${host}:8443/onvif/events?id=1`).href).toBe(
      `https://${host}:8443/onvif/events?id=1`
    )
  })

  it('rejects invalid addresses and other protocols', async () => {
    const device = await connect(await camera())
    expect(() => device.resolveAddress('not a url')).toThrow("Invalid service address 'not a url'")
    expect(() => device.resolveAddress('ftp://127.0.0.1/x')).toThrow('Unsupported service address protocol ftp:')
  })
})

describe('Device.call', () => {
  it('returns typed responses and takes no request for operations without fields', async () => {
    const device = await connect(await camera())
    const information = await device.call(GetDeviceInformation)
    expect(information).toMatchObject({ manufacturer: 'DVC', model: 'DCN-BM2220LPR', firmwareVersion: '5.1' })
    expect((await device.call(GetScopes)).scopes.length).toBeGreaterThan(0)
  })

  it('sends the SOAP action in the Content-Type', async () => {
    const mock = await camera({ contentTypeAction: 'require' })
    const device = await connect(mock)
    await device.call(GetDeviceInformation)
    expect(mock.requests.at(-1)?.headers['content-type']).toBe(
      'application/soap+xml; charset=utf-8; action="http://www.onvif.org/ver10/device/wsdl/GetDeviceInformation"'
    )
  })

  it('retries without the action with a fresh nonce and keeps the action when that fails too', async () => {
    const body =
      '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><s:Fault><s:Code><s:Value>s:Sender' +
      '</s:Value><s:Subcode><s:Value>wsa5:ActionNotSupported</s:Value></s:Subcode></s:Code><s:Reason>' +
      '<s:Text xml:lang="en">The [action] cannot be processed at the receiver.</s:Text></s:Reason></s:Fault></s:Body>' +
      '</s:Envelope>'
    const mock = await camera({ overrides: { 'device.GetScopes': { kind: 'status', status: 400, body } } })
    const device = await connect(mock)
    await expect(device.call(GetScopes)).rejects.toMatchObject({ subcodes: ['ActionNotSupported'] })
    expect(actions(mock).slice(-2)).toEqual(['GetScopes', 'GetScopes'])
    const nonces = mock.requests.slice(-2).map(({ body: sent }) => /<wsse:Nonce[^>]*>([^<]+)</.exec(sent)?.[1])
    expect(nonces[0]).toBeDefined()
    expect(nonces[0]).not.toBe(nonces[1])
    await device.call(GetDeviceInformation)
    expect(mock.requests.at(-1)?.headers['content-type']).toContain('; action="')
  })

  it('drops the Content-Type action for good when the device rejects it', async () => {
    const mock = await camera({ contentTypeAction: 'reject' })
    const device = await connect(mock)
    await device.call(GetDeviceInformation)
    expect(mock.requests.at(-1)?.headers['content-type']).toBe('application/soap+xml; charset=utf-8')
    expect(actions(mock)).toEqual([
      'GetSystemDateAndTime',
      'GetSystemDateAndTime',
      'GetServices',
      'GetDeviceInformation',
      'GetDeviceInformation'
    ])
  })

  it('resynchronizes the clock once when the device clock changed', async () => {
    const mock = await camera()
    const device = await connect(mock)
    mock.setClockSkew(15 * 60 * 1000)
    await expect(device.call(GetDeviceInformation)).resolves.toMatchObject({ manufacturer: 'DVC' })
    expect(actions(mock).slice(3)).toEqual(['GetDeviceInformation', 'GetSystemDateAndTime', 'GetDeviceInformation'])
    expect(Math.abs(device.clock.skewMs - 15 * 60 * 1000)).toBeLessThan(1_500)
  })

  it('keeps valid timestamps when the local clock jumps after connecting', async () => {
    const mock = await camera()
    const device = await connect(mock)
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 6 * 3_600_000 })
    await expect(device.call(GetDeviceInformation)).resolves.toMatchObject({ manufacturer: 'DVC' })
    expect(actions(mock).slice(3)).toEqual(['GetDeviceInformation'])
  })

  it('adds WS-Addressing headers and sends to a reported address', async () => {
    const mock = await camera()
    const device = await connect(mock)
    await device.call(GetDeviceInformation, {}, { to: 'http://10.0.0.9/onvif/device_service', addressing: true })
    const { body, path } = mock.requests.at(-1) ?? { body: '', path: '' }
    expect(path).toBe('/onvif/device_service')
    expect(body).toContain(
      `<wsa:To xmlns:wsa="http://www.w3.org/2005/08/addressing" s:mustUnderstand="1">${mock.url}/onvif/device_service</wsa:To>`
    )
    expect(body).toContain('>http://www.onvif.org/ver10/device/wsdl/GetDeviceInformation</wsa:Action>')
    expect(body).toMatch(/<wsa:MessageID[^>]*>urn:uuid:[0-9a-f-]{36}<\/wsa:MessageID>/)
  })

  it('reports SOAP faults with context', async () => {
    const mock = await camera({ overrides: { 'device.GetScopes': { kind: 'status', status: 500 } } })
    const device = await connect(mock)
    await expect(device.call(GetScopes)).rejects.toMatchObject({
      name: 'SoapFaultError',
      subcodes: ['Action'],
      service: 'tds',
      action: 'GetScopes'
    })
    await expect(device.call(GetScopes)).rejects.toBeInstanceOf(SoapFaultError)
  })

  it.each([
    ['an empty 200 response', { kind: 'status', status: 200, body: '' }, /Empty response/],
    ['a non-SOAP error page', { kind: 'status', status: 502, body: 'Bad gateway' }, /Unexpected HTTP 502/],
    [
      'a SOAP body with an error status',
      {
        kind: 'status',
        status: 500,
        body: '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body/></s:Envelope>'
      },
      /Unexpected HTTP 500/
    ]
  ] as const)('raises TransportError for %s', async (_name, override, message) => {
    const mock = await camera({ overrides: { 'device.GetScopes': override } })
    const device = await connect(mock)
    const error = await rejection(() => device.call(GetScopes))
    expect(error).toBeInstanceOf(TransportError)
    expect((error as Error).message).toMatch(message)
  })

  it('raises AuthError for HTTP 401 with or without a SOAP body', async () => {
    const plain = await camera({
      auth: 'none',
      overrides: { 'device.GetScopes': { kind: 'status', status: 401, body: 'nope' } }
    })
    await expect((await connect(plain)).call(GetScopes)).rejects.toThrow('Not authorized (HTTP 401)')
    const soap = await camera({ auth: 'none', overrides: { 'device.GetScopes': { kind: 'status', status: 401 } } })
    await expect((await connect(soap)).call(GetScopes)).rejects.toThrow('Not authorized: Injected failure')
  })

  it('raises DecodeError when the response element is missing', async () => {
    const body = '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><Other/></s:Body></s:Envelope>'
    const mock = await camera({ overrides: { 'device.GetScopes': { kind: 'status', status: 200, body } } })
    await expect((await connect(mock)).call(GetScopes)).rejects.toThrow(DecodeError)
  })

  it('uses the namespace as service name in errors when it has no known prefix', async () => {
    const device = await connect(await camera())
    const custom = {
      ...GetScopes,
      name: 'Custom',
      request: { ...GetScopes.request, name: 'Custom', namespace: 'urn:custom' }
    }
    await expect(device.call(custom, {}, { to: `${device.address.href}` })).rejects.toMatchObject({
      service: 'urn:custom'
    })
  })

  it('refuses operations of services the device does not offer', async () => {
    const mock = await camera({ advertisedHost: '10.0.0.5' })
    const device = await connect(mock, { serviceAddresses: 'reject' })
    const media = { ...GetScopes, request: { ...GetScopes.request, namespace: MEDIA } }
    await expect(device.call(media)).rejects.toThrow(OnvifError)
    await expect(device.call(media)).rejects.toThrow(`The device does not offer the service ${MEDIA}`)
  })
})
