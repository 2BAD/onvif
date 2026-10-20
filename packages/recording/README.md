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

## Operations

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

## Searching

```ts
const startPoint = new Date(Date.now() - 86_400_000)
const searchFilter = {
  topicExpression: [
    { dialect: 'http://www.onvif.org/ver10/tev/topicExpression/ConcreteSet', value: 'tns1:RecordingHistory//.' }
  ]
}
for await (const found of camera.search.events({ startPoint, searchFilter })) {
  console.log(found.time, found.recordingToken, found.event.topic?.value) // 2026-10-19T13:15:34.000Z RecordingToken_1 tns1:RecordingHistory/Recording/State
}
```

The search ends on the camera after the last result, on an error and when the loop stops early.

```ts
camera.search.recordings(
  { scope: { includedRecordings: [recordingToken] }, maxMatches: 100 },
  {
    // optional, values are the defaults
    timeoutMs: 60_000, // time for the whole search
    pageSize: 100, // results asked for per request
    keepAliveTime: 'PT60S', // how long the camera keeps the search open, the time of the whole search

    // optional, off by default
    signal // stops the search
  }
)
```

A search that does not complete within `timeoutMs` throws a `TimeoutError`.

## Replay

```ts
const { uri, reported } = await camera.replay.uri(recordingToken, { protocol: 'HTTP' })
```

The address gets the host you connected to. `reported` is the address as the camera sent it. Under `serviceAddresses: 'reject'`, an address on another host throws an `OnvifError`.

`protocol` is `RTSP` by default, or `UDP` or `HTTP`.

## Recording control

```ts
const { recordingToken } = await camera.recording.createRecording({
  recordingConfiguration: {
    source: { sourceId: 'cam1', name: 'Gate', location: '', description: '', address: '' },
    content: 'Gate camera',
    maximumRetentionTime: 'PT0S'
  }
})
const { jobToken } = await camera.recording.createRecordingJob({
  jobConfiguration: { recordingToken, mode: 'Active', priority: 1 }
})
```

`getServiceCapabilities()` reports whether a camera creates recordings and tracks, as `dynamicRecordings` and `dynamicTracks`.

## Errors

A recording that does not exist throws a `SoapFaultError` with the subcodes `['InvalidArgVal', 'NoRecording']`.

A camera without a memory card can throw a `SoapFaultError` from `getRecordingInformation()` and `getMediaAttributes()`.

## License

MIT
