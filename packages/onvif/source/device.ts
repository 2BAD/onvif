import { AuthError, DecodeError, type ErrorContext, OnvifError, SoapFaultError, TransportError } from '#errors.ts'
import {
  type Capabilities,
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

/**
 * What to do with service addresses the device reports for a host other than the one the client was configured with:
 * `rewrite` keeps path and query but uses the configured origin (devices behind NAT or port forwarding report their
 * internal address), `reject` refuses to call them, `trust` uses them as given.
 */
export type ServiceAddressPolicy = 'rewrite' | 'reject' | 'trust'

export type ConnectOptions = {
  hostname: string
  port?: number
  secure?: boolean
  /** Path of the device service, `/onvif/device_service` by default. */
  path?: string
  username?: string
  password?: string
  /** Per request timeout in milliseconds, 10 000 by default. */
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
  signal?: AbortSignal
  /**
   * Address or endpoint reference reported by the device for this call, such as a subscription reference. The address
   * policy applies to where the request goes; `wsa:To` carries the address as the device issued it, and the reference
   * parameters of an endpoint reference are sent back as headers.
   */
  to?: string | EndpointReference
  /** Send WS-Addressing `MessageID`, `To` and `Action` headers. */
  addressing?: boolean
  /** Overrides the connection timeout for this call, such as for a long poll. */
  timeoutMs?: number
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

const isActionRejection = (error: unknown): boolean =>
  error instanceof SoapFaultError &&
  (error.subcodes.includes('ActionNotSupported') || /cannot be processed at the receiver/i.test(error.reason))

const sameHost = (left: URL, right: URL): boolean => left.hostname.toLowerCase() === right.hostname.toLowerCase()

export class Device {
  /** Address of the device service. */
  readonly address: URL
  readonly #transport: HttpTransport
  readonly #credentials: Credentials | undefined
  readonly #policy: ServiceAddressPolicy
  readonly #services = new Map<string, URL>()
  #clock: Clock = { skewMs: 0, source: 'local' }
  #synchronizedAt = { device: Date.now(), monotonic: performance.now() }
  #sendAction = true

  private constructor(options: ConnectOptions) {
    const { hostname, secure = false, port, path = '/onvif/device_service', username, password = '' } = options
    const protocol = secure ? 'https' : 'http'
    const host = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname
    this.address = new URL(`${protocol}://${host}${port === undefined ? '' : `:${port}`}${path}`)
    this.#credentials = username === undefined ? undefined : { username, password }
    this.#policy = options.serviceAddresses ?? 'rewrite'
    this.#transport = new HttpTransport({
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxResponseBytes === undefined ? {} : { maxResponseBytes: options.maxResponseBytes }),
      ...(options.tls === undefined ? {} : { tls: options.tls }),
      ...(this.#credentials === undefined ? {} : { digest: this.#credentials })
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
    let response
    try {
      response = await this.#call(GetSystemDateAndTime, {}, signal ? { signal } : {}, false)
    } catch (error) {
      if (!(error instanceof AuthError) || !this.#credentials) throw error
      response = await this.#call(GetSystemDateAndTime, {}, signal ? { signal } : {}, true)
    }
    const midpoint = (started + Date.now()) / 2
    const utc = response.systemDateAndTime.utcDateTime
    const deviceTime = utc
      ? Date.UTC(utc.date.year, utc.date.month - 1, utc.date.day, utc.time.hour, utc.time.minute, utc.time.second)
      : undefined
    this.#clock =
      deviceTime === undefined || Number.isNaN(deviceTime)
        ? { skewMs: 0, source: 'local' }
        : { skewMs: Math.round(deviceTime - midpoint), source: 'device' }
    this.#synchronizedAt = { device: midpoint + this.#clock.skewMs, monotonic: performance.now() }
  }

  /**
   * Call an operation on the service it belongs to.
   *
   * @param operation - Generated operation
   * @param args - Request (optional when every field is optional) and call options
   * @returns The decoded response
   * @throws {AuthError} If the credentials are rejected after one clock resynchronization
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
    try {
      return await this.#call(operation, request, options, true)
    } catch (error) {
      if (!(error instanceof AuthError) || !this.#credentials) throw error
      await this.synchronizeClock(options.signal)
      return await this.#call(operation, request, options, true)
    }
  }

  /**
   * Resolve an address reported by the device, applying the service address policy.
   *
   * @param address - Absolute URL from a device response
   * @returns The URL to send requests to
   * @throws {OnvifError} If the address is invalid or points to another host under the `reject` policy
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
      throw new OnvifError(`Unsupported service address protocol ${url.protocol}`, { host: this.address.host })
    }
    if (sameHost(url, this.address) || this.#policy === 'trust') return url
    if (this.#policy === 'reject') {
      throw new OnvifError(`Service address ${url.host} is not the configured host`, { host: this.address.host })
    }
    return new URL(`${url.pathname}${url.search}`, this.address.origin)
  }

  /** Close idle connections. The device can still be used afterwards. */
  close(): void {
    this.#transport.close()
  }

  async #verifyCredentials(signal?: AbortSignal): Promise<void> {
    if (!this.#credentials) return
    try {
      await this.call(GetDeviceInformation, {}, signal ? { signal } : {})
    } catch (error) {
      if (error instanceof AuthError || !(error instanceof SoapFaultError)) throw error
    }
  }

  async #discoverServices(signal?: AbortSignal): Promise<void> {
    const options = signal ? { signal } : {}
    let addresses: [string, string][]
    try {
      const { service } = await this.call(GetServices, { includeCapability: false }, options)
      addresses = service.map((entry) => [entry.namespace, entry.xAddr])
    } catch (error) {
      if (!(error instanceof SoapFaultError) || error instanceof AuthError) throw error
      addresses = this.#capabilityAddresses(
        (await this.call(GetCapabilities, { category: ['All'] }, options)).capabilities
      )
    }
    for (const [namespace, address] of addresses) {
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
    authenticated: boolean
  ): Promise<Response> {
    const to = typeof options.to === 'object' ? options.to.address.value : options.to
    const url = this.#target(operation, to)
    const context: ErrorContext = {
      host: this.address.host,
      service: prefixes[operation.request.namespace] ?? operation.request.namespace,
      action: operation.name
    }
    const element = encodeRequest(operation, request)
    const envelopeFor = (): string => {
      const header: XmlNode[] = []
      if (options.addressing) header.push(...addressingHeaders(operation.action, to ?? url.href))
      if (typeof options.to === 'object') header.push(...referenceParameterHeaders(options.to))
      if (authenticated && this.#credentials) header.push(usernameToken(this.#credentials, this.#now()))
      return buildEnvelope(element, header)
    }
    const namespaces = operation.namespaces === true

    const action = this.#sendAction ? operation.action : undefined
    let envelope
    try {
      envelope = this.#read(await this.#post(url, envelopeFor(), action, options, context), context, namespaces)
    } catch (error) {
      if (action === undefined || !isActionRejection(error)) throw error
      envelope = this.#read(await this.#post(url, envelopeFor(), undefined, options, context), context, namespaces)
      this.#sendAction = false
    }

    const result = envelope.body[operation.response.name]
    if (result === undefined) {
      throw new DecodeError(`Missing ${operation.response.name} in the response body`, 'Body', context)
    }
    return decode(operation.schema, operation.response.type, result, context) as Response
  }

  #post(
    url: URL,
    body: string,
    action: string | undefined,
    options: CallOptions,
    context: ErrorContext
  ): Promise<HttpResponse> {
    const { signal, timeoutMs } = options
    return this.#transport.post(url, body, {
      context,
      ...(signal ? { signal } : {}),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(action === undefined ? {} : { action })
    })
  }

  #read(response: HttpResponse, context: ErrorContext, namespaces: boolean): Envelope {
    const soap = response.body.trimStart().startsWith('<')
    const success = response.status >= 200 && response.status < 300
    if (response.status === 401) {
      try {
        if (soap) parseEnvelope(response.body, context)
      } catch (error) {
        if (error instanceof AuthError) throw error
        if (error instanceof SoapFaultError) {
          const { code, subcodes, reason } = error
          throw new AuthError(`Not authorized: ${reason}`, context, { code, subcodes, reason })
        }
      }
      throw new AuthError('Not authorized (HTTP 401)', context)
    }
    if (success && response.body.length === 0) {
      throw new TransportError('Empty response', context, { status: response.status })
    }
    if (!soap) {
      throw new TransportError(`Unexpected HTTP ${response.status} response`, context, { status: response.status })
    }
    const envelope = parseEnvelope(response.body, context, undefined, { namespaces })
    if (!success) {
      throw new TransportError(`Unexpected HTTP ${response.status} response`, context, { status: response.status })
    }
    return envelope
  }
}
