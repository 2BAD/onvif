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
import { type ErrorContext, TimeoutError, TransportError } from '#errors.ts'
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
  /** Answer HTTP Digest challenges with these credentials. */
  digest?: Credentials | undefined
}

export type HttpResponse = {
  status: number
  headers: NodeJS.Dict<string[]>
  body: string
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

const normalizeFingerprint = (fingerprint: string): string => fingerprint.replaceAll(':', '').toUpperCase()

class PinnedAgent extends HttpsAgent {
  readonly #fingerprint: string
  readonly #handshakeTimeoutMs: number

  constructor(options: HttpsAgentOptions, fingerprint: string, handshakeTimeoutMs: number) {
    super(options)
    this.#fingerprint = normalizeFingerprint(fingerprint)
    this.#handshakeTimeoutMs = handshakeTimeoutMs
  }

  // The socket goes to the request only after the certificate matched, so nothing gets written to an unverified peer.
  override createConnection(
    options: RequestOptions,
    oncreate?: (error: Error | null, socket: Duplex) => void
  ): Duplex | undefined {
    const socket = tlsConnect({ ...(options as ConnectionOptions), rejectUnauthorized: false })
    const onTimeout = () => socket.destroy(new Error(`TLS handshake took longer than ${this.#handshakeTimeoutMs} ms`))
    socket.setTimeout(this.#handshakeTimeoutMs, onTimeout)
    const verify = async () => {
      try {
        await once(socket, 'secureConnect')
        socket.setTimeout(0, onTimeout)
        const actual = normalizeFingerprint(socket.getPeerCertificate().fingerprint256 ?? '')
        if (actual !== this.#fingerprint) {
          throw new Error(`Certificate fingerprint ${actual} does not match the pinned fingerprint`)
        }
        oncreate?.(null, socket)
      } catch (error) {
        socket.destroy()
        oncreate?.(error instanceof Error ? error : new Error(String(error)), socket)
      }
    }
    void verify()
    return undefined
  }
}

class RetryableReset extends Error {}

const isResetOfReusedSocket = (error: unknown, reusedSocket: boolean): boolean =>
  reusedSocket && error instanceof Error && 'code' in error && error.code === 'ECONNRESET'

export class HttpTransport {
  readonly #timeoutMs: number
  readonly #maxResponseBytes: number
  readonly #digest: Credentials | undefined
  readonly #httpAgent: HttpAgent
  readonly #httpsAgent: HttpsAgent
  #challenge: DigestChallenge | undefined
  #nonceCount = 0

  constructor(options: HttpTransportOptions = {}) {
    const {
      timeoutMs = 10_000,
      maxResponseBytes = 4 * 1024 * 1024,
      maxSockets = 4,
      idleTimeoutMs = 4_000,
      tls = {},
      digest
    } = options
    this.#timeoutMs = timeoutMs
    this.#maxResponseBytes = maxResponseBytes
    this.#digest = digest
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
   * @throws {TimeoutError} If no complete response arrived before the timeout or deadline
   * @throws {TransportError} On connection errors or a response over the size limit
   */
  async post(url: URL, body: Body, options: PostOptions = {}): Promise<HttpResponse> {
    const { timeoutMs = this.#timeoutMs, deadline = performance.now() + timeoutMs } = options
    const attempt = { ...options, timeoutMs, deadline }
    const response = await this.#send(url, body, attempt, this.#authorization(url))
    if (response.status !== 401 || !this.#digest) return response

    const challenge = parseChallenge(response.headers['www-authenticate'] ?? [])
    const repeated = this.#challenge !== undefined && challenge?.nonce === this.#challenge.nonce && !challenge.stale
    if (!challenge || repeated) return response

    this.#challenge = challenge
    this.#nonceCount = 0
    try {
      return await this.#send(url, body, attempt, this.#authorization(url))
    } catch (error) {
      // some devices drop the connection instead of rejecting the digest
      if (error instanceof TransportError) return response
      throw error
    }
  }

  close(): void {
    this.#httpAgent.destroy()
    this.#httpsAgent.destroy()
  }

  #authorization(url: URL): string | undefined {
    if (!this.#challenge || !this.#digest) return undefined
    this.#nonceCount += 1
    return digestAuthorization(this.#challenge, this.#digest, 'POST', url.pathname + url.search, this.#nonceCount)
  }

  async #send(url: URL, body: Body, options: AttemptOptions, authorization?: string): Promise<HttpResponse> {
    try {
      return await this.#attempt(url, body, options, authorization)
    } catch (error) {
      if (!(error instanceof RetryableReset)) throw error
      return await this.#attempt(url, body, options, authorization)
    }
  }

  #attempt(url: URL, body: Body, options: AttemptOptions, authorization?: string): Promise<HttpResponse> {
    const { signal, context = {}, action, timeoutMs, deadline } = options
    const remainingMs = Math.ceil(deadline - performance.now())
    if (remainingMs <= 0) return Promise.reject(new TimeoutError(`No response within ${timeoutMs} ms`, context))
    const timeout = AbortSignal.timeout(remainingMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    const secure = url.protocol === 'https:'
    if (!secure && url.protocol !== 'http:') {
      return Promise.reject(new TransportError(`Unsupported protocol ${url.protocol}`, context))
    }
    const payload = Buffer.from(typeof body === 'function' ? body() : body, 'utf8')
    const headers: Record<string, string | number> = {
      'Content-Type': `application/soap+xml; charset=utf-8${action ? `; action="${action.replaceAll('"', '%22')}"` : ''}`,
      'Content-Length': payload.length
    }
    if (authorization) headers['Authorization'] = authorization

    return new Promise((resolve, reject) => {
      let outgoing: ClientRequest | undefined
      let responded = false
      const fail = (error: unknown) => {
        if (timeout.aborted) {
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
            body: Buffer.concat(chunks).toString('utf8')
          })
        })
      }

      const agent = secure ? this.#httpsAgent : this.#httpAgent
      try {
        outgoing = (secure ? httpsRequest : httpRequest)(
          url,
          { method: 'POST', headers, agent, signal: combined },
          onResponse
        )
      } catch (error) {
        fail(error)
        return
      }
      outgoing.on('error', fail)
      combined.addEventListener('abort', fail, { once: true })
      outgoing.end(payload)
    })
  }
}
