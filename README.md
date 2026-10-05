# @2bad/onvif

High-performance ONVIF client for TypeScript with no runtime dependencies.

New in 2.0:

- Faster and lighter
- TypeScript types generated from the ONVIF spec
- Clear errors and a timeout on every call
- Credentials are never exposed
- Handles the quirks of real cameras

## Packages

- [`@2bad/onvif`](packages/onvif): connect to a camera, read its settings and send it commands
- [`@2bad/onvif-discovery`](packages/discovery): find the ONVIF cameras on your network
- [`@2bad/onvif-events`](packages/events): receive motion and other camera events
- [`@2bad/onvif-media`](packages/media): get RTSP stream URLs and JPEG snapshots, change resolution, frame rate and bitrate

## Example

```ts
import { Device, DeviceManagement } from '@2bad/onvif'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const info = await device.call(DeviceManagement.GetDeviceInformation)
console.log(info.manufacturer, info.model) // DVC DCN-BM2220LPR
```

## ONVIF profiles

| Profile | Covered  | Missing                      |
| ------- | -------- | ---------------------------- |
| S       | 7 of 7   |                              |
| T       | 12 of 21 | network, imaging, PTZ        |
| M       | 5 of 7   | analytics, metadata          |
| C       | 7 of 15  | access control, door control |
| D       | 7 of 19  | network, access, doors       |
| G       | 2 of 8   | recording search, replay     |
| A       | 5 of 17  | users, credentials, rules    |

## Performance

Compared with [`onvif`](https://github.com/agsh/onvif) 0.8.3 and 1.0.0-rc.3:

|                                    | `@2bad/onvif` | `onvif`  |             |
| ---------------------------------- | ------------- | -------- | ----------- |
| Event responses decoded per second | 11,400        | 3,500    | 3.3x faster |
| Time for a burst of 5,000 events   | 194 ms        | 1,315 ms | 6.8x faster |
| CPU time for 5,000 events          | 281 ms        | 892 ms   | 3.2x less   |

Snapshots are up to 2.6x faster than plain `fetch`.

## License

MIT
