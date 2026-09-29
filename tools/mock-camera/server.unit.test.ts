import { createHash, randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { motionNotification } from '#tools/mock-camera/events.ts'
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

const create = (termination?: string): string =>
  '<CreatePullPointSubscription xmlns="http://www.onvif.org/ver10/events/wsdl">' +
  `${termination ? `<InitialTerminationTime>${termination}</InitialTerminationTime>` : ''}</CreatePullPointSubscription>`

const pull = (timeout = 'PT1S', limit = 10): string =>
  '<PullMessages xmlns="http://www.onvif.org/ver10/events/wsdl">' +
  `<Timeout>${timeout}</Timeout><MessageLimit>${limit}</MessageLimit></PullMessages>`

const createPullPoint = async (url: string, termination?: string): Promise<string> => {
  const xml = await (await post(`${url}/onvif/Events`, envelope(create(termination)))).text()
  return /<wsa5:Address>([^<]+)</.exec(xml)?.[1] ?? ''
}

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
    expect((await post(deviceUrl, body, { Authorization: authorization })).status).toBe(401)
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
    const address = await createPullPoint(url)
    const response = await post(address, envelope(pull()))
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('wsa5__To')

    const addressed = envelope(pull(), `<a:To xmlns:a="http://www.w3.org/2005/08/addressing">${address}</a:To>`)
    expect((await post(address, addressed)).status).toBe(200)
  })

  describe('pull points', () => {
    it('delivers the initial property events, then waits for new ones until the timeout', async () => {
      const mock = await start({ auth: 'none' })
      const address = await createPullPoint(mock.url, 'PT5S')
      const first = await (await post(address, envelope(pull('PT1S', 100)))).text()
      expect(first.match(/<wsnt:NotificationMessage>/g)).toHaveLength(7)

      const started = performance.now()
      const idle = await (await post(address, envelope(pull('PT0.2S')))).text()
      expect(performance.now() - started).toBeGreaterThanOrEqual(150)
      expect(idle).not.toContain('NotificationMessage')

      setTimeout(() => mock.emitEvent(motionNotification(true)), 50)
      expect(await (await post(address, envelope(pull('PT5S')))).text()).toContain('Name="IsMotion" Value="true"')
    })

    it('extends the termination time on pulls unless asked not to', async () => {
      const extending = await start({ auth: 'none', events: { terminationMs: 10_000 } })
      await post(await createPullPoint(extending.url), envelope(pull('PT0S')))
      expect(extending.pullPoints()[0]?.terminationAt).toBeGreaterThan(Date.now() + 9_000)
      await extending.close()

      const fixed = await start({ auth: 'none', events: { terminationMs: 300, extendOnPull: false } })
      const address = await createPullPoint(fixed.url)
      await new Promise((resolve) => setTimeout(resolve, 350))
      const expired = await post(address, envelope(pull('PT0S')))
      expect(await expired.text()).toContain('ResourceUnknownFault')
      expect(fixed.pullPoints()).toEqual([])
    })

    it('renews, synchronizes and unsubscribes', async () => {
      const mock = await start({ auth: 'none', events: { extendOnPull: false } })
      const address = await createPullPoint(mock.url, 'PT1S')
      const renewed = await (
        await post(
          address,
          envelope('<Renew xmlns="http://docs.oasis-open.org/wsn/b-2"><TerminationTime>PT1M</TerminationTime></Renew>')
        )
      ).text()
      expect(renewed).toContain('<wsnt:RenewResponse>')
      expect(mock.pullPoints()[0]?.terminationAt).toBeGreaterThan(Date.now() + 50_000)

      await post(address, envelope(pull('PT0S', 100)))
      await post(address, envelope('<SetSynchronizationPoint xmlns="http://www.onvif.org/ver10/events/wsdl"/>'))
      const again = await (await post(address, envelope(pull('PT0S', 100)))).text()
      expect(again.match(/PropertyOperation="Initialized"/g)).toHaveLength(7)

      await post(address, envelope('<Unsubscribe xmlns="http://docs.oasis-open.org/wsn/b-2"/>'))
      expect(mock.pullPoints()).toEqual([])
    })

    it('simulates Axis reference parameters, hostless addresses, missing Renew and a pull point limit', async () => {
      const axis = await start({ auth: 'none', events: { referenceParameters: true, renew: false, maxPullPoints: 1 } })
      const created = await (await post(`${axis.url}/onvif/Events`, envelope(create()))).text()
      expect(created).toContain(`<wsa5:Address>${axis.url}/onvif/services</wsa5:Address>`)
      expect(created).toContain(
        '<dom0:SubscriptionId xmlns:dom0="http://www.axis.com/2009/event">1</dom0:SubscriptionId>'
      )
      expect(await (await post(`${axis.url}/onvif/Events`, envelope(create()))).text()).toContain(
        'SubscribeCreationFailed'
      )
      const services = `${axis.url}/onvif/services`
      expect(await (await post(services, envelope(pull('PT0S')))).text()).toContain('ResourceUnknownFault')
      const id = '<SubscriptionId xmlns="http://www.axis.com/2009/event">1</SubscriptionId>'
      expect((await post(services, envelope(pull('PT0S'), id))).status).toBe(200)
      const renew = envelope(
        '<Renew xmlns="http://docs.oasis-open.org/wsn/b-2"><TerminationTime>PT1M</TerminationTime></Renew>',
        id
      )
      expect(await (await post(services, renew)).text()).toContain('ActionNotSupported')
      await axis.close()

      const raysharp = await start({ auth: 'none', events: { hostlessAddress: true } })
      expect(await (await post(`${raysharp.url}/onvif/Events`, envelope(create()))).text()).toContain(
        '<wsa5:Address>http:///onvif/event/subsription_1</wsa5:Address>'
      )
    })

    it('drops every pull point on request, as a reboot would', async () => {
      const mock = await start({ auth: 'none' })
      await createPullPoint(mock.url)
      mock.expirePullPoints()
      expect(mock.pullPoints()).toEqual([])
    })
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
