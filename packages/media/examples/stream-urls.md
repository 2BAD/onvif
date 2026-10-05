# Stream URLs

```ts
import { Device } from '@2bad/onvif'
import { media } from '@2bad/onvif-media'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(media)

for (const profile of await camera.media.getProfiles()) {
  const stream = await camera.media.getStreamUri(profile)
  console.log(profile.name, profile.videoEncoder?.encoding, stream.uri.href) // profile1 H265 rtsp://192.0.2.10:554/stream1
}
```

## Options

```ts
const stream = await camera.media.getStreamUri(profile, {
  // optional, values are the defaults
  protocol: 'RTSP', // or 'UDP', 'HTTP'
  multicast: false,

  // optional, off by default
  timeoutMs: 5_000,
  signal
})
```

Media2 has no multicast over HTTP. Asking for it throws an `OnvifError`.

## Saved profiles

A stored token works in place of a profile.

```ts
const stream = await camera.media.getStreamUri({ service: 'media2', token: 'profile1' })
```

## Cameras behind NAT

Cameras behind NAT report internal addresses. The returned `uri` uses the host you connected to. It keeps the port and scheme the camera reported. The original is in `reported`.

With `serviceAddresses: 'reject'`, an address on another host throws an `OnvifError`.
