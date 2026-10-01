import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { join } from 'node:path'
import { parseXml, type XmlObject } from '#onvif/soap/parse.ts'
import { MockEvents, type MockEventsOptions, type PullPointState } from '#tools/mock-camera/events.ts'

type Manifest = { responses: Record<string, { status: number; contentType: string }> }

export type ActionOverride = (
  | { kind: 'status'; status: number; body?: string; delayMs?: number }
  | { kind: 'delay'; ms: number }
  | { kind: 'truncate'; bytes: number }
  | { kind: 'hang' }
  | { kind: 'destroy' }
) & {
  /** Apply to this many requests for the action only, then answer normally. Every request by default. */
  times?: number
}

export type MockCameraOptions = {
  fixtureDirectory?: string
  username?: string
  password?: string
  auth?: 'ws-security' | 'digest' | 'none'
  digestAlgorithm?: 'MD5' | 'SHA-256'
  clockSkewMs?: number
  replayWindowMs?: number
  requireAddressing?: boolean
  /** `service.Action` names answered without credentials. Only `GetSystemDateAndTime` by default; an empty list
   * makes the clock need auth, as on some Panasonic and Vivotek devices. */
  unauthenticated?: string[]
  /** Leave `UTCDateTime` out of `GetSystemDateAndTime`, as some cheap devices do. */
  utcTime?: boolean
  /** `require`: answer an empty 200 without a Content-Type action (Pelco). `reject`: fault when one is sent (Illustra). */
  contentTypeAction?: 'require' | 'reject'
  /** Host written into service addresses instead of the mock's own, to simulate NAT. */
  advertisedHost?: string
  /** What `GET /snapshot.JPG` answers; HTTP Digest and a small JPEG by default, as the DVC camera. */
  snapshot?: MockSnapshotOptions
  /** Pull point behavior; subscriptions are simulated whatever these options are. */
  events?: MockEventsOptions
  overrides?: Record<string, ActionOverride>
}

export type MockSnapshotOptions = {
  /** `basic` challenges for HTTP Basic only and accepts it, as some cameras do. */
  auth?: 'digest' | 'basic' | 'none'
  status?: number
  contentType?: string
  body?: Buffer
  /** Wait this long before answering an authorized request. */
  delayMs?: number
  /** Answer every request with `Connection: close`, as the DVC camera does. */
  closeConnections?: boolean
}

export type RecordedRequest = {
  path: string
  service: string
  action: string
  headers: IncomingMessage['headers']
  body: string
}

export type MockCamera = {
  url: string
  requests: RecordedRequest[]
  /** Change the device clock, relative to the real time. */
  setClockSkew: (skewMs: number) => void
  /** Queue a `wsnt:NotificationMessage` on every pull point. */
  emitEvent: (notification: string) => void
  /** Pull points that currently exist on the device. */
  pullPoints: () => PullPointState[]
  /** Drop every pull point, as a reboot would. */
  expirePullPoints: () => void
  /** Reset every open connection with a TCP RST, as a network outage or a reboot would. */
  resetConnections: () => void
  close: () => Promise<void>
}

// SOI, a JFIF APP0 segment and EOI: the smallest file that starts and ends like a JPEG
export const MOCK_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0xff, 0xd9
])

const defaultFixtures = join(import.meta.dirname, '../../fixtures/live/dvc/dcn-bm2220lpr')
const capturedHost = '192.0.2.14:80'

const simulatedEventActions = new Set([
  'CreatePullPointSubscription',
  'PullMessages',
  'Renew',
  'SetSynchronizationPoint',
  'Unsubscribe'
])

const servicesByPath: Record<string, string> = {
  '/onvif/device_service': 'device',
  '/onvif/Media': 'media',
  '/onvif/Media2': 'media2',
  '/onvif/Events': 'events',
  '/onvif/PTZ': 'ptz'
}

