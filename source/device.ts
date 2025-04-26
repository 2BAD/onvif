import type {
  DeviceServiceCapabilities,
  GetCapabilities,
  GetCapabilitiesResponse,
  GetDeviceInformationResponse,
  GetServiceCapabilitiesResponse,
  GetServices,
  GetServicesResponse,
  Service,
  SetNTP
} from './interfaces/deviceManagement.ts'
import type {
  Capabilities,
  CapabilitiesExtension,
  DNSInformation,
  HostnameInformation,
  NTPInformation,
  NetworkInterface,
  Scope
} from './interfaces/onvif.ts'
import type { Onvif, OnvifServices, SetSystemDateAndTimeOptions } from './onvif.ts'
import { linerase } from './utils/xml.ts'

/**
 * Device methods
 */
export class Device {
  private readonly onvif: Onvif
  #services: Service[] = []
  get services(): Service[] {
    return this.#services
  }
  public media2Support = false
  #scopes: Scope[] = []
  get scopes(): Scope[] {
    return this.#scopes
  }
  #serviceCapabilities: DeviceServiceCapabilities = {}
  get serviceCapabilities(): DeviceServiceCapabilities {
    return this.#serviceCapabilities
  }
  #NTP?: NTPInformation
  get NTP(): NTPInformation | undefined {
    return this.#NTP
  }
  #DNS?: DNSInformation
  get DNS(): DNSInformation | undefined {
    return this.#NTP
  }
  #networkInterfaces?: NetworkInterface[]
  get networkInterfaces(): NetworkInterface[] | undefined {
    return this.#networkInterfaces
  }

  constructor(onvif: Onvif) {
    this.onvif = onvif
  }

  getSystemDateAndTime(): Promise<Date> {
    return this.onvif.getSystemDateAndTime()
  }

  async setSystemDateAndTime(options: SetSystemDateAndTimeOptions): Promise<void> {
    await this.onvif.setSystemDateAndTime(options)
  }

  /**
   * Retrieves information about device services.
   *
   * @param options - Request options
   * @param [options.includeCapability] - Include capability information
   */
  async getServices({ includeCapability }: GetServices = { includeCapability: true }): Promise<GetServicesResponse> {
    const [data] = await this.onvif.request({
      body: `
        <GetServices xmlns="http://www.onvif.org/ver10/device/wsdl">
          <IncludeCapability>${includeCapability}</IncludeCapability>
        </GetServices>
      `.trim()
    })
    // @ts-expect-error TODO: probably should cast to type
    const result = linerase(data).getServicesResponse
    this.#services = result.service
    // ONVIF Profile T introduced Media2 (ver20) so cameras from around 2020/2021 will have
    // two media entries in the ServicesResponse, one for Media (ver10/media) and one for Media2 (ver20/media)
    // This is so that existing VMS software can still access the video via the original ONVIF Media API
    // fill Cam#uri property
    for (const service of this.services) {
      // Look for services with namespaces and XAddr values
      if (
        Object.prototype.hasOwnProperty.call(service, 'namespace') &&
        Object.prototype.hasOwnProperty.call(service, 'XAddr')
      ) {
        // Only parse ONVIF namespaces. Axis cameras return Axis namespaces in GetServices
        if (!service.namespace || !service.XAddr) {
          continue
        }
        const parsedNamespace = new URL(service.namespace)
        if (parsedNamespace.hostname === 'www.onvif.org' && parsedNamespace.pathname) {
          const namespaceSplitted = parsedNamespace.pathname.substring(1).split('/') // remove leading Slash, then split
          if (namespaceSplitted[1] === 'media' && namespaceSplitted[0] === 'ver20') {
            // special case for Media and Media2 where cameras supporting Profile S and Profile T (2020/2021 models) have two media services
            this.media2Support = true
            namespaceSplitted[1] = 'media2'
          } else if (namespaceSplitted[1] === 'ptz') {
            // uppercase PTZ namespace to fit names convention
            namespaceSplitted[1] = 'PTZ'
          }
          this.onvif.uri[namespaceSplitted[1] as keyof OnvifServices] = this.onvif.parseUrl(service.XAddr)
        }
      }
    }
    return result
  }

