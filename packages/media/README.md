# @2bad/onvif-media

ONVIF media profiles, snapshots and stream URLs for [`@2bad/onvif`](https://www.npmjs.com/package/@2bad/onvif).

> [!WARNING]
> 2.0 is in alpha. The API can still change.

## Install

```sh
npm install @2bad/onvif@next @2bad/onvif-media@next
```

## Usage

```ts
import { Device } from '@2bad/onvif'
import { defaultProfile, fetchSnapshot, getProfiles, getSnapshotUri, getStreamUri } from '@2bad/onvif-media'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const profile = defaultProfile(await getProfiles(device))
if (!profile) throw new Error('The camera has no media profiles')

const snapshot = await getSnapshotUri(device, profile)
const jpeg = await fetchSnapshot(device, snapshot)

const stream = await getStreamUri(device, profile)
console.log(stream.uri.href)
```

## Methods on the device

```ts
import { media } from '@2bad/onvif-media'

const camera = device.use(media)
const profiles = await camera.media.getProfiles()
```

Every function that takes a device is on `camera.media` without the device argument.

## Media2 and Media v1

Media2 is used when the camera supports it, Media v1 otherwise. If Media2 answers with an error, Media v1 is tried within the same timeout.

Each profile has `service` set to `'media2'` or `'media'`. Pass the profile to `getSnapshotUri()` and `getStreamUri()`. A saved profile works as `{ service, token }`.

## Profiles

```ts
for (const { name, service, videoEncoder } of await getProfiles(device)) {
  console.log(name, service, videoEncoder?.encoding) // profile1 media2 H265
}
```

`videoEncoder` has the codec, resolution, quality, frame rate limit, bitrate limit and GOP length. Codecs use the Media2 names: `JPEG`, `MPV4-ES`, `H264`, `H265`. `reported` has the profile as the camera sent it, typed by `service`.

`defaultProfile()` picks the first profile with a video source and an encoder.

## Configurations

```ts
const sources = await getVideoSourceConfigurations(device)
const encoders = await getVideoEncoderConfigurations(device)
```

Encoders come in the same shape as `profile.videoEncoder`.

## Encoder settings

```ts
const encoder = profile.videoEncoder
if (!encoder) throw new Error('The profile has no encoder')

const options = await getVideoEncoderConfigurationOptions(device, encoder) // one entry per codec

await setVideoEncoderConfiguration(device, encoder, { frameRateLimit: 15, bitrateLimit: 2048 })
```

`setVideoEncoderConfiguration()` changes only the fields you pass. When switching to `H264` or `MPV4-ES`, pass `govLength` and `profile`.

## Stream URLs

```ts
const stream = await getStreamUri(device, profile, {
  // optional, values are the defaults
  protocol: 'RTSP', // or 'UDP', 'HTTP'
  multicast: false
})
```

## Snapshots

`fetchSnapshot()` returns the JPEG bytes. A response that is not a JPEG image is a `TransportError`.

Cameras that only offer HTTP Basic for snapshots need `basicAuth` on `Device.connect()`.

Media2 has no multicast over HTTP. Asking for it throws an `OnvifError`.

## Addresses

Cameras behind NAT report internal addresses. The returned `uri` uses the host you connected to. Stream URLs keep the port and scheme the camera reported. `reported` has the address as the camera sent it.

With `serviceAddresses: 'reject'`, an address on another host throws an `OnvifError`.

## Timeouts and cancellation

Functions that call the camera take `signal` and `timeoutMs` in their last argument, like `device.call()`.

## Limits

Cameras without Media2 cannot report H.265. Their H.265 profiles may have no `videoEncoder`. Their snapshot and stream addresses still work.

## License

MIT
