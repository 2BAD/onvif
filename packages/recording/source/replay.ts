import type { CallOptions, Device } from '@2bad/onvif'
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
  return { uri: device.resolveStreamAddress(reported, { service: 'trp', action: 'GetReplayUri' }), reported }
}
