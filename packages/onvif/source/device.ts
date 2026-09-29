import {
  AuthError,
  DecodeError,
  type ErrorContext,
  OnvifError,
  ParseError,
  SoapFaultError,
  TimeoutError,
  TransportError
} from '#errors.ts'
import {
  type Capabilities,
  type DateTime,
  GetCapabilities,
  GetDeviceInformation,
  GetServices,
  GetSystemDateAndTime
} from '#generated/device.ts'
import { addressingHeaders, type EndpointReference, referenceParameterHeaders } from '#soap/addressing.ts'
import { type Operation, decode, encodeRequest } from '#soap/codec.ts'
import { buildEnvelope, type Envelope, parseEnvelope } from '#soap/envelope.ts'
import { prefixes } from '#soap/namespaces.ts'
import { type Credentials, usernameToken } from '#soap/security.ts'
import type { XmlNode } from '#soap/serialize.ts'
import { HttpTransport, type HttpResponse, type TlsOptions } from '#transport/http.ts'

export const DEVICE_NAMESPACE = 'http://www.onvif.org/ver10/device/wsdl'

const CLOCK_TOLERANCE_MS = 1_000
const RESYNC_INTERVAL_MS = 60_000

/**
 * What to do with service addresses the device reports for an origin (protocol, host and port) other than the configured
 * one: `rewrite` keeps path and query but uses the configured origin (devices behind NAT, port forwarding or TLS
 * report their internal address), `reject` refuses to call them, `sameHost` keeps another port or HTTPS on the
 * configured host and rewrites the rest. No policy follows another host or turns HTTPS into HTTP.
 */
export type ServiceAddressPolicy = 'rewrite' | 'reject' | 'sameHost'

const DEFAULT_TIMEOUT_MS = 10_000

export type ConnectOptions = {
  hostname: string
  port?: number
  secure?: boolean
  /** Path of the device service, `/onvif/device_service` by default. */
  path?: string
  username?: string
  password?: string
  /** Time allowed for each call in milliseconds, retries included, 10 000 by default. */
  timeoutMs?: number
  maxResponseBytes?: number
  tls?: TlsOptions
  serviceAddresses?: ServiceAddressPolicy
  /**
   * Test the username and password while connecting. ONVIF has no login step and the calls `connect()` needs don't
   * require one, so a wrong password would otherwise only fail on the first call that does. Default `true`, costs one
   * extra `GetDeviceInformation`.
   */
  verifyCredentials?: boolean
  signal?: AbortSignal
}

export type CallOptions = {
  signal?: AbortSignal | undefined
  /**
   * Address or endpoint reference reported by the device for this call, such as a subscription reference. The address
   * policy applies to where the request goes; `wsa:To` carries the address as the device issued it, and the reference
   * parameters of an endpoint reference are sent back as headers.
   */
  to?: string | EndpointReference
  /** Send WS-Addressing `MessageID`, `To` and `Action` headers. */
  addressing?: boolean
  /** Overrides the connection timeout for this call, retries included, such as for a long poll. */
  timeoutMs?: number | undefined
}

export type Clock = {
  /** Device time minus local time, in milliseconds. */
  skewMs: number
  /** `device` when measured from the device's UTC time, `local` when the device did not report one. */
  source: 'device' | 'local'
}

type CallArguments<Request> =
  Record<string, never> extends Request
    ? [request?: Request, options?: CallOptions]
    : [request: Request, options?: CallOptions]

const capabilityNamespaces = {
  analytics: 'http://www.onvif.org/ver20/analytics/wsdl',
  device: DEVICE_NAMESPACE,
  events: 'http://www.onvif.org/ver10/events/wsdl',
  imaging: 'http://www.onvif.org/ver20/imaging/wsdl',
  media: 'http://www.onvif.org/ver10/media/wsdl',
  PTZ: 'http://www.onvif.org/ver20/ptz/wsdl'
} as const

const extensionNamespaces = {
  deviceIO: 'http://www.onvif.org/ver10/deviceIO/wsdl',
  display: 'http://www.onvif.org/ver10/display/wsdl',
  recording: 'http://www.onvif.org/ver10/recording/wsdl',
  search: 'http://www.onvif.org/ver10/search/wsdl',
  replay: 'http://www.onvif.org/ver10/replay/wsdl',
  receiver: 'http://www.onvif.org/ver10/receiver/wsdl',
  analyticsDevice: 'http://www.onvif.org/ver10/analyticsdevice/wsdl'
} as const

/**
 * Read a device date and time as UTC.
 *
 * @param dateTime - `UTCDateTime` from `GetSystemDateAndTime`
 * @returns Milliseconds since the epoch, or `undefined` if a field is out of range and `Date.UTC` would roll it over
 */
