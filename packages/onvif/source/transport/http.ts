import { once } from 'node:events'
import {
  type ClientRequest,
  Agent as HttpAgent,
  type IncomingMessage,
  request as httpRequest,
  type RequestOptions
} from 'node:http'
import { Agent as HttpsAgent, type AgentOptions as HttpsAgentOptions, request as httpsRequest } from 'node:https'
import type { Duplex } from 'node:stream'
import { connect as tlsConnect, type ConnectionOptions } from 'node:tls'
import { AuthError, type ErrorContext, TimeoutError, TransportError } from '#errors.ts'
import type { Credentials } from '#soap/security.ts'
import { type DigestChallenge, digestAuthorization, parseChallenge } from '#transport/digest.ts'

export type TlsOptions = Pick<ConnectionOptions, 'ca' | 'cert' | 'key' | 'rejectUnauthorized'> & {
  /** SHA-256 fingerprint of the device certificate, hex with or without colons. Accepts self signed certificates. */
  fingerprint256?: string
}

export type HttpTransportOptions = {
  timeoutMs?: number | undefined
  maxResponseBytes?: number | undefined
  maxSockets?: number
  /** Close a kept-alive connection after this long unused, before the device does. 4 000 by default. */
  idleTimeoutMs?: number
  tls?: TlsOptions | undefined
  /** Answer HTTP Digest challenges, and Basic ones when `basicAuth` allows it, with these credentials. */
  credentials?: Credentials | undefined
  /**
   * Answer a challenge that offers HTTP Basic and no Digest: `https` only on HTTPS requests, `always` on any. Never
   * answered by default, since Basic sends the password as it is.
   */
  basicAuth?: 'https' | 'always' | undefined
}

export type HttpResponse<Body = string> = {
  status: number
  headers: NodeJS.Dict<string[]>
  body: Body
}

export type PostOptions = {
  signal?: AbortSignal | undefined
  context?: ErrorContext
  /** SOAP 1.2 action, sent as the `action` parameter of `Content-Type`. */
  action?: string | undefined
  /** Overrides the transport timeout for this request, retries included. */
  timeoutMs?: number | undefined
  /** `performance.now()` time by which the response must be complete, when several posts share one `timeoutMs`. */
  deadline?: number | undefined
}

type Body = string | (() => string)

type AttemptOptions = PostOptions & { timeoutMs: number; deadline: number }

type Method = 'GET' | 'POST'

const normalizeFingerprint = (fingerprint: string): string => fingerprint.replaceAll(':', '').toUpperCase()

class PinnedAgent extends HttpsAgent {
  readonly #fingerprint: string
  readonly #handshakeTimeoutMs: number
  readonly #sessions = new Map<string, Buffer>()

  constructor(options: HttpsAgentOptions, fingerprint: string, handshakeTimeoutMs: number) {
    super(options)
    this.#fingerprint = normalizeFingerprint(fingerprint)
    this.#handshakeTimeoutMs = handshakeTimeoutMs
  }

  // The socket goes to the request only after the certificate matched, so nothing gets written to an unverified peer.
  // Sessions are cached only from connections whose certificate matched, so a peer that resumes one proves it is the
  // same server; a resumed TLS 1.3 session carries no certificate to check.
  override createConnection(
    options: RequestOptions,
    oncreate?: (error: Error | null, socket: Duplex) => void
  ): Duplex | undefined {
    const name = this.getName(options)
    const session = this.#sessions.get(name)
    const socket = tlsConnect({
      ...(options as ConnectionOptions),
      rejectUnauthorized: false,
      ...(session ? { session } : {})
    })
    let verified = false
    let pending: Buffer | undefined
    socket.on('session', (ticket: Buffer) => {
      if (verified) this.#sessions.set(name, ticket)
      else pending = ticket
    })
    const onTimeout = () => socket.destroy(new Error(`TLS handshake took longer than ${this.#handshakeTimeoutMs} ms`))
    socket.setTimeout(this.#handshakeTimeoutMs, onTimeout)
    const verify = async () => {
      try {
        await once(socket, 'secureConnect')
        socket.setTimeout(0, onTimeout)
        const actual = normalizeFingerprint(socket.getPeerCertificate().fingerprint256 ?? '')
        if (!socket.isSessionReused() && actual !== this.#fingerprint) {
          throw new Error(`Certificate fingerprint ${actual} does not match the pinned fingerprint`)
        }
        verified = true
        if (pending) this.#sessions.set(name, pending)
        oncreate?.(null, socket)
      } catch (error) {
        this.#sessions.delete(name)
        socket.destroy()
        oncreate?.(error instanceof Error ? error : new Error(String(error)), socket)
      }
    }
    void verify()
    return undefined
  }
}

class RetryableReset extends Error {}

const offersBasic = (challenges: string[]): boolean =>
  challenges.some((challenge) => /(?:^|,)\s*Basic(?:\s|,|$)/i.test(challenge))

const isResetOfReusedSocket = (error: unknown, reusedSocket: boolean): boolean =>
  reusedSocket && error instanceof Error && 'code' in error && error.code === 'ECONNRESET'

export class HttpTransport {
  readonly #timeoutMs: number
  readonly #maxResponseBytes: number
  readonly #credentials: Credentials | undefined
  readonly #basicAuth: 'https' | 'always' | undefined
  readonly #httpAgent: HttpAgent
  readonly #httpsAgent: HttpsAgent
  #challenge: DigestChallenge | undefined
  #nonceCount = 0
  #basic = false

