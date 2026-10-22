# Preset tours

```ts
import { Device } from '@2bad/onvif'
import { ptz } from '@2bad/onvif-ptz'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(ptz)
const profile = camera.ptz.forProfile('Profile_1')

const { presetTourToken } = await profile.createPresetTour()
const { presetTour } = await profile.getPresetTour({ presetTourToken })
await profile.modifyPresetTour({
  presetTour: {
    ...presetTour,
    name: 'Gates',
    tourSpot: [
      { presetDetail: { presetToken: '1' }, stayTime: 'PT10S' },
      { presetDetail: { presetToken: '2' }, stayTime: 'PT10S' }
    ]
  }
})

await profile.operatePresetTour({ presetTourToken, operation: 'Start' })
await profile.operatePresetTour({ presetTourToken, operation: 'Stop' })
await profile.removePresetTour({ presetTourToken })
```

`getPresetTourOptions()` lists the stay times and presets a tour spot accepts.

A tour spot takes exactly one of `presetToken`, `home` and `ptzPosition`. Some cameras return spots with all of them. Keep only one before you send such a tour back.
