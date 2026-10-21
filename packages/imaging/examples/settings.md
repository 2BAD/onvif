# Settings

```ts
import { Device } from '@2bad/onvif'
import { imaging } from '@2bad/onvif-imaging'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(imaging)
const source = camera.imaging.forVideoSource('VideoSource_1')

await source.setImagingSettings({
  imagingSettings: { exposure: { mode: 'MANUAL', exposureTime: 2_000, gain: 0 }, irCutFilter: 'OFF' },
  forcePersistence: false // keep the change until the camera restarts
})
```

Only the settings you pass are sent. `getOptions()` lists the modes and ranges a camera accepts.

Settings read with `getImagingSettings()` can be sent back unchanged. Vendor extensions are not sent back.
