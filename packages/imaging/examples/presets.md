# Presets

```ts
import { Device } from '@2bad/onvif'
import { imaging } from '@2bad/onvif-imaging'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(imaging)
const source = camera.imaging.forVideoSource('VideoSource_1')

const { preset = [] } = await source.getPresets()
console.log(preset.map(({ token, name }) => `${token} ${name}`)) // [ '1 Day', '2 Night' ]
await source.setCurrentPreset({ presetToken: '2' })
```