const utcTimeOf = (dateTime: DateTime): number | undefined => {
  const { date, time } = dateTime
  const fields = [date.year, date.month, date.day, time.hour, time.minute, time.second]
  const utc = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, time.second)
  const parsed = new Date(utc)
  const read = [
    parsed.getUTCFullYear(),
    parsed.getUTCMonth() + 1,
    parsed.getUTCDate(),
    parsed.getUTCHours(),
    parsed.getUTCMinutes(),
    parsed.getUTCSeconds()
  ]
  return read.every((value, index) => value === fields[index]) ? utc : undefined
}

const answeredBadly = (error: unknown): boolean =>
  error instanceof SoapFaultError ||
  error instanceof DecodeError ||
  error instanceof ParseError ||
  (error instanceof TransportError && error.status !== undefined)

const isActionRejection = (error: unknown): boolean =>
  error instanceof SoapFaultError &&
  (error.subcodes.includes('ActionNotSupported') || /cannot be processed at the receiver/i.test(error.reason))

export class Device {
  /** Address of the device service. */
  readonly address: URL
  readonly #transport: HttpTransport
  readonly #credentials: Credentials | undefined
  readonly #policy: ServiceAddressPolicy
  readonly #timeoutMs: number
  readonly #services = new Map<string, URL>()
  #clock: Clock = { skewMs: 0, source: 'local' }
  #synchronizedAt = { device: Date.now(), wall: Date.now(), monotonic: performance.now() }
  #sendAction = true
  #resynchronizing: Promise<void> | undefined

