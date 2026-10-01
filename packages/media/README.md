# @2bad/onvif-media

ONVIF profiles, snapshots and stream URLs for [`@2bad/onvif`](https://www.npmjs.com/package/@2bad/onvif).

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

const snapshot = await getSnapshotUri(device, profile.token)
const jpeg = await fetchSnapshot(device, snapshot.uri)

const stream = await getStreamUri(device, profile.token)
console.log(stream.uri.href)
```

## Profiles

`defaultProfile()` picks the first profile with a video source and an encoder.

## Stream URLs

```ts
const stream = await getStreamUri(device, profile.token, {
  // optional, values are the defaults
  protocol: 'RTSP', // or 'UDP', 'HTTP'
  multicast: false
})
```

## Snapshots

`fetchSnapshot()` returns the JPEG bytes. A response that is not a JPEG image is a `TransportError`.

Cameras that only offer HTTP Basic for snapshots need `basicAuth` on `Device.connect()`.

## Addresses

Cameras behind NAT report internal addresses. The returned `uri` uses the host you connected to. Stream URLs keep the port and scheme the camera reported. `reported` has the address as the camera sent it.

With `serviceAddresses: 'reject'`, an address on another host throws an `OnvifError`.

## Timeouts and cancellation

Functions that call the camera take `signal` and `timeoutMs` in their last argument, like `device.call()`.

## Limits

Only Media v1 is supported. H.265 profiles may have no video encoder configuration. Their snapshot and stream addresses still work.

## License

MIT
