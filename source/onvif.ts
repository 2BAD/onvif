import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import https, { type Agent, type RequestOptions } from 'node:https'
import type { SecureContextOptions } from 'node:tls'
import { Device } from './device.ts'
import type { GetDeviceInformationResponse } from './interfaces/deviceManagement.ts'
import type { Capabilities, DateTime, Profile } from './interfaces/onvif.ts'
import { Media } from './media.ts'
import { PTZ } from './ptz.ts'
import { linerase, parseSOAPString } from './utils.ts'

/**
 * Cam constructor options
 */
export type OnvifOptions = {
  /** Set true if using `https` protocol, defaults to false. */
  useSecure?: boolean
  /** Set options for https like ca, cert, ciphers, rejectUnauthorized, secureOptions, secureProtocol, etc. */
  secureOptions?: SecureContextOptions
  hostname: string
  username?: string
  password?: string
  port?: number
  path?: string
  timeout?: number
  urn?: string
  /** Supports things like https://www.npmjs.com/package/proxy-agent which provide SOCKS5 and other connections. */
  agent?: Agent | boolean
  /** Force using hostname and port from constructor for the services (ex.: for proxying), defaults to false. */
  preserveAddress?: boolean
  /** Set false if the camera should not connect automatically, defaults false. */
  autoConnect?: boolean
}

export type OnvifServices = {
  PTZ?: URL
  analyticsDevice?: URL
  device?: URL
  deviceIO?: URL
  display?: URL
  events?: URL
  imaging?: URL
  media2?: URL
  media?: URL
  receiver?: URL
  recording?: URL
  replay?: URL
  search?: URL
  [key: string]: URL | undefined
}

export type OnvifRequestOptions = {
  /** Name of service (ptz, media, etc) */
  service?: keyof OnvifServices
  /** SOAP body */
  body: string
  /** Defines another url to request */
  url?: string
  /** Make request to PTZ uri or not */
  ptz?: boolean
} & RequestOptions

type RequestError = {
  code: string
  errno: string
  syscall: string
} & Error

/**
 * Information about active video source
 */
export type ActiveSource = {
  sourceToken: string
  profileToken: string
  videoSourceConfigurationToken: string
  encoding?: string
  width?: number
  height?: number
  fps?: number
  bitrate?: number
  ptz?: {
    name: string
    token: string
  }
}

export type SetSystemDateAndTimeOptions = {
  dateTime?: Date
  dateTimeType: 'Manual' | 'NTP'
  daylightSavings?: boolean
  /**
   * The TZ format is specified by POSIX, please refer to POSIX 1003.1 section 8.3
   * Example: Europe, Paris TZ=CET-1CEST,M3.5.0/2,M10.5.0/3
   * CET = designation for standard time when daylight saving is not in force
   * -1 = offset in hours = negative so 1 hour east of Greenwich meridian
   * CEST = designation when daylight saving is in force ("Central European Summer Time")
   * , = no offset number between code and comma, so default to one hour ahead for daylight saving
   * M3.5.0 = when daylight saving starts = the last Sunday in March (the "5th" week means the last in the month)
   * /2, = the local time when the switch occurs = 2 a.m. in this case
   * M10.5.0 = when daylight saving ends = the last Sunday in October.
   * /3, = the local time when the switch occurs = 3 a.m. in this case
   */
  timezone?: string
}

export class Onvif extends EventEmitter {
  /**
   * Indicates raw xml request to device.
   *
   * @event rawRequest
   * @example
   * ```typescript
   * onvif.on('rawRequest', (xml) => { console.log('-> request was', xml); });
   * ```
   */
  static rawRequest = 'rawRequest' as const
  /**
   * Indicates raw xml response from device.
   *
   * @event rawResponse
   * @example
   * ```typescript
   * onvif.on('rawResponse', (xml) => { console.log('<- response was', xml); });
   * ```
   */
  static rawResponse = 'rawResponse' as const
  /**
   * Indicates any warnings
   *
   * @event warn
   * @example
   * ```typescript
   * onvif.on('warn', console.warn);
   * ```
   */
  static warn = 'warn' as const
  /**
   * Indicates any errors
   *
   * @param error - Error object
   * @event error
   * @example
   * ```typescript
   * onvif.on('error', console.error);
   * ```
   */
  static error = 'error' as const

