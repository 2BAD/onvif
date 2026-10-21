# @2bad/onvif-recording

ONVIF recording search, replay and recording control for [`@2bad/onvif`](https://www.npmjs.com/package/@2bad/onvif).

## Install

```sh
npm install @2bad/onvif @2bad/onvif-recording
```

## Quick start

```ts
import { Device } from '@2bad/onvif'
import { recording } from '@2bad/onvif-recording'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(recording)

for await (const found of camera.search.recordings()) {
  const { uri } = await camera.replay.uri(found.recordingToken)
  console.log(found.recordingToken, found.earliestRecording, uri.href) // RecordingToken_1 2026-07-09T08:00:00.000Z rtsp://192.0.2.10:554/replay
}
```

## Examples

- [Searching](examples/searching.md): recorded events and search options
- [Replay](examples/replay.md): RTSP, UDP and HTTP replay addresses
- [Recording control](examples/recording-control.md): create recordings and recording jobs
- [Errors](examples/errors.md): missing recordings and memory cards

## API

```ts
camera.search.recordings(request?, options?) // each recording found
camera.search.events(request, options?) // each recorded event found
camera.replay.uri(recordingToken, options?) // the RTSP address that replays a recording

camera.recording // a method per Recording operation, such as camera.recording.getRecordings()
camera.search // a method per Search operation, such as camera.search.getRecordingSummary()
camera.replay // a method per Replay operation, such as camera.replay.getReplayConfiguration()
```

Each method has TypeScript types for its request and response. The generated methods take call options as second argument, such as `{ timeoutMs: 2_000 }`.

`camera.recording.forRecording(recordingToken)` has the recording methods without `recordingToken` in the request.

## License

MIT
