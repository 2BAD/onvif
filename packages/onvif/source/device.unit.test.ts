import { getEventListeners, once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer as createHttpsServer } from 'node:https'
import { type AddressInfo, createServer } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type ActionOverride,
  type MockCamera,
  type MockCameraOptions,
  MOCK_JPEG,
  startMockCamera
} from '../../../tools/mock-camera/server.ts'
import { fixture } from '../../../tools/fixtures/corpus.ts'
import { type ConnectOptions, DEVICE_NAMESPACE, Device } from '#device.ts'
import { AuthError, DecodeError, OnvifError, SoapFaultError, TimeoutError, TransportError } from '#errors.ts'
import { GetDeviceInformation, GetHostname, GetScopes, SystemReboot } from '#generated/device.ts'
import { namespaceInfo, parseXml, type XmlObject } from '#soap/parse.ts'

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

type HostnameOptions = Extract<ConnectOptions, { hostname: string }>

const connect = async (mock: MockCamera, options: Partial<HostnameOptions> = {}): Promise<Device> => {
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

// Moves the wall and monotonic clocks of host and mock camera a minute ahead, then sets the device clock skew.
const aMinuteLater = (mock: MockCamera, skewMs = 0): void => {
  const monotonic = performance.now.bind(performance)
  const wall = Date.now.bind(Date)
  const spies = [
    vi.spyOn(performance, 'now').mockImplementation(() => monotonic() + 60_000),
    vi.spyOn(Date, 'now').mockImplementation(() => wall() + 60_000)
  ]
  cleanups.push(() => {
    for (const spy of spies) spy.mockRestore()
  })
  mock.setClockSkew(skewMs)
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

  it('closes when a using block ends', async () => {
    const device = await connect(await camera())
    const close = vi.spyOn(device, 'close')
    {
      using scoped = device
      expect(scoped.services.size).toBeGreaterThan(0)
    }
    expect(close).toHaveBeenCalledOnce()
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

  it.each([1, 999])(
    'estimates the skew within half a second when the device time is %i ms into a second',
    async (millisecond) => {
      const skewMs = 3_600_000
      const base = performance.now()
      const frozen = base + ((((millisecond - ((performance.timeOrigin + base) % 1_000)) % 1_000) + 1_000) % 1_000)
      const spies = [
        vi.spyOn(performance, 'now').mockReturnValue(frozen),
        vi.spyOn(Date, 'now').mockReturnValue(performance.timeOrigin + frozen)
      ]
      cleanups.push(() => {
        for (const spy of spies) spy.mockRestore()
      })
      const device = await connect(await camera({ clockSkewMs: skewMs }))
      expect(Math.abs(device.clock.skewMs - skewMs)).toBeLessThanOrEqual(500)
    }
  )

  it('falls back to the local clock when the device reports no UTC time', async () => {
    const mock = await camera({ utcTime: false })
    const device = await connect(mock)
    expect(device.clock).toEqual({ skewMs: 0, source: 'local' })
    await expect(device.call(GetDeviceInformation)).resolves.toMatchObject({ manufacturer: 'DVC' })
  })

  it.each([
    ['month 13', 'Month', '13'],
    ['September 31', 'Day', '31'],
    ['hour 24', 'Hour', '24'],
    ['second 60', 'Second', '60']
  ])('rejects a device UTC time with %s instead of rolling it over', async (_name, field, value) => {
    const xml = fixture('live/dvc/dcn-bm2220lpr/device.GetSystemDateAndTime.xml').xml
    const body = xml.replace(/<tt:UTCDateTime>[\s\S]*?<\/tt:UTCDateTime>/, (block) =>
      block.replace(new RegExp(`<tt:${field}>\\d+</tt:${field}>`), `<tt:${field}>${value}</tt:${field}>`)
    )
    expect(body).not.toBe(xml)
    const mock = await camera({ overrides: { 'device.GetSystemDateAndTime': { kind: 'status', status: 200, body } } })
    const error = await rejection(() => connect(mock))
    expect(error).toBeInstanceOf(DecodeError)
    expect(error).toMatchObject({
      path: 'GetSystemDateAndTimeResponse.SystemDateAndTime.UTCDateTime',
      action: 'GetSystemDateAndTime'
    })
  })

  it('falls back to GetCapabilities when GetServices fails', async () => {
    const mock = await camera({ overrides: { 'device.GetServices': { kind: 'status', status: 400 } } })
    const device = await connect(mock)
    expect(actions(mock)).toEqual(['GetSystemDateAndTime', 'GetServices', 'GetCapabilities', 'GetDeviceInformation'])
    expect(device.services.get(MEDIA)?.href).toBe(`${mock.url}/onvif/Media`)
    expect(device.services.get('http://www.onvif.org/ver10/recording/wsdl')?.pathname).toBe('/onvif/Recording')
  })

  const servicesEnvelope = (services: string): string =>
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body>' +
    `<tds:GetServicesResponse xmlns:tds="http://www.onvif.org/ver10/device/wsdl">${services}</tds:GetServicesResponse>` +
    '</s:Body></s:Envelope>'

  const deviceServiceOnly = servicesEnvelope(
    `<tds:Service><tds:Namespace>${DEVICE_NAMESPACE}</tds:Namespace><tds:XAddr>http://192.0.2.14/onvif/device_service</tds:XAddr>` +
      '<tds:Version><tds:Major>2</tds:Major><tds:Minor>0</tds:Minor></tds:Version></tds:Service>'
  )

  it.each<[string, ActionOverride]>([
    ['an HTTP error with a plain body', { kind: 'status', status: 404, body: 'Not Found' }],
    ['an HTML page', { kind: 'status', status: 200, body: '<html><body>Not Found</body></html>' }],
    ['malformed XML', { kind: 'status', status: 200, body: '<s:Envelope><s:Body>' }],
    [
      'a response that does not match the schema',
      {
        kind: 'status',
        status: 200,
        body: servicesEnvelope('<tds:Service><tds:Namespace>x</tds:Namespace></tds:Service>')
      }
    ],
    ['a list without any service but the device service', { kind: 'status', status: 200, body: deviceServiceOnly }]
  ])('falls back to GetCapabilities after %s from GetServices', async (_name, override) => {
    const mock = await camera({ overrides: { 'device.GetServices': override } })
    const device = await connect(mock)
    expect(actions(mock)).toEqual(['GetSystemDateAndTime', 'GetServices', 'GetCapabilities', 'GetDeviceInformation'])
    expect(device.services.get(MEDIA)?.href).toBe(`${mock.url}/onvif/Media`)
  })

  it('does not fall back to GetCapabilities when GetServices times out or is not authorized', async () => {
    const slow = await camera({ overrides: { 'device.GetServices': { kind: 'hang' } } })
    await expect(connect(slow, { timeoutMs: 100 })).rejects.toThrow(TimeoutError)
    expect(actions(slow)).not.toContain('GetCapabilities')
    const denied = await camera({ overrides: { 'device.GetServices': { kind: 'status', status: 401, body: '' } } })
    await expect(connect(denied)).rejects.toThrow(AuthError)
    expect(actions(denied)).not.toContain('GetCapabilities')
  })

  it('keeps a service list without other services when GetCapabilities fails too', async () => {
    const mock = await camera({
      overrides: {
        'device.GetServices': { kind: 'status', status: 200, body: deviceServiceOnly },
        'device.GetCapabilities': { kind: 'status', status: 500 }
      }
    })
    const device = await connect(mock)
    expect([...device.services.keys()]).toEqual([DEVICE_NAMESPACE])
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
    expect(device.timeoutMs).toBe(100)
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

  it.each<[string, Partial<HostnameOptions>]>([
    ['a hostname URL syntax rejects', { hostname: 'bad host' }],
    ['an empty hostname', { hostname: '' }],
    ['a hostname with credentials', { hostname: 'admin@192.0.2.1' }],
    ['a hostname with a path', { hostname: '192.0.2.1/onvif' }],
    ['a hostname with a fragment', { hostname: '192.0.2.1#' }],
    ['a port out of range', { hostname: '192.0.2.1', port: 70_000 }],
    ['a port that is not an integer', { hostname: '192.0.2.1', port: 80.5 }]
  ])('refuses %s with an OnvifError before sending anything', async (_name, options) => {
    const error = await rejection(() => Device.connect({ hostname: '', ...options }))
    expect(error).toBeInstanceOf(OnvifError)
    expect(error).toMatchObject({ message: expect.stringMatching(/^Invalid device address '/) })
  })

  it('connects to a device service URL such as an XAddr from discovery', async () => {
    const mock = await camera()
    const options = { username: 'admin', password: 'password' }
    const fromString = await Device.connect({ url: `${mock.url}/onvif/device_service`, ...options })
    cleanups.push(() => fromString.close())
    expect(fromString.address.href).toBe(`${mock.url}/onvif/device_service`)
    const fromOrigin = await Device.connect({ url: new URL(mock.url), ...options })
    cleanups.push(() => fromOrigin.close())
    expect(fromOrigin.address.href).toBe(`${mock.url}/onvif/device_service`)
  })

  it('keeps the query of a device service URL', async () => {
    const mock = await camera()
    const device = await Device.connect({
      url: `${mock.url}/onvif/device_service?channel=1`,
      username: 'admin',
      password: 'password'
    })
    cleanups.push(() => device.close())
    expect(device.address.search).toBe('?channel=1')
  })

  it('uses HTTPS and IPv6 hosts from a device service URL', async () => {
    const mock = await camera()
    const secure = await rejection(() =>
      Device.connect({ url: mock.url.replace('http:', 'https:'), tls: { rejectUnauthorized: true } })
    )
    expect(secure).toBeInstanceOf(TransportError)
    const ipv6 = await rejection(() => Device.connect({ url: 'http://[::1]:9/onvif/device_service', timeoutMs: 1_000 }))
    expect(ipv6).toMatchObject({ host: '[::1]:9' })
  })

  it.each([
    ['a URL that does not parse', 'not a url'],
    ['a scheme other than HTTP', 'ftp://192.0.2.1/onvif/device_service']
  ])('refuses %s with an OnvifError', async (_name, url) => {
    const error = await rejection(() => Device.connect({ url }))
    expect(error).toBeInstanceOf(OnvifError)
    expect(error).toMatchObject({ message: expect.stringMatching(/^Invalid device URL/) })
  })

  it('refuses credentials in a device service URL without showing them', async () => {
    const error = await rejection(() => Device.connect({ url: 'http://admin:secret@192.0.2.1/onvif/device_service' }))
    expect(error).toBeInstanceOf(OnvifError)
    expect(error).toMatchObject({ host: '192.0.2.1' })
    expect(String(error)).not.toContain('secret')
  })

  it('keeps a device path that starts with two slashes on the configured host', async () => {
    const mock = await camera()
    const device = await connect(mock, { path: '//192.0.2.1/onvif/device_service' })
    expect(device.address.origin).toBe(mock.url)
  })

  it('accepts a device path without a leading slash', async () => {
    const mock = await camera()
    const device = await connect(mock, { path: 'onvif/device_service' })
    expect(device.address.href).toBe(`${mock.url}/onvif/device_service`)
    await expect(device.call(GetDeviceInformation)).resolves.toMatchObject({ manufacturer: 'DVC' })
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
    expect(device.addressPolicy).toBe('rewrite')
    expect(device.services.get(MEDIA)?.href).toBe(`${mock.url}/onvif/Media`)
  })

  it('drops them under the reject policy', async () => {
    const mock = await camera({ advertisedHost: '10.0.0.5:8080' })
    const device = await connect(mock, { serviceAddresses: 'reject' })
    expect(device.addressPolicy).toBe('reject')
    expect(device.services.has(MEDIA)).toBe(false)
    expect(device.services.has(DEVICE_NAMESPACE)).toBe(true)
    expect(() => device.resolveAddress('http://10.0.0.5:8080/onvif/Media')).toThrow('is not the configured origin')
    const host = new URL(mock.url).hostname
    expect(() => device.resolveAddress(`http://${host}:1/onvif/Media`)).toThrow('is not the configured origin')
  })

  it('rewrites another port or protocol on the configured host by default', async () => {
    const mock = await camera()
    const device = await connect(mock)
    const host = new URL(mock.url).hostname
    expect(device.resolveAddress(`https://${host}:8443/onvif/events?id=1`).href).toBe(`${mock.url}/onvif/events?id=1`)
    expect(device.resolveAddress(`http://${host}:1/onvif/Media`).href).toBe(`${mock.url}/onvif/Media`)
  })

  it('keeps another port or HTTPS on the configured host under the sameHost policy', async () => {
    const mock = await camera({ advertisedHost: '10.0.0.5:8080' })
    const device = await connect(mock, { serviceAddresses: 'sameHost' })
    expect(device.services.get(MEDIA)?.href).toBe(`${mock.url}/onvif/Media`)
    const host = new URL(mock.url).hostname
    expect(device.resolveAddress(`https://${host}:8443/onvif/events?id=1`).href).toBe(
      `https://${host}:8443/onvif/events?id=1`
    )
  })

  it.each(['rewrite', 'sameHost'] as const)(
    'never turns the configured HTTPS into HTTP under the %s policy',
    async (serviceAddresses) => {
      const tls = join(import.meta.dirname, '../../../fixtures/tls')
      let target = ''
      const front = createHttpsServer(
        { cert: readFileSync(join(tls, 'cert.pem')), key: readFileSync(join(tls, 'key.pem')) },
        async (request, response) => {
          const chunks = await Array.fromAsync<Buffer>(request)
          const reply = await fetch(`${target}${request.url}`, {
            method: 'POST',
            headers: { 'Content-Type': request.headers['content-type'] ?? '' },
            body: Buffer.concat(chunks)
          })
          response.writeHead(reply.status, { 'Content-Type': reply.headers.get('content-type') ?? '' })
          response.end(await reply.text())
        }
      )
      front.listen(0, '127.0.0.1')
      await once(front, 'listening')
      cleanups.push(() => {
        front.closeAllConnections()
        front.close()
      })
      const port = (front.address() as AddressInfo).port
      const mock = await camera({ advertisedHost: `127.0.0.1:${port}` })
      target = mock.url
      const device = await Device.connect({
        hostname: '127.0.0.1',
        port,
        secure: true,
        tls: { fingerprint256: '06DDB27F5670AFCAF42981271E663404B3FB0B54693AC176337D57880EA6D0DB' },
        username: 'admin',
        password: 'password',
        serviceAddresses
      })
      cleanups.push(() => device.close())
      expect(device.services.get(MEDIA)?.href).toBe(`https://127.0.0.1:${port}/onvif/Media`)
    }
  )

  it('resolves an address without a host to the configured device (RaySharp)', async () => {
    const mock = await camera()
    const device = await connect(mock, { serviceAddresses: 'reject' })
    expect(device.resolveAddress('http:///onvif/events_service?session=392').href).toBe(
      `${mock.url}/onvif/events_service?session=392`
    )
  })

  it('rejects invalid addresses and other protocols', async () => {
    const device = await connect(await camera())
    expect(() => device.resolveAddress('not a url')).toThrow("Invalid service address 'not a url'")
    expect(() => device.resolveAddress('ftp://127.0.0.1/x')).toThrow('Unsupported service address protocol ftp:')
    expect(() => device.resolveAddress(`${'a'.repeat(100_000)}://x`)).toThrow(/^.{1,200}$/)
  })

  it('keeps the message short for a huge host under the reject policy', async () => {
    const device = await connect(await camera(), { serviceAddresses: 'reject' })
    expect(() => device.resolveAddress(`http://${'h'.repeat(100_000)}.com/`)).toThrow(/^.{1,300}$/)
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
    aMinuteLater(mock, 15 * 60 * 1000)
    await expect(device.call(GetDeviceInformation)).resolves.toMatchObject({ manufacturer: 'DVC' })
    expect(actions(mock).slice(3)).toEqual(['GetDeviceInformation', 'GetSystemDateAndTime', 'GetDeviceInformation'])
    expect(Math.abs(device.clock.skewMs - 15 * 60 * 1000)).toBeLessThan(1_500)
  })

  it('does not retry rejected credentials when the resynchronized clock did not move', async () => {
    const mock = await camera({ unauthenticated: ['device.GetSystemDateAndTime', 'device.GetServices'] })
    const device = await connect(mock, { password: 'wrong', verifyCredentials: false })
    aMinuteLater(mock)
    await expect(device.call(GetDeviceInformation)).rejects.toThrow(AuthError)
    expect(actions(mock).slice(2)).toEqual(['GetDeviceInformation', 'GetSystemDateAndTime'])
  })

  it('measures the clock again and retries after the host was suspended', async () => {
    const mock = await camera()
    const device = await connect(mock)
    mock.requests.length = 0
    const hour = 3_600_000
    const wall = Date.now.bind(Date)
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => wall() + hour)
    cleanups.push(() => spy.mockRestore())
    mock.setClockSkew(hour)
    await expect(device.call(GetDeviceInformation)).resolves.toMatchObject({ manufacturer: 'DVC' })
    expect(actions(mock)).toEqual(['GetDeviceInformation', 'GetSystemDateAndTime', 'GetDeviceInformation'])
    expect(Math.abs(device.clock.skewMs)).toBeLessThan(1_500)
  })

  it('measures the clock again at most once a minute for rejected credentials', async () => {
    const mock = await camera({ unauthenticated: ['device.GetSystemDateAndTime', 'device.GetServices'] })
    const device = await connect(mock, { password: 'wrong', verifyCredentials: false })
    for (let index = 0; index < 3; index++) await expect(device.call(GetDeviceInformation)).rejects.toThrow(AuthError)
    expect(actions(mock).slice(2)).toEqual(['GetDeviceInformation', 'GetDeviceInformation', 'GetDeviceInformation'])
  })

  it('shares one resynchronization between concurrent calls rejected with the same clock', async () => {
    const mock = await camera({ unauthenticated: ['device.GetSystemDateAndTime', 'device.GetServices'] })
    const wrong = await connect(mock, { password: 'wrong', verifyCredentials: false })
    aMinuteLater(mock)
    const failures = await Promise.allSettled(Array.from({ length: 10 }, () => wrong.call(GetDeviceInformation)))
    expect(failures.every(({ status }) => status === 'rejected')).toBe(true)
    expect(
      actions(mock)
        .slice(2)
        .filter((action) => action === 'GetSystemDateAndTime')
    ).toHaveLength(1)
  })

  it('shares one resynchronization between concurrent calls after the device clock changed', async () => {
    const mock = await camera()
    const device = await connect(mock)
    mock.requests.length = 0
    aMinuteLater(mock, 15 * 60 * 1000)
    const results = await Promise.all(Array.from({ length: 5 }, () => device.call(GetDeviceInformation)))
    expect(results.every(({ manufacturer }) => manufacturer === 'DVC')).toBe(true)
    expect(actions(mock).filter((action) => action === 'GetSystemDateAndTime')).toHaveLength(1)
    expect(actions(mock).filter((action) => action === 'GetDeviceInformation')).toHaveLength(10)
  })

  it('limits a call to its timeout across retries', async () => {
    const mock = await camera({
      auth: 'digest',
      unauthenticated: ['device.GetSystemDateAndTime', 'device.GetServices'],
      overrides: { 'device.GetScopes': { kind: 'delay', ms: 70 } }
    })
    const device = await connect(mock, { password: 'wrong', verifyCredentials: false })
    await expect(device.call(GetScopes, {}, { timeoutMs: 100 })).rejects.toThrow('No response within 100 ms')
    expect(actions(mock).slice(2)).toEqual(['GetScopes', 'GetScopes'])
  })

  it('stops waiting for a shared clock resynchronization at the deadline or abort of the call', async () => {
    const overrides: Record<string, ActionOverride> = {}
    const mock = await camera({ unauthenticated: ['device.GetSystemDateAndTime', 'device.GetServices'], overrides })
    const device = await connect(mock, { password: 'wrong', verifyCredentials: false, timeoutMs: 2_000 })
    overrides['device.GetSystemDateAndTime'] = { kind: 'hang' }
    aMinuteLater(mock)
    const started = performance.now()
    await expect(device.call(GetDeviceInformation, {}, { timeoutMs: 200 })).rejects.toThrow('No response within 200 ms')
    const controller = new AbortController()
    setTimeout(() => controller.abort(new Error('cancelled')), 50)
    await expect(device.call(GetDeviceInformation, {}, { signal: controller.signal })).rejects.toThrow('cancelled')
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(actions(mock).filter((action) => action === 'GetSystemDateAndTime')).toHaveLength(2)
  })

  it('keeps valid timestamps when the local clock jumps after connecting', async () => {
    const mock = await camera()
    const device = await connect(mock)
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 6 * 3_600_000 })
    await expect(device.call(GetDeviceInformation)).resolves.toMatchObject({ manufacturer: 'DVC' })
    expect(actions(mock).slice(3)).toEqual(['GetDeviceInformation'])
  })

  it('adds WS-Addressing headers and sends to a reported address, keeping the address as issued in To', async () => {
    const mock = await camera()
    const device = await connect(mock)
    await device.call(GetDeviceInformation, {}, { to: 'http://10.0.0.9/onvif/device_service', addressing: true })
    const { body, path } = mock.requests.at(-1) ?? { body: '', path: '' }
    expect(path).toBe('/onvif/device_service')
    expect(body).toContain(
      '<wsa:To xmlns:wsa="http://www.w3.org/2005/08/addressing" s:mustUnderstand="1">http://10.0.0.9/onvif/device_service</wsa:To>'
    )
    expect(body).toContain('>http://www.onvif.org/ver10/device/wsdl/GetDeviceInformation</wsa:Action>')
    expect(body).toMatch(/<wsa:MessageID[^>]*>urn:uuid:[0-9a-f-]{36}<\/wsa:MessageID>/)
  })

  it('sends the reference parameters of an endpoint reference as headers', async () => {
    const mock = await camera()
    const device = await connect(mock)
    const parameters = parseXml(
      '<wsa:ReferenceParameters xmlns:wsa="http://www.w3.org/2005/08/addressing">' +
        '<dom0:SubscriptionId xmlns:dom0="http://www.axis.com/2009/event">3</dom0:SubscriptionId></wsa:ReferenceParameters>',
      undefined,
      { namespaces: true }
    )['ReferenceParameters'] as XmlObject
    const to = {
      address: { value: 'http://10.0.0.9/onvif/device_service' },
      referenceParameters: { $any: { SubscriptionId: parameters['SubscriptionId'] } }
    }
    await device.call(GetDeviceInformation, {}, { to, addressing: true })
    const { body } = mock.requests.at(-1) ?? { body: '' }
    expect(body).toContain('s:mustUnderstand="1">http://10.0.0.9/onvif/device_service</wsa:To>')
    expect(body).toContain(
      '<rp0:SubscriptionId xmlns:wsa="http://www.w3.org/2005/08/addressing" wsa:IsReferenceParameter="true" ' +
        'xmlns:rp0="http://www.axis.com/2009/event">3</rp0:SubscriptionId>'
    )
  })

  it('parses responses with namespaces for operations that ask for it', async () => {
    const mock = await camera()
    const device = await connect(mock)
    const response = await device.call({ ...GetDeviceInformation, namespaces: true })
    expect(namespaceInfo(response)?.namespace).toBe(DEVICE_NAMESPACE)
    expect(namespaceInfo(await device.call(GetDeviceInformation))).toBeUndefined()
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
    const device = await connect(await camera())
    const custom = { ...GetScopes, request: { ...GetScopes.request, namespace: 'urn:custom' } }
    await expect(device.call(custom)).rejects.toMatchObject({
      message: 'The device does not offer the service urn:custom',
      service: 'urn:custom',
      action: 'GetScopes'
    })
  })

  it('explains why a service with a rejected address is unavailable', async () => {
    const mock = await camera({ advertisedHost: '10.0.0.5' })
    const device = await connect(mock, { serviceAddresses: 'reject' })
    const media = { ...GetScopes, request: { ...GetScopes.request, namespace: MEDIA } }
    const error = await rejection(() => device.call(media))
    expect(error).toBeInstanceOf(OnvifError)
    expect(error).toMatchObject({
      message: `The service ${MEDIA} is unavailable: Service address http://10.0.0.5 is not the configured origin`,
      host: device.address.host,
      service: 'trt',
      action: 'GetScopes',
      cause: expect.any(OnvifError)
    })
    expect(actions(mock)).not.toContain('GetScopes')
  })
})

describe('retry', () => {
  const nonceOf = (body: string): string | undefined => /<wsse:Nonce[^>]*>([^<]+)</.exec(body)?.[1]

  it('does not retry unless asked to', async () => {
    const mock = await camera({
      overrides: { 'device.GetScopes': { kind: 'status', status: 503, body: '', times: 1 } }
    })
    const device = await connect(mock)
    await expect(device.call(GetScopes)).rejects.toMatchObject({ name: 'TransportError', status: 503 })
    expect(actions(mock).slice(3)).toEqual(['GetScopes'])
  })

  it.for([502, 503, 504])('retries Get operations answered with HTTP %i with a fresh nonce', async (status) => {
    const mock = await camera({ overrides: { 'device.GetScopes': { kind: 'status', status, body: '', times: 2 } } })
    const device = await connect(mock, { retry: { attempts: 2, delayMs: 1 } })
    await expect(device.call(GetScopes)).resolves.toMatchObject({ scopes: expect.any(Array) })
    const retried = mock.requests.slice(3)
    expect(retried.map(({ action }) => action)).toEqual(['GetScopes', 'GetScopes', 'GetScopes'])
    expect(new Set(retried.map(({ body }) => nonceOf(body))).size).toBe(3)
  })

  it('retries after dropped connections and responses cut short', async () => {
    const overrides: Record<string, ActionOverride> = {}
    const mock = await camera({ overrides })
    const device = await connect(mock, { retry: { attempts: 1, delayMs: 1 } })
    overrides['device.GetScopes'] = { kind: 'destroy', times: 2 }
    await expect(device.call(GetScopes)).resolves.toMatchObject({ scopes: expect.any(Array) })
    overrides['device.GetHostname'] = { kind: 'truncate', bytes: 100, times: 1 }
    await expect(device.call(GetHostname)).resolves.toMatchObject({ hostnameInformation: expect.any(Object) })
    expect(actions(mock).slice(3)).toEqual(['GetScopes', 'GetScopes', 'GetScopes', 'GetHostname', 'GetHostname'])
  })

  it('retries while connecting', async () => {
    let connections = 0
    const server = createServer((socket) => {
      connections += 1
      socket.resetAndDestroy()
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    cleanups.push(() => {
      server.close()
    })
    const { port } = server.address() as AddressInfo
    const retry = { attempts: 2, delayMs: 1 }
    await expect(Device.connect({ hostname: '127.0.0.1', port, retry })).rejects.toMatchObject({
      name: 'TransportError',
      cause: { code: 'ECONNRESET' }
    })
    expect(connections).toBe(3)
  })

  it('gives up after the configured number of retries', async () => {
    const mock = await camera({ overrides: { 'device.GetScopes': { kind: 'status', status: 503, body: '' } } })
    const device = await connect(mock, { retry: { attempts: 2, delayMs: 1 } })
    await expect(device.call(GetScopes)).rejects.toMatchObject({ name: 'TransportError', status: 503 })
    expect(actions(mock).slice(3)).toEqual(['GetScopes', 'GetScopes', 'GetScopes'])
  })

  it('doubles the delay for every retry, with jitter', async () => {
    const mock = await camera({
      overrides: { 'device.GetScopes': { kind: 'status', status: 503, body: '', times: 2 } }
    })
    const device = await connect(mock, { retry: { attempts: 2, delayMs: 100 } })
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    cleanups.push(() => random.mockRestore())
    const started = performance.now()
    await device.call(GetScopes)
    const elapsed = performance.now() - started
    expect(elapsed).toBeGreaterThanOrEqual(149)
    expect(elapsed).toBeLessThan(1_000)
  })

  it('does not retry operations other than Get, faults, auth errors or other HTTP errors', async () => {
    const mock = await camera({
      overrides: {
        'device.SystemReboot': { kind: 'status', status: 503, body: '' },
        'device.GetScopes': { kind: 'status', status: 500 },
        'device.GetHostname': { kind: 'status', status: 500, body: 'Internal error' }
      }
    })
    const device = await connect(mock, { retry: { attempts: 3, delayMs: 1 } })
    await expect(device.call(SystemReboot)).rejects.toMatchObject({ name: 'TransportError', status: 503 })
    await expect(device.call(GetScopes)).rejects.toThrow(SoapFaultError)
    await expect(device.call(GetHostname)).rejects.toMatchObject({ name: 'TransportError', status: 500 })
    expect(actions(mock).slice(3)).toEqual(['SystemReboot', 'GetScopes', 'GetHostname'])
    const strict = await camera({ unauthenticated: ['device.GetSystemDateAndTime', 'device.GetServices'] })
    const wrong = await connect(strict, { password: 'wrong', verifyCredentials: false, retry: { attempts: 3 } })
    await expect(wrong.call(GetDeviceInformation)).rejects.toThrow(AuthError)
    expect(actions(strict).slice(2)).toEqual(['GetDeviceInformation'])
  })

  it('does not retry responses over the size limit', async () => {
    const mock = await camera({
      overrides: { 'device.GetScopes': { kind: 'status', status: 200, body: 'x'.repeat(100_000) } }
    })
    const device = await connect(mock, { retry: { attempts: 3, delayMs: 1 }, maxResponseBytes: 50_000 })
    await expect(device.call(GetScopes)).rejects.toThrow(/exceeds/)
    expect(actions(mock).slice(3)).toEqual(['GetScopes'])
  })

  it('throws the last error instead of waiting past the deadline', async () => {
    const mock = await camera({ overrides: { 'device.GetScopes': { kind: 'status', status: 503, body: '' } } })
    const device = await connect(mock, { retry: { attempts: 3, delayMs: 5_000 }, timeoutMs: 1_000 })
    const started = performance.now()
    await expect(device.call(GetScopes)).rejects.toMatchObject({ name: 'TransportError', status: 503 })
    expect(performance.now() - started).toBeLessThan(500)
    expect(actions(mock).slice(3)).toEqual(['GetScopes'])
  })

  it('stops waiting for a retry when the call is aborted', async () => {
    const mock = await camera({ overrides: { 'device.GetScopes': { kind: 'status', status: 503, body: '' } } })
    const device = await connect(mock, { retry: { attempts: 3, delayMs: 5_000 }, timeoutMs: 60_000 })
    const controller = new AbortController()
    setTimeout(() => controller.abort(new Error('cancelled')), 50)
    const started = performance.now()
    await expect(device.call(GetScopes, {}, { signal: controller.signal })).rejects.toThrow('cancelled')
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  })

  it.for([
    { attempts: -1 },
    { attempts: 1.5 },
    { attempts: 11 },
    { attempts: 1, delayMs: -1 },
    { attempts: 1, delayMs: Number.NaN }
  ])('rejects invalid retry options %o', async (retry) => {
    await expect(Device.connect({ hostname: '127.0.0.1', retry })).rejects.toThrow(OnvifError)
  })
})

describe('Device.download', () => {
  it('downloads with HTTP Digest and returns the bytes and content type', async () => {
    const mock = await camera()
    const device = await connect(mock)
    const result = await device.download(`${mock.url}/snapshot.JPG`)
    expect(result).toEqual({ contentType: 'image/jpeg', body: MOCK_JPEG })
    expect(mock.requests.filter(({ service }) => service === 'snapshot')).toHaveLength(2)
  })

  it('applies the service address policy before sending credentials', async () => {
    const mock = await camera()
    const rewriting = await connect(mock)
    expect((await rewriting.download(new URL('http://10.0.0.5:8080/snapshot.JPG'))).body).toEqual(MOCK_JPEG)

    const rejecting = await connect(mock, { serviceAddresses: 'reject' })
    const before = mock.requests.length
    await expect(rejecting.download('http://10.0.0.5/snapshot.JPG')).rejects.toThrow('is not the configured origin')
    await expect(rejecting.download('rtsp://10.0.0.5/snapshot.JPG')).rejects.toThrow('Unsupported service address')
    expect(mock.requests).toHaveLength(before)
  })

  it('rejects wrong credentials as an AuthError after one digest retry', async () => {
    const mock = await camera({
      password: 'other',
      unauthenticated: ['device.GetSystemDateAndTime', 'device.GetServices']
    })
    const device = await connect(mock, { verifyCredentials: false })
    const error = await rejection(() => device.download(`${mock.url}/snapshot.JPG`))
    expect(error).toBeInstanceOf(AuthError)
    expect(error).toMatchObject({ message: 'Not authorized (HTTP 401)', host: device.address.host, action: 'GET' })
    expect(mock.requests.filter(({ service }) => service === 'snapshot')).toHaveLength(2)
  })

  it('does not answer an HTTP Basic challenge and says why', async () => {
    const mock = await camera({ snapshot: { auth: 'basic' } })
    const device = await connect(mock)
    const error = await rejection(() => device.download(`${mock.url}/snapshot.JPG`))
    expect(error).toBeInstanceOf(AuthError)
    expect((error as AuthError).message).toContain('HTTP Basic')
    expect((error as AuthError).message).toContain('basicAuth')
    const snapshots = mock.requests.filter(({ service }) => service === 'snapshot')
    expect(snapshots.map(({ headers }) => headers.authorization)).toEqual([undefined])
  })

  it('answers HTTP Basic with the basicAuth option', async () => {
    const mock = await camera({ snapshot: { auth: 'basic' } })
    const device = await connect(mock, { basicAuth: 'always' })
    expect((await device.download(`${mock.url}/snapshot.JPG`)).body).toEqual(MOCK_JPEG)
    const snapshots = mock.requests.filter(({ service }) => service === 'snapshot')
    expect(snapshots.map(({ headers }) => headers.authorization?.split(' ')[0])).toEqual([undefined, 'Basic'])
  })

  it('rejects other statuses, redirects included, as a TransportError with the status', async () => {
    const mock = await camera({ snapshot: { status: 302 } })
    const device = await connect(mock)
    await expect(device.download(`${mock.url}/snapshot.JPG`)).rejects.toMatchObject({
      name: 'TransportError',
      status: 302
    })
    await expect(device.download(`${mock.url}/missing.jpg`)).rejects.toMatchObject({ status: 404 })
  })

  it('stops at the timeout of the download', async () => {
    const device = await connect(await camera({ snapshot: { delayMs: 1_000 } }))
    const started = performance.now()
    const error = await rejection(() => device.download(`${device.address.origin}/snapshot.JPG`, { timeoutMs: 100 }))
    expect(error).toMatchObject({ name: 'TimeoutError', message: 'No response within 100 ms', action: 'GET' })
    expect(performance.now() - started).toBeLessThan(900)
  })
})
