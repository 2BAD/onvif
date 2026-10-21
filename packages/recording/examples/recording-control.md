# Recording control

```ts
import { Device } from '@2bad/onvif'
import { recording } from '@2bad/onvif-recording'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(recording)

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