  constructor(options: HttpTransportOptions = {}) {
    const {
      timeoutMs = 10_000,
      maxResponseBytes = 4 * 1024 * 1024,
      maxSockets = 4,
      idleTimeoutMs = 4_000,
      tls = {},
      credentials,
      basicAuth
    } = options
    this.#timeoutMs = timeoutMs
    this.#maxResponseBytes = maxResponseBytes
    this.#credentials = credentials
    this.#basicAuth = basicAuth
    this.#httpAgent = new HttpAgent({ keepAlive: true, maxSockets, timeout: idleTimeoutMs })
    const { fingerprint256, ...tlsOptions } = tls
    const httpsOptions = { keepAlive: true, maxSockets, timeout: idleTimeoutMs, ...tlsOptions }
    this.#httpsAgent = fingerprint256
      ? new PinnedAgent(httpsOptions, fingerprint256, timeoutMs)
      : new HttpsAgent(httpsOptions)
  }

  /**
   * POST a SOAP message. Resolves with any HTTP status; SOAP faults arrive as 4xx/5xx responses with a body.
   *
   * @param url - Service address
   * @param body - Serialized envelope, or a function that serializes it for each attempt so a retry carries a fresh
   *   WS-Security nonce and timestamp
   * @param options - Abort signal, error context, SOAP action, timeout and deadline
   * @returns Status, headers and body
   * @throws {AuthError} If a Digest challenge has to be answered for a username that is not printable ASCII, or a
   *   Basic one for a username with a colon or control characters
   * @throws {TimeoutError} If no complete response arrived before the timeout or deadline
   * @throws {TransportError} On connection errors or a response over the size limit
   */
  async post(url: URL, body: Body, options: PostOptions = {}): Promise<HttpResponse> {
    const response = await this.#request('POST', url, body, options)
    return { ...response, body: response.body.toString('utf8') }
  }

  /**
   * GET a resource, such as a snapshot. Resolves with any HTTP status.
   *
   * @param url - Resource address
   * @param options - Abort signal, error context, timeout and deadline
   * @returns Status, headers and the body as bytes
   * @throws {AuthError} If a Digest challenge has to be answered for a username that is not printable ASCII, or a
   *   Basic one for a username with a colon or control characters
   * @throws {TimeoutError} If no complete response arrived before the timeout or deadline
   * @throws {TransportError} On connection errors or a response over the size limit
   */
  get(url: URL, options: Omit<PostOptions, 'action'> = {}): Promise<HttpResponse<Buffer>> {
    return this.#request('GET', url, undefined, options)
  }

  close(): void {
    this.#httpAgent.destroy()
    this.#httpsAgent.destroy()
  }

