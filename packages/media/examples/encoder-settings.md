# Encoder settings

## Lower the frame rate and bitrate

```ts
import { Device } from '@2bad/onvif'
import { defaultProfile, media } from '@2bad/onvif-media'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(media)
const encoder = defaultProfile(await camera.media.getProfiles())?.videoEncoder
if (!encoder) throw new Error('The camera has no video encoder')

await camera.media.setVideoEncoderConfiguration(encoder, { frameRateLimit: 15, bitrateLimit: 2048 })
```

`setVideoEncoderConfiguration()` changes only the fields you pass. It takes `encoding`, `resolution`, `quality`, `frameRateLimit`, `bitrateLimit`, `govLength` and `profile`.

## Switch to H.264

```ts
const codecs = await camera.media.getVideoEncoderConfigurationOptions(encoder)
const h264 = codecs.find((codec) => codec.encoding === 'H264')
if (h264) {
  await camera.media.setVideoEncoderConfiguration(encoder, {
    encoding: 'H264',
    govLength: 50,
    profile: h264.profiles?.[0] ?? 'Main'
  })
}
```

When switching to `H264` or `MPV4-ES`, pass `govLength` and `profile`. Pick values from `getVideoEncoderConfigurationOptions()`.

## Every encoder

```ts
for (const { name, encoding, resolution } of await camera.media.getVideoEncoderConfigurations()) {
  console.log(name, encoding, resolution.width) // VideoEncoder_1 H265 1920
}
```