  /**
   * Core device namespace for device v1.0 methods
   *
   * @example
   * ```typescript
   * const date = await onvif.device.getSystemDateAndTime();
   * console.log(date.toLocaleString());
   * ```
   */
  public readonly device: Device
  public readonly media: Media
  public readonly ptz: PTZ
  public useSecure: boolean
  public secureOptions: SecureContextOptions
  public hostname: string
  public username?: string | undefined
  public password?: string | undefined
  public port: number
  public path: string
  public timeout: number
  public agent: Agent | boolean
  public preserveAddress = false
  // private events: Record<string, unknown>
  public uri: OnvifServices
  private timeShift?: number
  public capabilities: Capabilities
  public defaultProfiles: Profile[] = []
  public defaultProfile?: Profile
  // @ts-expect-error TODO investigate this
  private activeSources: ActiveSource[] = []
  public activeSource?: ActiveSource
  public readonly urn?: string | undefined
  public deviceInformation?: GetDeviceInformationResponse

  constructor(options: OnvifOptions) {
    super()
    this.useSecure = options.useSecure ?? false
    this.secureOptions = options.secureOptions ?? {}
    this.hostname = options.hostname
    this.username = options.username
    this.password = options.password
    this.port = options.port ?? (options.useSecure ? 443 : 80)
    this.path = options.path ?? '/onvif/device_service'
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    this.timeout = options.timeout || 120000
    this.urn = options.urn
    this.agent = options.agent ?? false
    this.preserveAddress = options.preserveAddress ?? false
    // this.events = {}
    this.uri = {}
    this.capabilities = {}

    this.device = new Device(this)
    this.media = new Media(this)
    this.ptz = new PTZ(this)

    /** Bind event handling to the `event` event */
    this.on('newListener', (name) => {
      // if this is the first listener, start pulling subscription
      if (name === 'event' && this.listeners(name).length === 0) {
        setImmediate(() => {
          // this._eventRequest(); TODO bring back
        })
      }
    })
    if (options.autoConnect) {
      setImmediate(() => {
        this.connect().catch((error) => this.emit('error', error))
      })
    }
  }

  /**
   * Envelope header for all SOAP messages
   *
   * @param openHeader
   */
  private envelopeHeader(openHeader = false): string {
    const headerStart = `
    <s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing">
      <s:Header>
  `.trim()

    // Only insert Security if there is a username and password
    let securitySection = ''
    if (this.username && this.password) {
      const req = this.passwordDigest()
      securitySection = `
      <Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
        <UsernameToken>
          <Username>${this.username}</Username>
          <Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${req.passDigest}</Password>
          <Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${req.nonce}</Nonce>
          <Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${req.timestamp}</Created>
        </UsernameToken>
      </Security>
    `.trim()
    }

    const headerEnd = openHeader
      ? ''
      : `
      </s:Header>
      <s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  `.trim()

    return `${headerStart}${securitySection}${headerEnd}`
  }

  /**
   * Envelope footer for all SOAP messages
   *
   */
  // eslint-disable-next-line @typescript-eslint/class-methods-use-this
  private envelopeFooter(): string {
    return '</s:Body></s:Envelope>'
  }

