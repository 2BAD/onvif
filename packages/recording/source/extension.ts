import type { Device } from '@2bad/onvif'
import { RecordingClient } from '#generated/recording.ts'
import { ReplayClient } from '#generated/replay.ts'
import { SearchClient } from '#generated/search.ts'
import { getReplayUri } from '#replay.ts'
import { searchEvents, searchRecordings } from '#search.ts'

/**
 * Add the recording, search and replay operations to a device as `device.recording`, `device.search` and
 * `device.replay`. `device.search.recordings()`, `device.search.events()` and `device.replay.uri()` are called without
 * the device argument.
 *
 * @param device - A connected device
 * @returns The properties to add
 * @example
 * const camera = device.use(recording)
 * for await (const found of camera.search.recordings()) {
 *   const { uri } = await camera.replay.uri(found.recordingToken)
 * }
 */
export const recording = (device: Device) => ({
  recording: new RecordingClient(device),
  search: Object.assign(new SearchClient(device), {
    recordings: searchRecordings.bind(undefined, device),
    events: searchEvents.bind(undefined, device)
  }),
  replay: Object.assign(new ReplayClient(device), { uri: getReplayUri.bind(undefined, device) })
})
