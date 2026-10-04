import { type Device, OnvifError, TransportError } from '@2bad/onvif'
import { encoderOfMedia, encoderOfMedia2, type VideoEncoder } from '#encoder.ts'
import * as Media from '#generated/media.ts'
import * as Media2 from '#generated/media2.ts'
import { contextOf, fromEitherService, type MediaOptions } from '#service.ts'

export type StreamOptions = MediaOptions & {
  /**
   * `RTSP` (RTP over RTSP over TCP) by default, `UDP` (RTP over UDP) or `HTTP` (RTSP tunnelled through HTTP). A device
   * that cannot serve the combination answers with a SOAP fault.
   */
  protocol?: 'RTSP' | 'UDP' | 'HTTP' | undefined
  /** Ask for the multicast stream. The profile needs a multicast configuration. Not over `HTTP` on Media2. */
  multicast?: boolean | undefined
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

export type Profile = {
  token: string
  name: string
  /** The profile cannot be deleted. */
  fixed: boolean
  videoSource?: Media.VideoSourceConfiguration
  videoEncoder?: VideoEncoder
} & ({ service: 'media'; reported: Media.Profile } | { service: 'media2'; reported: Media2.MediaProfile })

const JPEG_START = [0xff, 0xd8, 0xff]
const streamProtocols = new Set(['rtsp:', 'rtsps:', 'http:', 'https:'])
// Media2 addresses stay valid indefinitely, even if the profile changes
const stableAddress = { invalidAfterConnect: false, invalidAfterReboot: false, timeout: 'PT0S' }

const addressOf = (mediaUri: Media.MediaUri, uri: URL): MediaAddress => ({
  uri,
  reported: mediaUri.uri,
  invalidAfterConnect: mediaUri.invalidAfterConnect,
  invalidAfterReboot: mediaUri.invalidAfterReboot,
  timeout: mediaUri.timeout
})

const printable = (text: string): string => text.slice(0, 100).replaceAll(/[^\x20-\x7e]/g, '?')

const profileOfMedia = (profile: Media.Profile): Profile => {
  const { videoSourceConfiguration, videoEncoderConfiguration } = profile
  return {
    token: profile.token,
    name: profile.name,
    fixed: profile.fixed ?? false,
    ...(videoSourceConfiguration ? { videoSource: videoSourceConfiguration } : {}),
    ...(videoEncoderConfiguration ? { videoEncoder: encoderOfMedia(videoEncoderConfiguration) } : {}),
    service: 'media',
    reported: profile
  }
}

const profileOfMedia2 = (profile: Media2.MediaProfile): Profile => {
  const { videoSource, videoEncoder } = profile.configurations ?? {}
  return {
    token: profile.token,
    name: profile.name,
    fixed: profile.fixed ?? false,
    ...(videoSource ? { videoSource } : {}),
    ...(videoEncoder ? { videoEncoder: encoderOfMedia2(videoEncoder) } : {}),
    service: 'media2',
    reported: profile
  }
}

/**
 * List the media profiles of the device, from Media2 when the device offers it and from Media v1 otherwise.
 *
 * @param device - A connected device
 * @param options - Abort signal and timeout
 * @returns Every profile, in the order the device reports them
 * @throws {OnvifError} If the device offers no usable media service, and the errors of `device.call()`
 */
export async function getProfiles(device: Device, options: MediaOptions = {}): Promise<Profile[]> {
  return await fromEitherService(
    device,
    'GetProfiles',
    options,
    async (callOptions) => {
      const { profiles = [] } = await device.call(Media2.GetProfiles, { type: ['All'] }, callOptions)
      return profiles.map(profileOfMedia2)
    },
    async (callOptions) => {
      const { profiles = [] } = await device.call(Media.GetProfiles, {}, callOptions)
      return profiles.map(profileOfMedia)
    }
  )
}

/**
 * Pick the profile to use when the caller has no preference: the first one with a video source and a video encoder,
 * then the first with a video source, then the first. Media v1 cannot describe H.265, so such a profile may come
 * without an encoder from a device without Media2; its snapshot still works.
 *
 * @param profiles - Profiles from `getProfiles()`
 * @returns The profile, or `undefined` if there is none
 */
export function defaultProfile(profiles: readonly Profile[]): Profile | undefined {
  return (
    profiles.find((profile) => profile.videoSource && profile.videoEncoder) ??
    profiles.find((profile) => profile.videoSource) ??
    profiles[0]
  )
}

/**
 * List the video source configurations of the device, from the same service as `getProfiles()`.
 *
 * @param device - A connected device
 * @param options - Abort signal and timeout
 * @returns Every configuration, in the order the device reports them
 * @throws {OnvifError} If the device offers no usable media service, and the errors of `device.call()`
 */
export async function getVideoSourceConfigurations(
  device: Device,
  options: MediaOptions = {}
): Promise<Media.VideoSourceConfiguration[]> {
  return await fromEitherService(
    device,
    'GetVideoSourceConfigurations',
    options,
    async (callOptions) => {
      const { configurations = [] } = await device.call(Media2.GetVideoSourceConfigurations, {}, callOptions)
      return configurations
    },
    async (callOptions) => {
      const { configurations = [] } = await device.call(Media.GetVideoSourceConfigurations, {}, callOptions)
      return configurations
    }
  )
}

/**
 * Ask for the address of a JPEG snapshot of a profile, on the service the profile came from. The service address
 * policy applies, since the address gets the credentials when fetched.
 *
 * @param device - A connected device
 * @param profile - A profile from `getProfiles()`, or its token and service
 * @param options - Abort signal and timeout
 * @returns The snapshot address
 * @throws {SoapFaultError} If the profile does not exist (`NoProfile`) or the device offers no snapshots
 * @throws {OnvifError} If the address is not HTTP(S) or the service address policy refuses it, and the errors of
 *   `device.call()`
 */
export async function getSnapshotUri(
  device: Device,
  profile: Pick<Profile, 'service' | 'token'>,
  options: MediaOptions = {}
): Promise<MediaAddress> {
  const { service, token: profileToken } = profile
  const mediaUri =
    service === 'media2'
      ? { ...stableAddress, uri: (await device.call(Media2.GetSnapshotUri, { profileToken }, options)).uri }
      : (await device.call(Media.GetSnapshotUri, { profileToken }, options)).mediaUri
  try {
    return addressOf(mediaUri, device.resolveAddress(mediaUri.uri))
  } catch (error) {
    if (!(error instanceof OnvifError)) throw error
    throw new OnvifError(`Snapshot address refused: ${error.message}`, contextOf(device, service, 'GetSnapshotUri'), {
      cause: error
    })
  }
}

const media2Protocol = (protocol: StreamOptions['protocol'], multicast: boolean): string | undefined => {
  if (multicast) return protocol === 'HTTP' ? undefined : 'RtspMulticast'
  return protocol === 'UDP' ? 'RtspUnicast' : protocol === 'HTTP' ? 'RtspOverHttp' : 'RTSP'
}

/**
 * Ask for the address of a stream of a profile, on the service the profile came from. A stream address on another
 * host than the configured one gets the configured host, with the scheme and port kept, or is refused under the
 * `reject` policy.
 *
 * @param device - A connected device
 * @param profile - A profile from `getProfiles()`, or its token and service
 * @param options - Transport protocol, multicast, abort signal and timeout
 * @returns The stream address
 * @throws {SoapFaultError} If the profile does not exist or the device cannot stream it this way
 * @throws {OnvifError} If Media2 is asked for multicast over HTTP, if the address is invalid, not RTSP or HTTP(S), or
 *   on another host under the `reject` policy, and the errors of `device.call()`
 */
export async function getStreamUri(
  device: Device,
  profile: Pick<Profile, 'service' | 'token'>,
  options: StreamOptions = {}
): Promise<MediaAddress> {
  const { protocol = 'RTSP', multicast = false, ...callOptions } = options
  const { service, token: profileToken } = profile
  const context = contextOf(device, service, 'GetStreamUri')
  let mediaUri: Media.MediaUri
  if (service === 'media2') {
    const transport = media2Protocol(protocol, multicast)
    if (!transport) throw new OnvifError('Media2 has no multicast stream over HTTP', context)
    const { uri } = await device.call(Media2.GetStreamUri, { protocol: transport, profileToken }, callOptions)
    mediaUri = { ...stableAddress, uri }
  } else {
    const streamSetup = { stream: multicast ? 'RTP-Multicast' : 'RTP-Unicast', transport: { protocol } }
    mediaUri = (await device.call(Media.GetStreamUri, { profileToken, streamSetup }, callOptions)).mediaUri
  }
  const uri = URL.parse(mediaUri.uri)
  if (!uri) throw new OnvifError(`Invalid stream address '${printable(mediaUri.uri)}'`, context)
  if (!streamProtocols.has(uri.protocol)) {
    throw new OnvifError(`Unsupported stream address protocol ${printable(uri.protocol)}`, context)
  }
  const configured = device.address.hostname
  // an address without a host can only mean the device itself
  const sameHost = uri.hostname === '' || uri.hostname.toLowerCase() === configured
  if (!sameHost && device.serviceAddresses === 'reject') {
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
 * @param snapshot - The address from `getSnapshotUri()`, or its `uri`
 * @param options - Abort signal and timeout
 * @returns The JPEG image
 * @throws {TransportError} If the response is not a JPEG image, and the errors of `device.download()`
 */
export async function fetchSnapshot(
  device: Device,
  snapshot: MediaAddress | URL,
  options: MediaOptions = {}
): Promise<Uint8Array> {
  const { contentType, body } = await device.download(snapshot instanceof URL ? snapshot : snapshot.uri, options)
  if (!JPEG_START.every((byte, index) => body[index] === byte)) {
    throw new TransportError(
      `Expected a JPEG snapshot, got ${body.length} bytes with Content-Type '${printable(contentType ?? '')}'`,
      { host: device.address.host, service: 'trt', action: 'GET' }
    )
  }
  return body
}