  /**
   * Retrieves device capabilities.
   *
   * This method also updates the onvif.capabilities and onvif.uri properties of the instance.
   * It includes a workaround for Profile G NVRs that may not properly report recording capabilities.
   *
   * @deprecated This method has been replaced by the more generic {@link Device.getServices} method.
   *             For capabilities of individual services, refer to the GetServiceCapabilities methods.
   *
   * @param [options] - Options for the capabilities request
   * @param [options.category] - Categories of capabilities to retrieve
   * @returns Object containing device capabilities
   * @throws {Error} On request failure, invalid response structure, or other errors
   */
  async getCapabilities(options?: Partial<GetCapabilities>): Promise<GetCapabilitiesResponse> {
    const category = options?.category ?? ['All']

    const [data] = await this.onvif.request({
      body: `
    <GetCapabilities xmlns="http://www.onvif.org/ver10/device/wsdl">
      ${category.map((cat) => `<Category>${cat}</Category>`).join('')}
    </GetCapabilities>`
    })

    // @ts-expect-error TODO: this request client sucks big time...
    if (!data?.getCapabilitiesResponse?.capabilities) {
      throw new Error('Invalid response structure')
    }

    // @ts-expect-error TODO: this request client sucks big time...
    this.onvif.capabilities = linerase(data.getCapabilitiesResponse.capabilities) as Capabilities

    const serviceNames = ['PTZ', 'media', 'imaging', 'events', 'device', 'analytics'] as const
    type ServiceName = (typeof serviceNames)[number]

    for (const name of serviceNames) {
      // @ts-expect-error TODO fix later
      const capability = this.onvif.capabilities[name.toLowerCase() as Lowercase<ServiceName>]
      if (capability && 'XAddr' in capability && typeof capability.XAddr === 'string') {
        this.onvif.uri[name] = this.onvif.parseUrl(capability.XAddr)
      }
    }

    if (this.onvif.capabilities.extension) {
      for (const [ext, value] of Object.entries(this.onvif.capabilities.extension)) {
        if (value && typeof value === 'object' && 'XAddr' in value && typeof value.XAddr === 'string') {
          this.onvif.uri[ext as keyof CapabilitiesExtension] = new URL(value.XAddr)
        }
      }

      // HACK for a Profile G NVR that has 'replay' but did not have 'recording' in GetCapabilities
      if (this.onvif.uri.replay && !this.onvif.uri.recording) {
        const tempRecorderXaddr = this.onvif.uri.replay.href.replace('replay', 'recording')
        this.onvif.emit('warn', `Adding ${tempRecorderXaddr} for bad Profile G device`)
        this.onvif.uri.recording = new URL(tempRecorderXaddr)
      }
    }

    return { capabilities: this.onvif.capabilities }
  }

  /**
   * Receive device information
   */
  async getDeviceInformation(): Promise<GetDeviceInformationResponse> {
    const [data] = await this.onvif.request({
      body: '<GetDeviceInformation xmlns="http://www.onvif.org/ver10/device/wsdl"/>'
    })
    // @ts-expect-error TODO improve later
    this.onvif.deviceInformation = linerase(data).getDeviceInformationResponse
    if (!this.onvif.deviceInformation) {
      throw new Error('Invalid response structure')
    }

    return this.onvif.deviceInformation
  }

  /**
   * Receive hostname information
   */
  async getHostname(): Promise<HostnameInformation> {
    const [data] = await this.onvif.request({
      body: '<GetHostname xmlns="http://www.onvif.org/ver10/device/wsdl"/>'
    })
    // @ts-expect-error TODO improve later
    return linerase(data).getHostnameResponse.hostnameInformation
  }

