import { createHash, randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { type MockCamera, type MockCameraOptions, startMockCamera } from '#tools/mock-camera/server.ts'

const tds = 'xmlns="http://www.onvif.org/ver10/device/wsdl"'

type TokenOptions = { password?: string; created?: Date; nonce?: Buffer }

const usernameToken = ({ password = 'password', created = new Date(), nonce = randomBytes(16) }: TokenOptions = {}) => {
  const timestamp = created.toISOString()
  const digest = createHash('sha1')
    .update(Buffer.concat([nonce, Buffer.from(timestamp), Buffer.from(password)]))
    .digest('base64')
  return (
    '<Security xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">' +
    `<UsernameToken><Username>admin</Username><Password Type="PasswordDigest">${digest}</Password>` +
    `<Nonce>${nonce.toString('base64')}</Nonce><Created>${timestamp}</Created></UsernameToken></Security>`
  )
}

const envelope = (body: string, header = ''): string =>
  `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Header>${header}</s:Header><s:Body>${body}</s:Body></s:Envelope>`

let camera: MockCamera | undefined

const start = async (options?: MockCameraOptions): Promise<MockCamera> => {
  camera = await startMockCamera(options)
  return camera
}

const post = (url: string, body: string, headers: Record<string, string> = {}) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/soap+xml', ...headers }, body })

afterEach(async () => {
  await camera?.close()
  camera = undefined
})

describe('mock camera', () => {
  it('answers GetSystemDateAndTime without credentials and applies the clock skew', async () => {
    const { url } = await start({ clockSkewMs: 3_600_000 })
    const response = await post(`${url}/onvif/device_service`, envelope(`<GetSystemDateAndTime ${tds}/>`))
    const xml = await response.text()
    expect(response.status).toBe(200)
    const hour = Number(/<tt:UTCDateTime><tt:Time><tt:Hour>(\d+)</.exec(xml)?.[1])
    expect(hour).toBe(new Date(Date.now() + 3_600_000).getUTCHours())
  })

  it('rejects requests without a UsernameToken', async () => {
    const { url } = await start()
    const response = await post(`${url}/onvif/device_service`, envelope(`<GetDeviceInformation ${tds}/>`))
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('ter:NotAuthorized')
  })

  it('serves fixtures with service addresses pointing at itself', async () => {
    const { url, requests } = await start()
    const response = await post(`${url}/onvif/device_service`, envelope(`<GetServices ${tds}/>`, usernameToken()))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain(`<tds:XAddr>${url}/onvif/Media</tds:XAddr>`)
    expect(requests.map(({ service, action }) => `${service}.${action}`)).toEqual(['device.GetServices'])
  })

  it('rejects wrong passwords, reused nonces and timestamps outside the replay window', async () => {
    const { url } = await start({ clockSkewMs: 3_600_000 })
    const deviceUrl = `${url}/onvif/device_service`
    const body = `<GetDeviceInformation ${tds}/>`
    const deviceTime = new Date(Date.now() + 3_600_000)

    expect(
      (await post(deviceUrl, envelope(body, usernameToken({ password: 'wrong', created: deviceTime })))).status
    ).toBe(400)
    expect((await post(deviceUrl, envelope(body, usernameToken()))).status).toBe(400)

    const nonce = randomBytes(16)
    expect((await post(deviceUrl, envelope(body, usernameToken({ created: deviceTime, nonce })))).status).toBe(200)
    expect((await post(deviceUrl, envelope(body, usernameToken({ created: deviceTime, nonce })))).status).toBe(400)
  })

  it('performs an HTTP digest challenge', async () => {
    const { url } = await start({ auth: 'digest', digestAlgorithm: 'SHA-256' })
    const deviceUrl = `${url}/onvif/device_service`
    const body = envelope(`<GetDeviceInformation ${tds}/>`)

    const challenge = await post(deviceUrl, body)
    expect(challenge.status).toBe(401)
    const header = challenge.headers.get('www-authenticate') ?? ''
    const nonce = /nonce="([^"]+)"/.exec(header)?.[1] ?? ''
    expect(header).toContain('algorithm=SHA-256')

    const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
    const ha1 = sha256('admin:Digest:password')
    const ha2 = sha256('POST:/onvif/device_service')
    const response = sha256(`${ha1}:${nonce}:00000001:abc:auth:${ha2}`)
    const authorization =
      `Digest username="admin", realm="Digest", nonce="${nonce}", uri="/onvif/device_service", ` +
      `qop=auth, nc=00000001, cnonce="abc", response="${response}", algorithm=SHA-256`
    const authorized = await post(deviceUrl, body, { Authorization: authorization })
    expect(authorized.status).toBe(200)
    expect(await authorized.text()).toContain('<tds:Manufacturer>DVC</tds:Manufacturer>')
  })

  it('answers unknown actions with the captured fault', async () => {
    const { url } = await start({ auth: 'none' })
    const response = await post(`${url}/onvif/device_service`, envelope(`<GetNothing ${tds}/>`))
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('SOAP-ENV:Fault')
  })

  it('answers malformed requests with a fault', async () => {
    const { url } = await start({ auth: 'none' })
    const response = await post(`${url}/onvif/device_service`, '<s:Envelope><s:Body>')
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('ter:WellFormed')
  })

  it('requires WS-Addressing on subscription endpoints when asked to', async () => {
    const { url } = await start({ auth: 'none', requireAddressing: true })
    const body = envelope('<PullMessages xmlns="http://www.onvif.org/ver10/events/wsdl"/>')
    const response = await post(`${url}/onvif/event/subsription_0`, body)
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('wsa5__To')

    const addressed = envelope(
      '<PullMessages xmlns="http://www.onvif.org/ver10/events/wsdl"/>',
      `<a:To xmlns:a="http://www.w3.org/2005/08/addressing">${url}/onvif/event/subsription_0</a:To>`
    )
    expect((await post(`${url}/onvif/event/subsription_0`, addressed)).status).toBe(200)
  })

  describe('fault injection', () => {
    const body = envelope(`<GetDeviceInformation ${tds}/>`)

    it('returns an injected status', async () => {
      const { url } = await start({
        auth: 'none',
        overrides: { 'device.GetDeviceInformation': { kind: 'status', status: 503 } }
      })
      expect((await post(`${url}/onvif/device_service`, body)).status).toBe(503)
    })

    it('delays the response', async () => {
      const { url } = await start({
        auth: 'none',
        overrides: { 'device.GetDeviceInformation': { kind: 'delay', ms: 200 } }
      })
      const started = performance.now()
      await post(`${url}/onvif/device_service`, body)
      expect(performance.now() - started).toBeGreaterThanOrEqual(190)
    })

    it('truncates the body', async () => {
      const { url } = await start({
        auth: 'none',
        overrides: { 'device.GetDeviceInformation': { kind: 'truncate', bytes: 100 } }
      })
      const response = await post(`${url}/onvif/device_service`, body)
      await expect(response.text()).rejects.toThrow(/terminated/)
    })

    it('drops the connection', async () => {
      const { url } = await start({ auth: 'none', overrides: { 'device.GetDeviceInformation': { kind: 'destroy' } } })
      await expect(post(`${url}/onvif/device_service`, body)).rejects.toThrow(/fetch failed/)
    })

    it('never answers', async () => {
      const { url } = await start({ auth: 'none', overrides: { 'device.GetDeviceInformation': { kind: 'hang' } } })
      const request = fetch(`${url}/onvif/device_service`, { method: 'POST', body, signal: AbortSignal.timeout(200) })
      await expect(request).rejects.toThrow(/timeout|aborted/i)
    })
  })
})
