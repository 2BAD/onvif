# Snapshots

```ts
import { writeFile } from 'node:fs/promises'
import { Device } from '@2bad/onvif'
import { defaultProfile, media } from '@2bad/onvif-media'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(media)
const profile = defaultProfile(await camera.media.getProfiles())
if (!profile) throw new Error('The camera has no media profiles')

const snapshot = await camera.media.getSnapshotUri(profile)
await writeFile('snapshot.jpg', await camera.media.fetchSnapshot(snapshot))
```

The snapshot address can be reused for later snapshots.

A response that isn't a JPEG image is a `TransportError`.

Cameras that only offer HTTP Basic for snapshots need `basicAuth` on `Device.connect()`.
