# @2bad/onvif-media

ONVIF media profiles, snapshots and stream URLs for [`@2bad/onvif`](https://www.npmjs.com/package/@2bad/onvif).

## Install

```sh
npm install @2bad/onvif @2bad/onvif-media
```

## Quick start

```ts
import { Device } from '@2bad/onvif'
import { defaultProfile, media } from '@2bad/onvif-media'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(media)
const profile = defaultProfile(await camera.media.getProfiles())
if (!profile) throw new Error('The camera has no media profiles')

const stream = await camera.media.getStreamUri(profile)
console.log(stream.uri.href) // rtsp://192.0.2.10:554/stream1

const jpeg = await camera.media.fetchSnapshot(await camera.media.getSnapshotUri(profile))
```

Media2 is used when the camera supports it, Media v1 otherwise.

## Examples

- [Stream URLs](examples/stream-urls.md): RTSP, UDP and HTTP addresses for each profile
- [Snapshots](examples/snapshots.md): save a JPEG from the camera
- [Encoder settings](examples/encoder-settings.md): change codec, resolution, frame rate and bitrate

## API

```ts
camera.media.getProfiles(options?: MediaOptions): Promise<Profile[]>
camera.media.getStreamUri(profile: Profile, options?: StreamOptions): Promise<MediaAddress>
camera.media.getSnapshotUri(profile: Profile, options?: MediaOptions): Promise<MediaAddress>
camera.media.fetchSnapshot(snapshot: MediaAddress | URL, options?: MediaOptions): Promise<Uint8Array>
camera.media.getVideoSourceConfigurations(options?: MediaOptions): Promise<VideoSourceConfiguration[]>
camera.media.getVideoEncoderConfigurations(options?: MediaOptions): Promise<VideoEncoder[]>
camera.media.getVideoEncoderConfigurationOptions(
  encoder: VideoEncoder,
  options?: MediaOptions
): Promise<VideoEncoderOptions[]> // one per codec
camera.media.setVideoEncoderConfiguration(
  encoder: VideoEncoder,
  changes: VideoEncoderChanges,
  options?: MediaOptions
): Promise<VideoEncoder>

camera.media.v1 // a method per Media operation, including profile, audio, metadata and multicast configuration
camera.media.v2 // a method per Media2 operation, including metadata and analytics configuration

function defaultProfile(profiles: Profile[]): Profile | undefined // first profile with a video source and an encoder

type MediaOptions = { signal?: AbortSignal; timeoutMs?: number }

type Profile = {
  token: string
  name: string
  fixed: boolean // the profile cannot be deleted
  service: 'media2' | 'media'
  videoSource?: VideoSourceConfiguration
  videoEncoder?: VideoEncoder
  reported: Media2.MediaProfile | Media.Profile // the profile as the camera sent it
}

type VideoEncoder = {
  token: string
  name: string
  encoding: string // 'JPEG', 'MPV4-ES', 'H264' or 'H265'
  resolution: { width: number; height: number }
  quality: number
  frameRateLimit?: number
  bitrateLimit?: number // kbit/s
  govLength?: number
  profile?: string // codec profile, such as 'Main' or 'High'
  service: 'media2' | 'media'
  reported: Media2.VideoEncoder2Configuration | Media.VideoEncoderConfiguration
}

type MediaAddress = {
  uri: URL // URL to use
  reported: string // the address as the camera sent it
  invalidAfterConnect: boolean
  invalidAfterReboot: boolean
  timeout: string // 'PT0S' means no limit
}
```

Each method is also exported as a function that takes the device first, such as `getProfiles(device)`.

`camera.media.v1` and `camera.media.v2` return the responses as the camera sent them.

## Profiles

```ts
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

## Metadata

```ts
const { configurations: [metadata] = [] } = await camera.media.v2.getMetadataConfigurations()
console.log(metadata?.events?.filter?.topicExpression?.[0]?.value) // tns1:RuleEngine/CellMotionDetector/Motion

if (metadata) await camera.media.v2.setMetadataConfiguration({ configuration: { ...metadata, analytics: true } })
```

`getMetadataConfigurations()` returns topics with the prefix `tns1`, whatever prefix the camera sent. A topic in another namespace reads as `{namespace}Name`. Both forms can be sent back.

## Limits

Cameras without Media2 can't report H.265. Their H.265 profiles may have no `videoEncoder`. Their snapshot and stream addresses still work.

## License

MIT