  async #request(
    method: Method,
    url: URL,
    body: Body | undefined,
    options: PostOptions
  ): Promise<HttpResponse<Buffer>> {
    const { timeoutMs = this.#timeoutMs, deadline = performance.now() + timeoutMs } = options
    const attempt = { ...options, timeoutMs, deadline }
    const sentBasic = this.#sendsBasic(url)
    const response = await this.#send(method, url, body, attempt)
    if (response.status !== 401 || !this.#credentials) return response

    const challenges = response.headers['www-authenticate'] ?? []
    const challenge = parseChallenge(challenges)
    if (challenge) {
      const repeated = this.#challenge !== undefined && challenge.nonce === this.#challenge.nonce && !challenge.stale
      if (repeated) return response
      this.#challenge = challenge
      this.#nonceCount = 0
      this.#basic = false
    } else {
      if (sentBasic || !offersBasic(challenges)) return response
      this.#basic = true
      if (!this.#sendsBasic(url)) return response
    }
    try {
      return await this.#send(method, url, body, attempt)
    } catch (error) {
      // some devices drop the connection instead of rejecting the digest
      if (error instanceof TransportError) return response
      throw error
    }
  }

  #sendsBasic(url: URL): boolean {
    return this.#basic && (this.#basicAuth === 'always' || (this.#basicAuth === 'https' && url.protocol === 'https:'))
  }

  #authorization(method: Method, url: URL, context: ErrorContext = {}): string | undefined {
    if (!this.#credentials) return undefined
    const { username, password } = this.#credentials
    if (this.#sendsBasic(url)) {
      if (!/^[^\p{Cc}:]*$/u.test(username) || !/^\P{Cc}*$/u.test(password)) {
        throw new AuthError(
          'HTTP Basic needs a username without colons and credentials without control characters',
          context
        )
      }
      return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
    }
    if (!this.#challenge) return undefined
    if (!/^[\x20-\x7e]*$/.test(username)) {
      throw new AuthError('HTTP Digest needs a username of printable ASCII characters', context)
    }
    this.#nonceCount += 1
    return digestAuthorization(this.#challenge, this.#credentials, method, url.pathname + url.search, this.#nonceCount)
  }

  async #send(
    method: Method,
    url: URL,
    body: Body | undefined,
    options: AttemptOptions
  ): Promise<HttpResponse<Buffer>> {
    try {
      return await this.#attempt(method, url, body, options)
    } catch (error) {
      if (!(error instanceof RetryableReset)) throw error
      return await this.#attempt(method, url, body, options)
    }
  }

  async #attempt(
    method: Method,
    url: URL,
    body: Body | undefined,
    options: AttemptOptions
  ): Promise<HttpResponse<Buffer>> {
    const { signal, context = {}, action, timeoutMs, deadline } = options
    const remainingMs = Math.ceil(deadline - performance.now())
    if (remainingMs <= 0) throw new TimeoutError(`No response within ${timeoutMs} ms`, context)
    const secure = url.protocol === 'https:'
    if (!secure && url.protocol !== 'http:') throw new TransportError(`Unsupported protocol ${url.protocol}`, context)
    const payload = body === undefined ? undefined : Buffer.from(typeof body === 'function' ? body() : body, 'utf8')
    const headers: Record<string, string | number> = {}
    if (payload) {
      headers['Content-Type'] =
        `application/soap+xml; charset=utf-8${action ? `; action="${action.replaceAll('"', '%22')}"` : ''}`
      headers['Content-Length'] = payload.length
    }
    const authorization = this.#authorization(method, url, context)
    if (authorization) headers['Authorization'] = authorization

    const deadlineController = new AbortController()
    const timer = setTimeout(() => deadlineController.abort(), remainingMs)
    const timedOut = deadlineController.signal
    const combined = signal ? AbortSignal.any([signal, timedOut]) : timedOut
    let detach: (() => void) | undefined
    try {
      return await new Promise((resolve, reject) => {
        let outgoing: ClientRequest | undefined
        let responded = false
        const fail = (error: unknown) => {
          if (timedOut.aborted) {
            reject(new TimeoutError(`No response within ${timeoutMs} ms`, context))
          } else if (signal?.aborted) {
            reject(signal.reason)
          } else if (!responded && isResetOfReusedSocket(error, outgoing?.reusedSocket === true)) {
            reject(new RetryableReset())
          } else {
            const message = error instanceof Error ? error.message : String(error)
            reject(new TransportError(`Request failed: ${message}`, context, { cause: error }))
          }
        }

        const onResponse = (response: IncomingMessage) => {
          responded = true
          const declared = Number(response.headers['content-length'])
          if (declared > this.#maxResponseBytes) {
            response.destroy()
            reject(new TransportError(`Response of ${declared} bytes exceeds ${this.#maxResponseBytes}`, context))
            return
          }
          const chunks: Buffer[] = []
          let received = 0
          response.on('data', (chunk: Buffer) => {
            received += chunk.length
            if (received > this.#maxResponseBytes) {
              response.destroy()
              reject(new TransportError(`Response exceeds ${this.#maxResponseBytes} bytes`, context))
              return
            }
            chunks.push(chunk)
          })
          response.on('error', fail)
          response.on('close', () => {
            if (!response.complete) fail(new Error('Connection closed before the response was complete'))
          })
          response.on('end', () => {
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headersDistinct,
              body: Buffer.concat(chunks)
            })
          })
        }

        const agent = secure ? this.#httpsAgent : this.#httpAgent
        try {
          outgoing = (secure ? httpsRequest : httpRequest)(
            url,
            { method, headers, agent, signal: combined },
            onResponse
          )
        } catch (error) {
          fail(error)
          return
        }
        outgoing.on('error', fail)
        combined.addEventListener('abort', fail, { once: true })
        detach = () => combined.removeEventListener('abort', fail)
        outgoing.end(payload)
      })
    } finally {
      clearTimeout(timer)
      detach?.()
    }
  }
}