  private passwordDigest(): { passDigest: string; nonce: string; timestamp: string } {
    if (this.password === undefined) {
      throw new Error('Password is undefined')
    }

    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const timestamp = new Date(process.uptime() * 1000 + (this.timeShift || 0)).toISOString()
    const nonce = Buffer.allocUnsafe(16)
    nonce.writeUIntLE(Math.ceil(Math.random() * 0x100000000), 0, 4)
    nonce.writeUIntLE(Math.ceil(Math.random() * 0x100000000), 4, 4)
    nonce.writeUIntLE(Math.ceil(Math.random() * 0x100000000), 8, 4)
    nonce.writeUIntLE(Math.ceil(Math.random() * 0x100000000), 12, 4)
    const cryptoDigest = crypto.createHash('sha1')
    cryptoDigest.update(Buffer.concat([nonce, Buffer.from(timestamp, 'ascii'), Buffer.from(this.password, 'ascii')]))
    const passDigest = cryptoDigest.digest('base64')
    return {
      passDigest,
      nonce: nonce.toString('base64'),
      timestamp
    }
  }

  private setupSystemDateAndTime(data: Record<string, unknown>): Date {
    // @ts-expect-error TODO: improve type signature
    const systemDateAndTime = data[0]?.getSystemDateAndTimeResponse?.[0]?.systemDateAndTime?.[0]
    if (!systemDateAndTime) {
      throw new Error('Invalid data structure: systemDateAndTime not found')
    }

    const dateTime = systemDateAndTime.UTCDateTime || systemDateAndTime.localDateTime

    // eslint-disable-next-line @typescript-eslint/init-declarations
    let time: Date
    if (!dateTime) {
      // Fallback to current time if dateTime is undefined
      time = new Date()
    } else {
      const dt = linerase(dateTime[0]) as DateTime
      if (
        !dt.date ||
        !dt.time ||
        !dt.date.year ||
        !dt.date.month ||
        !dt.date.day ||
        !dt.time.hour ||
        !dt.time.minute ||
        !dt.time.second
      ) {
        throw new Error('Invalid date or time structure')
      }
      time = new Date(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        Date.UTC(dt.date.year, dt.date.month - 1, dt.date.day, dt.time.hour, dt.time.minute, dt.time.second)
      )
    }

    if (!this.timeShift) {
      this.timeShift = time.getTime() - process.uptime() * 1000
    }

    return time
  }

  private async rawRequest(options: OnvifRequestOptions): Promise<[Record<string, any>, string]> {
    return await new Promise((resolve, reject) => {
      let alreadyReturned = false
      const requestOptions: RequestOptions = {
        ...options,
        hostname: this.hostname,
        path: options.service
          ? this.uri[options.service]
            ? this.uri[options.service]!.pathname
            : this.path
          : this.path,
        port: this.port,
        agent: this.agent, // Supports things like https://www.npmjs.com/package/proxy-agent which provide SOCKS5 and other connections}
        timeout: this.timeout
      }
      requestOptions.headers = {
        'Content-Type': 'application/soap+xml',
        'Content-Length': Buffer.byteLength(options.body, 'utf8'),
        charset: 'utf-8'
      }
      requestOptions.method = 'POST'
      const httpLibrary = this.useSecure ? https : http
      if (this.useSecure) {
        Object.assign(requestOptions, this.secureOptions)
      }
      const request = httpLibrary.request(requestOptions, (response) => {
        const buf: Buffer[] = []
        let length = 0

        response.on('data', (chunk) => {
          buf.push(chunk)
          length += chunk.length
        })

        response.on('end', () => {
          if (alreadyReturned) {
            return
          }
          alreadyReturned = true
          const xml = Buffer.concat(buf, length).toString('utf8')
          /**
           * Indicates raw xml response from device.
           *
           * @event Onvif#rawResponse
           */
          this.emit('rawResponse', xml)
          resolve(parseSOAPString(xml))
        })
      })

      request.setTimeout(this.timeout, () => {
        if (alreadyReturned) {
          return
        }
        alreadyReturned = true
        request.destroy()
        reject(new Error('Network timeout'))
      })

      request.on('error', (error: RequestError) => {
        if (alreadyReturned) {
          return
        }
        alreadyReturned = true
        /* address, port number or IPCam error */
        if (error.code === 'ECONNREFUSED' && error.errno === 'ECONNREFUSED' && error.syscall === 'connect') {
          reject(error)
          /* network error */
        } else if (error.code === 'ECONNRESET' && error.errno === 'ECONNRESET' && error.syscall === 'read') {
          reject(error)
        } else {
          reject(error)
        }
      })

      this.emit('rawRequest', options.body, requestOptions)
      request.write(options.body)
      request.end()
    })
  }

