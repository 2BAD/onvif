# Focus

```ts
import { Device } from '@2bad/onvif'
import { imaging } from '@2bad/onvif-imaging'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(imaging)
const source = camera.imaging.forVideoSource('VideoSource_1')

await source.move({ focus: { continuous: { speed: 0.5 } } })
await source.stop()

await source.move({ focus: { absolute: { position: 0.3 } } })
```

`getMoveOptions()` lists the moves a camera supports. Many cameras support only `continuous`.
