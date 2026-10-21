# Moving

```ts
import { Device } from '@2bad/onvif'
import { ptz } from '@2bad/onvif-ptz'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(ptz)
const profile = camera.ptz.forProfile('Profile_1')

await profile.continuousMove({ velocity: { zoom: { x: -1 } } })
await profile.relativeMove({ translation: { panTilt: { x: 0.1, y: 0 } } })
await profile.stop({ panTilt: true, zoom: false })
```

Only the axes you pass are sent. Pan and tilt only cameras accept a move without `zoom`.

Values are in the camera's generic spaces, -1 to 1, unless a vector names another `space`. `getNodes()` lists the spaces a camera supports.
