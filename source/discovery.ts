import { createSocket, type RemoteInfo } from 'node:dgram'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import { URL } from 'node:url'
import { Onvif } from './onvif.ts'
import { guid, linerase, parseSOAPString } from './utils/xml.ts'

/**
 * Options for discovery process
 */
export type DiscoveryOptions = {
  /** Timeout in milliseconds for discovery responses. Default 5000 */
  timeout?: number
  /** Set to `false` if you want to omit creating of Cam objects. Default true */
  resolve?: boolean
  /** WS-Discovery message id */
  messageId?: string
  /** Interface to bind on for discovery ex. `eth0` */
  device?: string
  /** Client will listen to discovery data device sent */
  listeningPort?: number
  /** Socket type */
  type?: 'udp4' | 'udp6'
}

/**
 * Try to find the most suitable record
 * Now it is simple ip match
 *
 * @param xaddrs - Array of XAddr URLs
 * @param address - IP address to match
 * @returns The matched URL or the first URL if no match is found
 */
function matchXAddr(xaddrs: URL[], address: string): URL | undefined {
  return xaddrs.find((xaddr) => xaddr.hostname === address) ?? xaddrs[0]
}

/**
 * Class for `Discovery` singleton
 */
export class DiscoverySingleton extends EventEmitter {
  /**
   * Fires when device found
   *
   * @param onvif - Onvif instance {@link Onvif} or just information object about found device
   * @event device
   */
  static readonly device = 'device' as const

  /**
   * Indicates any errors
   *
   * @param error - Error instance or array of error instances from {@link Error}
   * @event error
   */
  static readonly error = 'error' as const

  private static instance?: DiscoverySingleton

  /**
   * Get the singleton instance of DiscoverySingleton
   */
  public static get getInstance(): DiscoverySingleton {
    if (!DiscoverySingleton.instance) {
      DiscoverySingleton.instance = new DiscoverySingleton()
    }
    return DiscoverySingleton.instance
  }

  private constructor() {
    super()
  }

  /**
   * Discover NVT devices in the subnet
   *
   * @param options - Options for WS-Discovery
   * @example
   * ```typescript
   * import { Discovery } from 'onvif';
   * Discovery.on('device', async (cam) => {
   *   // function would be called as soon as NVT responses
   *   cam.username = <USERNAME>;
   *   cam.password = <PASSWORD>;
   *   await cam.connect();
   * })
   * Discovery.probe();
   * ```
   * @example
   * import { Discovery } from 'onvif';
   * (async () => {
   *   const cams = Promise.all((await Discovery.probe()).map(camera => camera.connect());
   *   console.log(await cams[0]?.getSystemDateAndTime());
   * })();
   */
  async probe(options: DiscoveryOptions = {}): Promise<Array<Onvif | Record<string, unknown>>> {
    return await new Promise((resolve, reject) => {
      const cams = new Map<string, Onvif | Record<string, unknown>>()
      const errors: Error[] = []
      const messageID = `urn:uuid:${options.messageId || guid()}`
      const request = Buffer.from(`
        <Envelope xmlns="http://www.w3.org/2003/05/soap-envelope" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
          <Header>
            <wsa:MessageID xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">${messageID}</wsa:MessageID>
            <wsa:To xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To>
            <wsa:Action xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</wsa:Action>
          </Header>
          <Body>
            <Probe xmlns="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
              <Types>dn:NetworkVideoTransmitter</Types>
              <Scopes />
            </Probe>
          </Body>
        </Envelope>
        `)

      const socket = createSocket(options.type ?? 'udp4')
      socket.on('error', (err) => {
        this.emit('error', err)
      })

      /**
       * Listen for responses from devices
       *
       * @param msg - Message from device
       * @param rinfo - Remote info
       */
      const listener = async (msg: Buffer, rinfo: RemoteInfo): Promise<void> => {
        try {
          const [data, xml] = await parseSOAPString(msg.toString())
          // @ts-expect-error TODO fix later
          if (!data['probeMatches']) {
            throw new Error(`Wrong SOAP message from ${rinfo.address}:${rinfo.port}\n${xml}`)
          }

          const parsedData = linerase(data) as {
            probeMatches?: { probeMatch?: { endpointReference?: { address?: string }; XAddrs?: string } }
          }
          const camAddr = parsedData?.probeMatches?.probeMatch?.endpointReference?.address

          if (!camAddr || cams.has(camAddr)) {
            return
          }

          let cam: Onvif | Record<string, unknown>

          if (options.resolve !== false) {
            const camUris = parsedData?.probeMatches?.probeMatch?.XAddrs?.split(' ').map((uri: string) => new URL(uri))

            if (!camUris?.length) {
              throw new Error(`No XAddrs found for ${rinfo.address}`)
            }

            const camUri = matchXAddr(camUris, rinfo.address)
            if (!camUri) {
              throw new Error(`No matching XAddr found for ${rinfo.address}`)
            }

            cam = new Onvif({
              hostname: camUri.hostname,
              port: Number(camUri.port),
              path: camUri.pathname,
              urn: camAddr
            })
          } else {
            cam = parsedData
          }

          cams.set(camAddr, cam)
          this.emit('device', cam, rinfo, xml)
        } catch (error) {
          const errorObj = error instanceof Error ? error : new Error(String(error))
          errors.push(errorObj)
          this.emit('error', errorObj)
        }
      }

      if (options.device) {
        const interfaces = os.networkInterfaces()
        const deviceInterfaces = interfaces[options.device]
        if (deviceInterfaces) {
          deviceInterfaces.forEach((iface) => {
            if (iface.family === 'IPv4') {
              socket.bind(options.listeningPort, iface.address)
            }
          })
        } else {
          reject(new Error(`Device ${options.device} not found`))
          return
        }
      }

      socket.on('message', listener)
      socket.send(request, 0, request.length, 3702, '239.255.255.250')

      setTimeout(() => {
        socket.removeListener('message', listener)
        socket.close()
        if (errors.length === 0) {
          resolve(Array.from(cams.values()))
        } else {
          reject(new AggregateError(errors, 'Multiple errors occurred'))
        }
      }, options.timeout ?? 5000)
    })
  }
}

/**
 * Singleton for the discovery to provide `probe` method
 * {@link DiscoverySingleton.probe}
 *
 * @example
 * ```typescript
 * import { Discovery } from 'onvif';
 * Discovery.on('device', async (cam) => {
 *   // function would be called as soon as NVT responses
 *   cam.username = <USERNAME>;
 *   cam.password = <PASSWORD>;
 *   await cam.connect();
 * })
 * Discovery.probe();
 * ```
 * @example
 * import { Discovery } from 'onvif';
 * (async () => {
 *   const cams = Promise.all((await Discovery.probe()).map(camera => camera.connect());
 *   console.log(await cams[0]?.getSystemDateAndTime());
 * })();
 */
export const Discovery = DiscoverySingleton.getInstance