  public request<T>(options: OnvifRequestOptions): Promise<[T, string]> {
    if (!options.body) {
      throw new Error("There is no 'body' field in request options")
    }
    return this.rawRequest({
      ...options,
      body: `${this.envelopeHeader()}${options.body}${this.envelopeFooter()}`
    }) as Promise<[T, string]>
  }

  /**
   * Parse url with an eye on `preserveAddress` property
   *
   * @param address
   */
  public parseUrl(address: string): URL {
    const parsedAddress = new URL(address)
    // If host for service and default host differs, also if preserve address property set
    // we substitute host, hostname and port from settings then rebuild the href using .format
    if (
      this.preserveAddress &&
      (this.hostname !== parsedAddress.hostname || this.port.toString() !== parsedAddress.port)
    ) {
      parsedAddress.hostname = this.hostname
      parsedAddress.host = `${this.hostname}:${this.port}`
      parsedAddress.port = this.port.toString()
      parsedAddress.href = parsedAddress.toString()
    }
    return parsedAddress
  }

  /**
   * Receive date and time from cam
   */
  async getSystemDateAndTime(): Promise<Date> {
    // The ONVIF spec says this should work without a Password as we need to know any difference in the
    // remote NVTs time relative to our own time clock (called the timeShift) before we can calculate the
    // correct timestamp in nonce SOAP Authentication header.
    // But... Panasonic and Digital Barriers both have devices that implement ONVIF that only work with
    // authenticated getSystemDateAndTime. So for these devices we need to do an authenticated getSystemDateAndTime.
    // As 'timeShift' is not set, the local clock MUST be set to the correct time AND the NVT/Camera MUST be set
    // to the correct time if the camera implements Replay Attack Protection (e.g. Axis)
    const [data, xml] = await this.rawRequest({
      // Try the Unauthenticated Request first. Do not use this._envelopeHeader() as we don't have timeShift yet.
      body:
        '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">' +
        '<s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
        '<GetSystemDateAndTime xmlns="http://www.onvif.org/ver10/device/wsdl"/>' +
        '</s:Body>' +
        '</s:Envelope>'
    })
    try {
      return this.setupSystemDateAndTime(data)
    } catch (error) {
      if (xml?.toLowerCase().includes('sender not authorized')) {
        // Try again with a Username and Password
        const [data] = await this.request({
          body: '<GetSystemDateAndTime xmlns="http://www.onvif.org/ver10/device/wsdl"/>}'
        })
        // @ts-expect-error this should be typed by request function
        return this.setupSystemDateAndTime(data)
      }
      // @TODO: fix later
      throw error as Error
    }
  }
  /**
   * Set the device system date and time
   *
   * @param options
   */
  async setSystemDateAndTime(options: SetSystemDateAndTimeOptions): Promise<Date> {
    if (!['Manual', 'NTP'].includes(options.dateTimeType)) {
      throw new Error('DateTimeType should be `Manual` or `NTP`')
    }
    const [data] = await this.request({
      // Try the Unauthenticated Request first. Do not use this._envelopeHeader() as we don't have timeShift yet.
      body: `
      <SetSystemDateAndTime xmlns="http://www.onvif.org/ver10/device/wsdl">
        <DateTimeType>${options.dateTimeType}</DateTimeType>
        <DaylightSavings>${!!options.daylightSavings}</DaylightSavings>
        ${
          options.timezone !== undefined
            ? `
          <TimeZone>
            <TZ xmlns="http://www.onvif.org/ver10/schema">${options.timezone}</TZ>
          </TimeZone>
        `
            : ''
        }
        ${
          options.dateTime !== undefined && options.dateTime instanceof Date
            ? `
          <UTCDateTime>
            <Time xmlns="http://www.onvif.org/ver10/schema">
              <Hour>${options.dateTime.getUTCHours()}</Hour>
              <Minute>${options.dateTime.getUTCMinutes()}</Minute>
              <Second>${options.dateTime.getUTCSeconds()}</Second>
            </Time>
            <Date xmlns="http://www.onvif.org/ver10/schema">
              <Year>${options.dateTime.getUTCFullYear()}</Year>
              <Month>${options.dateTime.getUTCMonth() + 1}</Month>
              <Day>${options.dateTime.getUTCDate()}</Day>
            </Date>
          </UTCDateTime>
        `
            : ''
        }
      </SetSystemDateAndTime>
    `
        .trim()
        .replace(/\n\s+/g, '')
    })
    // @ts-expect-error this should be typed by request function
    if (linerase(data).setSystemDateAndTimeResponse !== '') {
      // @ts-expect-error this should be typed by request function
      throw new Error(`Wrong 'SetSystemDateAndTime' response: '${linerase(data).setSystemDateAndTimeResponse}'`)
    }
    // get new system time from device
    return await this.getSystemDateAndTime()
  }