const soapFault = (subcode: string, reason: string): string =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:ter="http://www.onvif.org/ver10/error">' +
  `<s:Body><s:Fault><s:Code><s:Value>s:Sender</s:Value><s:Subcode><s:Value>${subcode}</s:Value></s:Subcode></s:Code>` +
  `<s:Reason><s:Text xml:lang="en">${reason}</s:Text></s:Reason></s:Fault></s:Body></s:Envelope>`

const child = (node: unknown, name: string): XmlObject | string | undefined => {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return undefined
  return (node as XmlObject)[name] as XmlObject | string | undefined
}

const text = (node: unknown): string | undefined => {
  if (typeof node === 'string') return node
  const value = child(node, '_')
  return typeof value === 'string' ? value : undefined
}

const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

const hash = (algorithm: 'MD5' | 'SHA-256', value: string): string =>
  createHash(algorithm === 'MD5' ? 'md5' : 'sha256')
    .update(value)
    .digest('hex')

const parseDigestHeader = (header: string): Record<string, string> => {
  const fields: Record<string, string> = {}
  for (const match of header.replace(/^Digest\s+/i, '').matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) {
    const [, key, quoted, bare] = match
    if (key) fields[key] = quoted ?? bare ?? ''
  }
  return fields
}

// device clock runs on the monotonic clock, so tests can move the client's wall clock on its own
const realNow = (): number => performance.timeOrigin + performance.now()

const shiftDeviceTime = (xml: string, skewMs: number): string => {
  const now = new Date(realNow() + skewMs)
  const values: Record<string, number> = {
    Hour: now.getUTCHours(),
    Minute: now.getUTCMinutes(),
    Second: now.getUTCSeconds(),
    Year: now.getUTCFullYear(),
    Month: now.getUTCMonth() + 1,
    Day: now.getUTCDate()
  }
  return xml.replace(
    /<(tt:(Hour|Minute|Second|Year|Month|Day))>\d+<\/tt:\2>/g,
    (_match, tag: string, field: string) => {
      return `<${tag}>${values[field]}</${tag}>`
    }
  )
}

/**
 * Start an ONVIF device simulator that replays captured fixtures.
 *
 * @param options - Credentials, auth mode and fault injection
 * @returns The base URL, the recorded requests and a close function
 */
