# Searching

## Events

```ts
import { Device } from '@2bad/onvif'
import { recording } from '@2bad/onvif-recording'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(recording)

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

## Options

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
