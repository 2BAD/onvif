# Replay

```ts
import { Device } from '@2bad/onvif'
import { recording } from '@2bad/onvif-recording'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(recording)

const { uri, reported } = await camera.replay.uri('RecordingToken_1', { protocol: 'HTTP' })
```

The address gets the host you connected to. `reported` is the address as the camera sent it. Under `serviceAddresses: 'reject'`, an address on another host throws an `OnvifError`.

`protocol` is `RTSP` by default, or `UDP` or `HTTP`.
