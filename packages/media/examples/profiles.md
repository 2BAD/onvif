# Profiles

## Create a profile

```ts
import { Device } from '@2bad/onvif'
import { media } from '@2bad/onvif-media'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(media)

const { v1 } = camera.media
const { profile } = await v1.createProfile({ name: 'analytics' })
const profileToken = profile.token

const { configurations: [source] = [] } = await v1.getCompatibleVideoSourceConfigurations({ profileToken })
const { configurations: [encoder] = [] } = await v1.getCompatibleVideoEncoderConfigurations({ profileToken })
if (!source || !encoder) throw new Error('No compatible configurations')
await v1.addVideoSourceConfiguration({ profileToken, configurationToken: source.token })
await v1.addVideoEncoderConfiguration({ profileToken, configurationToken: encoder.token })

await v1.deleteProfile({ profileToken })
```

Audio, metadata and PTZ configurations are added the same way. Profiles with `fixed: true` can't be deleted.

## Several configurations in one call

With Media2, `addConfiguration()` adds several configurations in one call.

```ts
await camera.media.v2.addConfiguration({
  profileToken,
  configuration: [
    { type: 'Metadata', token: metadata.token },
    { type: 'Analytics', token: analytics.token }
  ]
})
```

List the types in the order of `VideoSource`, `VideoEncoder`, `AudioSource`, `AudioEncoder`, `AudioOutput`, `AudioDecoder`, `Metadata`, `Analytics`, `PTZ`.
