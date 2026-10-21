# On-screen text

```ts
import { Device } from '@2bad/onvif'
import { media } from '@2bad/onvif-media'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(media)

const { v1 } = camera.media
const { configurations: [source] = [] } = await v1.getVideoSourceConfigurations()
if (!source) throw new Error('The camera has no video source')

const { osdToken } = await v1.createOSD({
  OSD: {
    token: 'new',
    videoSourceConfigurationToken: { value: source.token },
    type: 'Text',
    position: { type: 'UpperLeft' },
    textString: { type: 'Plain', plainText: 'Gate 1' }
  }
})

await v1.deleteOSD({ osdToken })
```

`getOSDOptions()` lists the positions and text types the camera accepts.