export async function startMockCamera(options: MockCameraOptions = {}): Promise<MockCamera> {
  const {
    fixtureDirectory = defaultFixtures,
    username = 'admin',
    password = 'password',
    auth = 'ws-security',
    digestAlgorithm = 'MD5',
    replayWindowMs = 5 * 60 * 1000,
    requireAddressing = false,
    unauthenticated = ['device.GetSystemDateAndTime'],
    utcTime = true,
    contentTypeAction,
    advertisedHost,
    overrides = {}
  } = options
  const events = new MockEvents(readFileSync(join(fixtureDirectory, 'events.PullMessages.xml'), 'utf8'), options.events)
  let clockSkewMs = options.clockSkewMs ?? 0
  const manifest = JSON.parse(readFileSync(join(fixtureDirectory, 'manifest.json'), 'utf8')) as Manifest
  const requests: RecordedRequest[] = []
  const overridden = new Map<string, number>()
  const usedNonces = new Set<string>()
  // highest nonce count accepted per issued nonce; a count that does not increase is a replay
  const digestNonceCounts = new Map<string, number>()
  let host = ''

  const fixture = (name: string): string =>
    readFileSync(join(fixtureDirectory, `${name}.xml`), 'utf8').replaceAll(capturedHost, advertisedHost ?? host)

  const send = (response: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) => {
    response.writeHead(status, { 'Content-Type': 'application/soap+xml; charset=utf-8', ...headers })
    response.end(body)
  }

  const checkWsSecurity = (header: unknown): string | undefined => {
    const token = child(child(header, 'Security'), 'UsernameToken')
    if (!token) return 'missing UsernameToken'
    const user = text(child(token, 'Username'))
    const digest = text(child(token, 'Password'))
    const nonce = text(child(token, 'Nonce'))
    const created = text(child(token, 'Created'))
    if (!user || !digest || !nonce || !created) return 'incomplete UsernameToken'
    const deviceNow = realNow() + clockSkewMs
    if (Math.abs(Date.parse(created) - deviceNow) > replayWindowMs) return 'Created outside of the replay window'
    if (usedNonces.has(nonce)) return 'nonce reused'
    const expected = createHash('sha1')
      .update(
        Buffer.concat([Buffer.from(nonce, 'base64'), Buffer.from(created, 'utf8'), Buffer.from(password, 'utf8')])
      )
      .digest('base64')
    if (user !== username || !safeEqual(digest, expected)) return 'wrong credentials'
    usedNonces.add(nonce)
    return undefined
  }

  const checkDigest = (request: IncomingMessage): boolean => {
    const header = request.headers.authorization
    if (!header?.startsWith('Digest ')) return false
    const fields = parseDigestHeader(header)
    const nonce = fields['nonce'] ?? ''
    const lastCount = digestNonceCounts.get(nonce)
    const count = Number.parseInt(fields['nc'] ?? '', 16)
    if (lastCount === undefined || !(count > lastCount)) return false
    const ha1 = hash(digestAlgorithm, `${username}:${fields['realm']}:${password}`)
    const ha2 = hash(digestAlgorithm, `${request.method}:${fields['uri']}`)
    const expected = hash(
      digestAlgorithm,
      `${ha1}:${fields['nonce']}:${fields['nc']}:${fields['cnonce']}:${fields['qop']}:${ha2}`
    )
    if (fields['username'] !== username || !safeEqual(fields['response'] ?? '', expected)) return false
    digestNonceCounts.set(nonce, count)
    return true
  }

  const serveSnapshot = async (request: IncomingMessage, response: ServerResponse, path: string) => {
    requests.push({ path, service: 'snapshot', action: 'GET', headers: request.headers, body: '' })
    const {
      auth: snapshotAuth = 'digest',
      status = 200,
      contentType = 'image/jpeg',
      body = MOCK_JPEG,
      delayMs = 0,
      closeConnections = false
    } = options.snapshot ?? {}
    const connection: Record<string, string> = closeConnections ? { Connection: 'close' } : {}
    if (path !== '/snapshot.JPG') {
      response.writeHead(404, { 'Content-Type': 'text/html' })
      response.end('<html><body>Not Found</body></html>')
      return
    }
    const basic = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
    const authorized =
      snapshotAuth === 'none' ||
      (snapshotAuth === 'basic' ? safeEqual(request.headers.authorization ?? '', basic) : checkDigest(request))
    if (!authorized) {
      const nonce = randomBytes(16).toString('hex')
      digestNonceCounts.set(nonce, 0)
      const challenge =
        snapshotAuth === 'basic'
          ? 'Basic realm="camera"'
          : `Digest realm="Digest", qop="auth", algorithm=${digestAlgorithm}, nonce="${nonce}"`
      response.writeHead(401, { 'Content-Type': 'text/html', 'WWW-Authenticate': challenge, ...connection })
      response.end('<html><body>401 Unauthorized</body></html>')
      return
    }
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    if (response.destroyed) return
    response.writeHead(status, { 'Content-Type': contentType, 'Content-Length': body.length, ...connection })
    response.end(body)
  }

  const handle = async (request: IncomingMessage, response: ServerResponse, body: string) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    if (request.method === 'GET') {
      await serveSnapshot(request, response, path)
      return
    }
    const service =
      servicesByPath[path] ?? (path.startsWith('/onvif/event/') || path === '/onvif/services' ? 'events' : 'unknown')

    let envelope: XmlObject
    try {
      envelope = parseXml(body)
    } catch {
      send(response, 400, soapFault('ter:WellFormed', 'Malformed request'))
      return
    }
    const soapBody = child(envelope['Envelope'], 'Body')
    const action = typeof soapBody === 'object' ? (Object.keys(soapBody)[0] ?? '') : ''
    requests.push({ path, service, action, headers: request.headers, body })

    const key = `${service}.${action}`
    const count = (overridden.get(key) ?? 0) + 1
    overridden.set(key, count)
    const configured = overrides[key]
    const override = configured && count <= (configured.times ?? Infinity) ? configured : undefined
    if (override?.kind === 'hang') return
    if (override?.kind === 'destroy') {
      request.socket.destroy()
      return
    }
    if (override?.kind === 'delay') await new Promise((resolve) => setTimeout(resolve, override.ms))
    if (override?.kind === 'status') {
      if (override.delayMs) await new Promise((resolve) => setTimeout(resolve, override.delayMs))
      send(response, override.status, override.body ?? soapFault('ter:Action', 'Injected failure'))
      return
    }

    const contentType = request.headers['content-type'] ?? ''
    if (contentTypeAction === 'require' && !/;\s*action=/.test(contentType)) {
      response.writeHead(200)
      response.end()
      return
    }
    if (contentTypeAction === 'reject' && /;\s*action=/.test(contentType)) {
      send(response, 400, soapFault('wsa5:ActionNotSupported', 'The [action] cannot be processed at the receiver.'))
      return
    }

    const header = child(envelope['Envelope'], 'Header')
    if (requireAddressing && service === 'events' && path.startsWith('/onvif/event/') && !text(child(header, 'To'))) {
      send(response, 400, soapFault('ter:InvalidArgVal', 'The requested wsa5__To or wsa__To does not exist.'))
      return
    }

    const preAuth = unauthenticated.includes(`${service}.${action}`)
    if (auth === 'ws-security' && !preAuth) {
      const problem = checkWsSecurity(header)
      if (problem) {
        send(response, 400, soapFault('ter:NotAuthorized', `Sender not Authorized: ${problem}`))
        return
      }
    }
    if (auth === 'digest' && !preAuth && !checkDigest(request)) {
      const nonce = randomBytes(16).toString('hex')
      digestNonceCounts.set(nonce, 0)
      send(response, 401, soapFault('ter:NotAuthorized', 'HTTP Error: 401 Unauthorized'), {
        'WWW-Authenticate': `Digest realm="Digest", qop="auth", algorithm=${digestAlgorithm}, nonce="${nonce}"`
      })
      return
    }

    if (service === 'events' && simulatedEventActions.has(action)) {
      const reply = await events.handle(action, path, advertisedHost ?? host, envelope, () => realNow() + clockSkewMs)
      if (!response.destroyed) send(response, reply.status, reply.body)
      return
    }

    const name = `${service}.${action}`
    const recorded = manifest.responses[name]
    if (!recorded) {
      send(response, 400, fixture('device.UnknownActionFault'))
      return
    }
    let xml = fixture(name)
    if (name === 'device.GetSystemDateAndTime') {
      xml = shiftDeviceTime(xml, clockSkewMs)
      if (!utcTime) xml = xml.replace(/<tt:UTCDateTime>[\s\S]*?<\/tt:UTCDateTime>/, '')
    }

    if (override?.kind === 'truncate') {
      response.writeHead(recorded.status, {
        'Content-Type': recorded.contentType,
        'Content-Length': Buffer.byteLength(xml)
      })
      response.write(Buffer.from(xml).subarray(0, override.bytes), () => request.socket.destroy())
      return
    }
    send(response, recorded.status, xml, { 'Content-Type': recorded.contentType })
  }

  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk as Buffer)
      await handle(request, response, Buffer.concat(chunks).toString('utf8'))
    } catch (error) {
      response.destroy(error instanceof Error ? error : new Error(String(error)))
    }
  })
  const sockets = new Set<Socket>()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`

  return {
    url: `http://${host}`,
    requests,
    setClockSkew: (skewMs) => {
      clockSkewMs = skewMs
    },
    emitEvent: (notification) => events.emit(notification),
    pullPoints: () => events.pullPoints,
    expirePullPoints: () => events.expireAll(),
    resetConnections: () => {
      for (const socket of sockets) socket.resetAndDestroy()
    },
    close: async () => {
      events.close()
      server.closeAllConnections()
      server.close()
      await once(server, 'close')
    }
  }
}
