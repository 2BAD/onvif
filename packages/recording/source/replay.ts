import { type CallOptions, type Device, OnvifError } from '@2bad/onvif'
import { GetReplayUri } from '#generated/replay.ts'

export type ReplayOptions = Pick<CallOptions, 'signal' | 'timeoutMs'> & {
  /** `RTSP` (RTP over RTSP over TCP) by default, `UDP` (RTP over UDP) or `HTTP` (RTSP tunnelled through HTTP). */
  protocol?: 'RTSP' | 'UDP' | 'HTTP' | undefined
}

export type ReplayAddress = {
  /** The address to use, on the configured host. */
  uri: URL
  /** The address as the device reported it. */
  reported: string
}

const replayProtocols = new Set(['rtsp:', 'rtsps:', 'http:', 'https:'])

const printable = (text: string): string => text.slice(0, 100).replaceAll(/[^\x20-\x7e]/g, '?')

/**
 * Get the RTSP address that replays a recording. The address gets the configured host, as stream addresses do.
 *
 * @param device - A connected device
 * @param recordingToken - Token of the recording, such as from `search.recordings()`
 * @param options - Transport protocol, abort signal and timeout
 * @returns The replay address
 * @throws {OnvifError} If the address is invalid, not RTSP or HTTP(S), or on another host under the `reject` policy,
 *   and the errors of `device.call()`
 * @example
 * const { uri } = await camera.replay.uri(recordingToken)
 */
export async function getReplayUri(
  device: Device,
  recordingToken: string,
  options: ReplayOptions = {}
): Promise<ReplayAddress> {
  const { protocol = 'RTSP', ...callOptions } = options
  const streamSetup = { stream: 'RTP-Unicast', transport: { protocol } }
  const { uri: reported } = await device.call(GetReplayUri, { streamSetup, recordingToken }, callOptions)
  const context = { host: device.address.host, service: 'trp', action: 'GetReplayUri' }
  const uri = URL.parse(reported)
  if (!uri) throw new OnvifError(`Invalid replay address '${printable(reported)}'`, context)
  if (!replayProtocols.has(uri.protocol)) {
    throw new OnvifError(`Unsupported replay address protocol ${printable(uri.protocol)}`, context)
  }
  const configured = device.address.hostname
  // an address without a host can only mean the device itself
  const sameHost = uri.hostname === '' || uri.hostname.toLowerCase() === configured
  if (!sameHost && device.serviceAddresses === 'reject') {
    throw new OnvifError(`Replay address host ${printable(uri.hostname)} is not the configured host`, context)
  }
  uri.hostname = configured
  return { uri, reported }
}
