# Presets

```ts
import { Device } from '@2bad/onvif'
import { ptz } from '@2bad/onvif-ptz'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(ptz)
const profile = camera.ptz.forProfile('Profile_1')

const { presetToken } = await profile.setPreset({ presetName: 'Gate' })
await profile.gotoPreset({ presetToken })

const { preset = [] } = await profile.getPresets()
console.log(preset.map(({ token, name }) => `${token} ${name}`)) // [ '1 Gate' ]
```