  /**
   * Check and find out video configuration for device
   *
   */
  async getActiveSources(): Promise<void> {
    this.activeSources = this.media.videoSources
      .map((videoSource, idx) => {
        const videoSrcToken = videoSource.token
        const appropriateProfiles = this.media.profiles.filter(
          (profile) =>
            profile.videoSourceConfiguration?.sourceToken === videoSrcToken &&
            profile.videoEncoderConfiguration !== undefined
        )

        if (appropriateProfiles.length === 0 || appropriateProfiles[0] === undefined) {
          if (idx === 0) throw new Error('Unrecognized configuration')
          return null
        }

        const defaultProfile = appropriateProfiles[0]

        if (idx === 0) this.defaultProfile = defaultProfile
        this.defaultProfiles[idx] = defaultProfile

        const activeSource: ActiveSource = {
          sourceToken: videoSource.token,
          profileToken: defaultProfile.token,
          // @ts-expect-error TODO: fix this
          videoSourceConfigurationToken: defaultProfile.videoSourceConfiguration?.token
        }

        const encoderConfig = defaultProfile.videoEncoderConfiguration
        if (
          encoderConfig &&
          encoderConfig.encoding !== undefined &&
          encoderConfig.resolution?.width !== undefined &&
          encoderConfig.resolution.height !== undefined &&
          encoderConfig.rateControl?.frameRateLimit !== undefined &&
          encoderConfig.rateControl.bitrateLimit !== undefined
        ) {
          activeSource.encoding = encoderConfig.encoding
          activeSource.width = encoderConfig.resolution?.width
          activeSource.height = encoderConfig.resolution?.height
          activeSource.fps = encoderConfig.rateControl?.frameRateLimit
          activeSource.bitrate = encoderConfig.rateControl?.bitrateLimit
        }

        if (idx === 0) this.activeSource = activeSource

        const ptzConfig = defaultProfile.PTZConfiguration
        if (ptzConfig) {
          activeSource.ptz = {
            name: ptzConfig.name ?? '',
            token: ptzConfig.token
          }
        }

        return activeSource
      })
      .filter((source): source is ActiveSource => source !== null)
  }

  /**
   * Connect to the camera and fill device information properties
   */
  async connect(): Promise<Onvif> {
    await this.getSystemDateAndTime()
    // Try to get services (new approach). If not, get capabilities
    try {
      await this.device.getServices()
    } catch (error) {
      await this.device.getCapabilities()
    }
    await Promise.all([this.media.getProfiles(), this.media.getVideoSources()])
    await this.getActiveSources()
    this.emit('connect')
    return this
  }
}