  private constructor(options: ConnectOptions) {
    const { hostname, secure = false, port, path = '/onvif/device_service', username, password = '' } = options
    const protocol = secure ? 'https' : 'http'
    const host = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname
    const pathname = path.startsWith('/') ? path : `/${path}`
    this.address = new URL(`${protocol}://${host}${port === undefined ? '' : `:${port}`}${pathname}`)
    this.#credentials = username === undefined ? undefined : { username, password }
    this.#policy = options.serviceAddresses ?? 'rewrite'
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#transport = new HttpTransport({
      timeoutMs: this.#timeoutMs,
      maxResponseBytes: options.maxResponseBytes,
      tls: options.tls,
      digest: this.#credentials
    })
    this.#services.set(DEVICE_NAMESPACE, this.address)
  }

  /**
   * Connect to a device: measure its clock, read its service addresses and check the credentials.
   *
   * @param options - Device address, credentials and transport settings
   * @returns The connected device
   * @throws {AuthError} If the credentials are rejected
   * @throws {TransportError} If the device cannot be reached
   */
  static async connect(options: ConnectOptions): Promise<Device> {
    const device = new Device(options)
    try {
      await device.synchronizeClock(options.signal)
      await device.#discoverServices(options.signal)
      if (options.verifyCredentials !== false) await device.#verifyCredentials(options.signal)
    } catch (error) {
      device.close()
      throw error
    }
    return device
  }

  get clock(): Clock {
    return { ...this.#clock }
  }

  /** Service addresses by namespace, after the address policy was applied. */
  get services(): ReadonlyMap<string, URL> {
    return new Map(this.#services)
  }

  /**
   * Measure the device clock with `GetSystemDateAndTime`. Tries without credentials first (the ONVIF spec says it
   * works without), then with credentials for devices that need them.
   *
   * @param signal - Abort signal
   */
  async synchronizeClock(signal?: AbortSignal): Promise<void> {
    const started = Date.now()
    const deadline = performance.now() + this.#timeoutMs
    let response
    try {
      response = await this.#call(GetSystemDateAndTime, {}, { signal }, deadline, false)
    } catch (error) {
      if (!(error instanceof AuthError) || !this.#credentials) throw error
      response = await this.#call(GetSystemDateAndTime, {}, { signal }, deadline, true)
    }
    const midpoint = (started + Date.now()) / 2
    const utc = response.systemDateAndTime.utcDateTime
    const deviceTime = utc ? utcTimeOf(utc) : undefined
    if (utc && deviceTime === undefined) {
      const { date, time } = utc
      throw new DecodeError(
        `Invalid date ${date.year}-${date.month}-${date.day} ${time.hour}:${time.minute}:${time.second}`,
        'GetSystemDateAndTimeResponse.SystemDateAndTime.UTCDateTime',
        this.#contextOf(GetSystemDateAndTime)
      )
    }
    this.#clock =
      deviceTime === undefined
        ? { skewMs: 0, source: 'local' }
        : { skewMs: Math.round(deviceTime - midpoint), source: 'device' }
    const wall = Date.now()
    this.#synchronizedAt = { device: wall + this.#clock.skewMs, wall, monotonic: performance.now() }
  }

  /**
   * Call an operation on the service it belongs to.
   *
   * @param operation - Generated operation
   * @param args - Request (optional when every field is optional) and call options
   * @returns The decoded response
   * @throws {AuthError} If the credentials are rejected; retried once if measuring the device clock again shows the
   *   estimate was off, measured again at most once a minute unless the host was suspended or its clock jumped
   * @throws {SoapFaultError} If the device answers with a fault
   * @throws {DecodeError} If the response does not match the schema
   * @throws {TransportError} On connection problems or unexpected HTTP responses
   * @throws {TimeoutError} If the device does not answer in time
   */
  async call<Request, Response>(
    operation: Operation<Request, Response>,
    ...args: CallArguments<Request>
  ): Promise<Response> {
    const [request = {} as Request, options = {}] = args
    const deadline = performance.now() + (options.timeoutMs ?? this.#timeoutMs)
    const synchronized = this.#synchronizedAt
    try {
      return await this.#call(operation, request, options, deadline, true)
    } catch (error) {
      if (!(error instanceof AuthError) || !this.#credentials) throw error
      const monotonicElapsed = performance.now() - synchronized.monotonic
      const wallElapsed = Date.now() - synchronized.wall
      const due =
        monotonicElapsed >= RESYNC_INTERVAL_MS || Math.abs(wallElapsed - monotonicElapsed) >= CLOCK_TOLERANCE_MS
      if (this.#synchronizedAt === synchronized && due) {
        await this.#awaitResynchronization(options, deadline, this.#contextOf(operation))
      }
      const current = this.#synchronizedAt
      const estimate = synchronized.device + (current.monotonic - synchronized.monotonic)
      if (Math.abs(current.device - estimate) < CLOCK_TOLERANCE_MS) throw error
      return await this.#call(operation, request, options, deadline, true)
    }
  }

  /**
   * Resolve an address reported by the device, applying the service address policy.
   *
   * @param address - Absolute URL from a device response
   * @returns The URL to send requests to
   * @throws {OnvifError} If the address is invalid or points to another origin under the `reject` policy
   */
  resolveAddress(address: string): URL {
    // an address without a host (RaySharp: `http:///onvif/...`) can only mean the device itself
    const hostless = /^https?:\/\/\//i.exec(address)
    if (hostless) return new URL(address.slice(hostless[0].length - 1), this.address.origin)
    let url: URL
    try {
      url = new URL(address)
    } catch {
      throw new OnvifError(`Invalid service address '${address.slice(0, 200)}'`, { host: this.address.host })
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new OnvifError(`Unsupported service address protocol ${url.protocol.slice(0, 32)}`, {
        host: this.address.host
      })
    }
    if (url.origin === this.address.origin) return url
    const sameHost = url.hostname === this.address.hostname
    const downgrade = this.address.protocol === 'https:' && url.protocol === 'http:'
    if (this.#policy === 'sameHost' && sameHost && !downgrade) return url
    if (this.#policy === 'reject') {
      throw new OnvifError(`Service address ${url.origin.slice(0, 200)} is not the configured origin`, {
        host: this.address.host
      })
    }
    return new URL(`${url.pathname}${url.search}`, this.address.origin)
  }

  /** Close idle connections. The device can still be used afterwards. */
  close(): void {
    this.#transport.close()
  }

  async #awaitResynchronization(options: CallOptions, deadline: number, context: ErrorContext): Promise<void> {
    const timeout = AbortSignal.timeout(Math.max(0, Math.ceil(deadline - performance.now())))
    const stop = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    stop.throwIfAborted()
    const stopped = new Promise<never>((_resolve, reject) => {
      const onStop = () =>
        reject(
          timeout.aborted
            ? new TimeoutError(`No response within ${options.timeoutMs ?? this.#timeoutMs} ms`, context)
            : stop.reason
        )
      stop.addEventListener('abort', onStop, { once: true })
    })
    await Promise.race([(this.#resynchronizing ??= this.#resynchronize()), stopped])
  }

  async #resynchronize(): Promise<void> {
    try {
      await this.synchronizeClock()
    } finally {
      this.#resynchronizing = undefined
    }
  }

  async #verifyCredentials(signal?: AbortSignal): Promise<void> {
    if (!this.#credentials) return
    try {
      await this.call(GetDeviceInformation, {}, { signal })
    } catch (error) {
      if (error instanceof AuthError || !(error instanceof SoapFaultError)) throw error
    }
  }

  async #discoverServices(signal?: AbortSignal): Promise<void> {
    const options = { signal }
    let addresses: [string, string][] | undefined
    try {
      const { service } = await this.call(GetServices, { includeCapability: false }, options)
      addresses = service.map((entry) => [entry.namespace, entry.xAddr])
    } catch (error) {
      if (!answeredBadly(error)) throw error
    }
    if (!addresses?.some(([namespace]) => namespace !== DEVICE_NAMESPACE)) {
      try {
        const { capabilities } = await this.call(GetCapabilities, { category: ['All'] }, options)
        addresses = this.#capabilityAddresses(capabilities)
      } catch (error) {
        if (addresses === undefined || !answeredBadly(error)) throw error
      }
    }
    for (const [namespace, address] of addresses ?? []) {
      if (namespace === DEVICE_NAMESPACE) continue
      try {
        this.#services.set(namespace, this.resolveAddress(address))
      } catch {
        this.#services.delete(namespace)
      }
    }
  }

  #capabilityAddresses(capabilities: Capabilities): [string, string][] {
    const addresses: [string, string][] = []
    for (const [key, namespace] of Object.entries(capabilityNamespaces)) {
      const address = capabilities[key as keyof typeof capabilityNamespaces]?.xAddr
      if (address) addresses.push([namespace, address])
    }
    for (const [key, namespace] of Object.entries(extensionNamespaces)) {
      const address = capabilities.extension?.[key as keyof typeof extensionNamespaces]?.xAddr
      if (address) addresses.push([namespace, address])
    }
    return addresses
  }

  #now(): Date {
    return new Date(this.#synchronizedAt.device + (performance.now() - this.#synchronizedAt.monotonic))
  }

  #contextOf<Request, Response>(operation: Operation<Request, Response>): ErrorContext {
    return {
      host: this.address.host,
      service: prefixes[operation.request.namespace] ?? operation.request.namespace,
      action: operation.name
    }
  }

  #target<Request, Response>(operation: Operation<Request, Response>, to: string | undefined): URL {
    if (to !== undefined) return this.resolveAddress(to)
    const url = this.#services.get(operation.request.namespace)
    if (!url) {
      throw new OnvifError(`The device does not offer the service ${operation.request.namespace}`, {
        host: this.address.host,
        action: operation.name
      })
    }
    return url
  }

  async #call<Request, Response>(
    operation: Operation<Request, Response>,
    request: Request,
    options: CallOptions,
    deadline: number,
    authenticated: boolean
  ): Promise<Response> {
    const to = typeof options.to === 'object' ? options.to.address.value : options.to
    const url = this.#target(operation, to)
    const context = this.#contextOf(operation)
    const element = encodeRequest(operation, request)
    const envelopeFor = (): string => {
      const header: XmlNode[] = []
      if (options.addressing) header.push(...addressingHeaders(operation.action, to ?? url.href))
      if (typeof options.to === 'object') header.push(...referenceParameterHeaders(options.to))
      if (authenticated && this.#credentials) header.push(usernameToken(this.#credentials, this.#now()))
      return buildEnvelope(element, header)
    }
    const namespaces = operation.namespaces === true

    const send = async (action: string | undefined): Promise<Envelope> => {
      const { signal, timeoutMs = this.#timeoutMs } = options
      const response = await this.#transport.post(url, envelopeFor, { context, signal, timeoutMs, deadline, action })
      return this.#read(response, context, namespaces)
    }

    const action = this.#sendAction ? operation.action : undefined
    let envelope
    try {
      envelope = await send(action)
    } catch (error) {
      if (action === undefined || !isActionRejection(error)) throw error
      envelope = await send(undefined)
      this.#sendAction = false
    }

    const result = envelope.body[operation.response.name]
    if (result === undefined) {
      throw new DecodeError(`Missing ${operation.response.name} in the response body`, 'Body', context)
    }
    return decode(operation.schema, operation.response.type, result, context) as Response
  }

  #read(response: HttpResponse, context: ErrorContext, namespaces: boolean): Envelope {
    const { status, body } = response
    const soap = body.trimStart().startsWith('<')
    const success = status >= 200 && status < 300
    if (status === 401) {
      try {
        if (soap) parseEnvelope(body, context)
      } catch (error) {
        if (error instanceof AuthError) throw error
        if (error instanceof SoapFaultError) {
          const { code, subcodes, reason } = error
          throw new AuthError(`Not authorized: ${reason}`, context, { code, subcodes, reason })
        }
      }
      throw new AuthError('Not authorized (HTTP 401)', context)
    }
    if (success && body.length === 0) throw new TransportError('Empty response', context, { status })
    const envelope = soap ? parseEnvelope(body, context, undefined, { namespaces }) : undefined
    if (!success || !envelope) throw new TransportError(`Unexpected HTTP ${status} response`, context, { status })
    return envelope
  }
}