  /**
   * Receive the scope parameters of a device
   */
  async getScopes(): Promise<Scope[]> {
    const [data] = await this.onvif.request({
      body: '<GetScopes xmlns="http://www.onvif.org/ver10/device/wsdl"/>'
    })
    // @ts-expect-error TODO improve later
    this.#scopes = linerase(data).getScopesResponse.scopes
    if (this.#scopes === undefined) {
      this.#scopes = []
    } else if (!Array.isArray(this.#scopes)) {
      this.#scopes = [this.#scopes]
    }
    return this.#scopes
  }

  /**
   * Set the scope parameters of a device
   *
   * @param scopes - Array of scope's uris
   */
  async setScopes(scopes: string[]): Promise<Scope[]> {
    const [data] = await this.onvif.request({
      body: `<SetScopes xmlns="http://www.onvif.org/ver10/device/wsdl">${scopes
        .map((uri) => `<Scopes>${uri}</Scopes>`)
        .join('')}</SetScopes>`
    })
    // @ts-expect-error TODO improve later
    if (linerase(data).setScopesResponse !== '') {
      throw new Error('Wrong `SetScopes` response')
    }
    // get new scopes from device
    return await this.getScopes()
  }

  /**
   * Returns the capabilities of the device service. The result is returned in a typed answer
   */
  async getServiceCapabilities(): Promise<GetServiceCapabilitiesResponse> {
    const [data] = await this.onvif.request({
      body: '<GetServiceCapabilities xmlns="http://www.onvif.org/ver10/device/wsdl" />'
    })
    // @ts-expect-error TODO improve later
    const capabilitiesResponse = linerase(data).getServiceCapabilitiesResponse
    this.#serviceCapabilities = capabilitiesResponse.capabilities
    if (this.#serviceCapabilities.misc && capabilitiesResponse.getServiceCapabilitiesResponse.capabilities.misc) {
      this.#serviceCapabilities.misc.auxiliaryCommands =
        capabilitiesResponse.getServiceCapabilitiesResponse.capabilities.misc.auxiliaryCommands.split(' ')
    }
    return capabilitiesResponse
  }

  /**
   * This operation reboots the device
   */
  async systemReboot(): Promise<string> {
    const [data] = await this.onvif.request({
      service: 'device', // or 'deviceIO' ?
      body: '<SystemReboot xmlns="http://www.onvif.org/ver10/device/wsdl"/>'
    })

    // @ts-expect-error TODO: improve later
    return data.systemRebootResponse.message
  }

  /**
   * This operation gets the NTP settings from a device. If the device supports NTP, it shall be possible to get the
   * NTP server settings through the GetNTP command.
   */
  async getNTP(): Promise<NTPInformation> {
    const [data] = await this.onvif.request({
      service: 'device',
      body: '<GetNTP xmlns="http://www.onvif.org/ver10/device/wsdl"/>'
    })
    // @ts-expect-error TODO: improve later
    this.#NTP = linerase(data.getNTPResponse.NTPInformation) as NTPInformation
    if (this.#NTP?.NTPManual && !Array.isArray(this.#NTP.NTPManual)) {
      this.#NTP.NTPManual = [this.#NTP.NTPManual]
    }
    if (this.#NTP?.NTPFromDHCP && !Array.isArray(this.#NTP.NTPFromDHCP)) {
      this.#NTP.NTPFromDHCP = [this.#NTP.NTPFromDHCP]
    }
    return this.#NTP
  }

  /**
   * Set the NTP settings on a device
   *
   * @param options - NTP settings
   */
  async setNTP(options: SetNTP): Promise<NTPInformation> {
    const ntpManualEntries =
      /* eslint-disable @stylistic/indent */
      options.NTPManual && Array.isArray(options.NTPManual)
        ? options.NTPManual.map((ntpManual) => {
            if (!ntpManual.type) {
              return ''
            }
            return `
          <NTPManual>
            <Type xmlns="http://www.onvif.org/ver10/schema">${ntpManual.type}</Type>
            ${ntpManual.IPv4Address ? `<IPv4Address xmlns="http://www.onvif.org/ver10/schema">${ntpManual.IPv4Address}</IPv4Address>` : ''}
            ${ntpManual.IPv6Address ? `<IPv6Address xmlns="http://www.onvif.org/ver10/schema">${ntpManual.IPv6Address}</IPv6Address>` : ''}
            ${ntpManual.DNSname ? `<DNSname>${ntpManual.DNSname}</DNSname>` : ''}
            ${ntpManual.extension ? `<Extension>${ntpManual.extension ? JSON.stringify(ntpManual.extension) : ''}</Extension>` : ''}
          </NTPManual>
        `
          }).join('')
        : ''
    /* eslint-enable @stylistic/indent */

    const body = `
    <SetNTP xmlns="http://www.onvif.org/ver10/device/wsdl">
      <FromDHCP>${options.fromDHCP ?? false}</FromDHCP>
      ${ntpManualEntries}
    </SetNTP>
  `

    const [data] = await this.onvif.request({
      service: 'device',
      body: body.trim().replace(/\s+/g, ' ')
    })

    // @ts-expect-error TODO: improve later
    return linerase(data.setNTPResponse)
  }

  /**
   * This operation gets the DNS settings from a device. The device shall return its DNS configurations through the
   * GetDNS command.
   */
  async getDNS(): Promise<DNSInformation> {
    const [data] = await this.onvif.request({
      service: 'device',
      body: '<GetDNS xmlns="http://www.onvif.org/ver10/device/wsdl"/>'
    })
    // @ts-expect-error TODO: improve later
    this.#DNS = linerase(data.getDNSResponse.DNSInformation) as DNSInformation
    if (this.#DNS?.DNSManual && !Array.isArray(this.#DNS.DNSManual)) {
      this.#DNS.DNSManual = [this.#DNS.DNSManual]
    }
    if (this.#DNS?.DNSFromDHCP && !Array.isArray(this.#DNS.DNSFromDHCP)) {
      this.#DNS.DNSFromDHCP = [this.#DNS.DNSFromDHCP]
    }
    return this.#DNS
  }

  /**
   * This operation gets the network interface configuration from a device. The device shall support return of network
   * interface configuration settings as defined by the NetworkInterface type through the GetNetworkInterfaces command.
   */
  async getNetworkInterfaces(): Promise<NetworkInterface[]> {
    const [data] = await this.onvif.request({
      service: 'device',
      body: '<GetNetworkInterfaces xmlns="http://www.onvif.org/ver10/device/wsdl"/>'
    })
    // @ts-expect-error TODO: improve later
    const networkInterfaces = linerase(data.getNetworkInterfacesResponse.networkInterfaces) as NetworkInterface
    // networkInterfaces is an array of network interfaces, but linerase remove the array if there is only one element inside
    // so we convert it back to an array
    if (Array.isArray(networkInterfaces)) {
      this.#networkInterfaces = networkInterfaces
    } else {
      this.#networkInterfaces = [networkInterfaces]
    }
    return this.#networkInterfaces
  }

  /**
   * Set network interfaces information
   */
  // async setNetworkInterfaces(options: SetNetworkInterfacesOptions) {
  //
  // }
}
