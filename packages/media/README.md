# @2bad/onvif-media

ONVIF media profiles, snapshot and stream URIs for [`@2bad/onvif`](https://www.npmjs.com/package/@2bad/onvif), and snapshots fetched with HTTP Digest.

> [!WARNING]
> Still in development, not usable yet. Check the [repo](https://github.com/2BAD/onvif) for status.

## Usage

```ts
import { Device } from '@2bad/onvif'
import { defaultProfile, fetchSnapshot, getProfiles, getSnapshotUri, getStreamUri } from '@2bad/onvif-media'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const profile = defaultProfile(await getProfiles(device))
if (!profile) throw new Error('The camera has no media profiles')

const snapshot = await getSnapshotUri(device, profile.token)
const jpeg = await fetchSnapshot(device, snapshot.uri)

const stream = await getStreamUri(device, profile.token, { protocol: 'RTSP' })
console.log(stream.uri.href)
```

Every call takes the profile token explicitly; there is no hidden current profile. `defaultProfile()` picks the first profile with a video source and encoder, and falls back to one with a video source, then to the first.

Addresses the device reports go through the service address policy of the device (`serviceAddresses` in `Device.connect()`), because cameras behind NAT or port forwarding report their internal address. A snapshot address on another origin is rewritten to the configured one, or refused under `reject`. A stream address on another host gets the configured host but keeps its scheme and port, since RTSP does not run on the ONVIF port, or is refused under `reject`. The address as the device sent it stays in `reported`.

`fetchSnapshot()` sends the credentials only with HTTP Digest, applies the address policy again, follows no redirects and fails with a `TransportError` when the response is not a JPEG image. A camera that only offers HTTP Basic fails with an `AuthError` that says so.

Media v1 only. Profiles for H.265 streams may come without a video encoder configuration, since Media v1 cannot describe H.265; their snapshot and stream URIs still work.

## License

MIT
