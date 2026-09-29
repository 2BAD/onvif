import { type CallOptions, type Device, type ErrorContext, OnvifError, TransportError } from '@2bad/onvif'
import {
  GetProfiles,
  GetSnapshotUri,
  GetStreamUri,
  type MediaUri,
  type Profile,
  type TransportProtocol
} from '#generated/media.ts'

export type MediaOptions = Pick<CallOptions, 'signal' | 'timeoutMs'>

export type StreamOptions = MediaOptions & {
  /**
   * `RTSP` (RTP over RTSP over TCP) by default, `UDP` (RTP over UDP) or `HTTP` (RTSP tunnelled through HTTP). Sent as
   * given; a device that cannot serve the combination answers with a SOAP fault.
   */
  protocol?: TransportProtocol
  /** Ask for the multicast stream. The profile needs a multicast configuration. */
  multicast?: boolean
}

export type MediaAddress = {
  /** The address to use, after the service address policy was applied. */
  uri: URL
  /** The address as the device reported it. */
  reported: string
  invalidAfterConnect: boolean
  invalidAfterReboot: boolean
  /** How long the address stays valid, as an `xs:duration`. `PT0S` means indefinitely, even if the profile changes. */
  timeout: string
}

const JPEG_START = [0xff, 0xd8, 0xff]
const streamProtocols = new Set(['rtsp:', 'rtsps:', 'http:', 'https:'])

const contextOf = (device: Device, action: string): ErrorContext => ({
  host: device.address.host,
  service: 'trt',
  action
})

const addressOf = (mediaUri: MediaUri, uri: URL): MediaAddress => ({
  uri,
  reported: mediaUri.uri,
  invalidAfterConnect: mediaUri.invalidAfterConnect,
  invalidAfterReboot: mediaUri.invalidAfterReboot,
  timeout: mediaUri.timeout
})

const printable = (text: string): string => text.slice(0, 100).replaceAll(/[^\x20-\x7e]/g, '?')

/**
 * List the media profiles of the device.
 *
 * @param device - A connected device
 * @param options - Abort signal and timeout
 * @returns Every profile, in the order the device reports them
 * @throws {OnvifError} If the device does not offer a media service, and the errors of `device.call()`
 */
export async function getProfiles(device: Device, options: MediaOptions = {}): Promise<Profile[]> {
  const { profiles } = await device.call(GetProfiles, {}, options)
  return profiles ?? []
}

/**
 * Pick the profile to use when the caller has no preference: the first one with a video source and a video encoder,
 * then the first with a video source, then the first. A device that encodes H.265 may report a profile without an
 * encoder, since Media v1 cannot describe H.265; its snapshot still works.
 *
 * @param profiles - Profiles from `getProfiles()`
 * @returns The profile, or `undefined` if there is none
 */
export function defaultProfile(profiles: readonly Profile[]): Profile | undefined {
  return (
    profiles.find((profile) => profile.videoSourceConfiguration && profile.videoEncoderConfiguration) ??
    profiles.find((profile) => profile.videoSourceConfiguration) ??
    profiles[0]
  )
}

/**
 * Ask for the address of a JPEG snapshot of a profile. The service address policy applies, since the address gets the
 * credentials when fetched.
 *
 * @param device - A connected device
 * @param profileToken - Token of the profile
 * @param options - Abort signal and timeout
 * @returns The snapshot address
 * @throws {SoapFaultError} If the profile does not exist (`NoProfile`) or the device offers no snapshots
 * @throws {OnvifError} If the address is not HTTP(S) or the service address policy refuses it, and the errors of
 *   `device.call()`
 */
export async function getSnapshotUri(
  device: Device,
  profileToken: string,
  options: MediaOptions = {}
): Promise<MediaAddress> {
  const { mediaUri } = await device.call(GetSnapshotUri, { profileToken }, options)
  try {
    return addressOf(mediaUri, device.resolveAddress(mediaUri.uri))
  } catch (error) {
    if (!(error instanceof OnvifError)) throw error
    throw new OnvifError(`Snapshot address refused: ${error.message}`, contextOf(device, 'GetSnapshotUri'), {
      cause: error
    })
  }
}

/**
 * Ask for the address of a stream of a profile. A stream address on another host than the configured one gets the
 * configured host, with the scheme and port kept, or is refused under the `reject` policy.
 *
 * @param device - A connected device
 * @param profileToken - Token of the profile
 * @param options - Transport protocol, multicast, abort signal and timeout
 * @returns The stream address
 * @throws {SoapFaultError} If the profile does not exist or the device cannot stream it this way
 * @throws {OnvifError} If the address is invalid, not RTSP or HTTP(S), or on another host under the `reject` policy,
 *   and the errors of `device.call()`
 */
export async function getStreamUri(
  device: Device,
  profileToken: string,
  options: StreamOptions = {}
): Promise<MediaAddress> {
  const { protocol = 'RTSP', multicast = false, ...callOptions } = options
  const streamSetup = { stream: multicast ? 'RTP-Multicast' : 'RTP-Unicast', transport: { protocol } }
  const { mediaUri } = await device.call(GetStreamUri, { profileToken, streamSetup }, callOptions)
  const context = contextOf(device, 'GetStreamUri')
  const uri = URL.parse(mediaUri.uri)
  if (!uri) throw new OnvifError(`Invalid stream address '${printable(mediaUri.uri)}'`, context)
  if (!streamProtocols.has(uri.protocol)) {
    throw new OnvifError(`Unsupported stream address protocol ${printable(uri.protocol)}`, context)
  }
  const configured = device.address.hostname
  // an address without a host can only mean the device itself
  const sameHost = uri.hostname === '' || uri.hostname.toLowerCase() === configured
  if (!sameHost && device.addressPolicy === 'reject') {
    throw new OnvifError(`Stream address host ${printable(uri.hostname)} is not the configured host`, context)
  }
  uri.hostname = configured
  return addressOf(mediaUri, uri)
}

/**
 * Fetch a JPEG snapshot with HTTP Digest authentication. The service address policy applies again, so an address
 * that did not come from `getSnapshotUri()` gets no credentials it should not.
 *
 * @param device - A connected device
 * @param snapshot - The address from `getSnapshotUri()`
 * @param options - Abort signal and timeout
 * @returns The JPEG image
 * @throws {TransportError} If the response is not a JPEG image, and the errors of `device.download()`
 */
export async function fetchSnapshot(device: Device, snapshot: URL, options: MediaOptions = {}): Promise<Uint8Array> {
  const { contentType, body } = await device.download(snapshot, options)
  if (!JPEG_START.every((byte, index) => body[index] === byte)) {
    throw new TransportError(
      `Expected a JPEG snapshot, got ${body.length} bytes with Content-Type '${printable(contentType ?? '')}'`,
      contextOf(device, 'GET')
    )
  }
  return body
}
