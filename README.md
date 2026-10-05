# @2bad/onvif

High-performance ONVIF client for TypeScript with no runtime dependencies.

Compared with other ONVIF libraries:

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

## Migrating from `onvif`

See [Migrating](packages/onvif/examples/migrating.md) for code written for `onvif` 0.8 or 1.0.

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

Compared with [`onvif`](https://github.com/agsh/onvif) 1.0.0-rc.3 and [`onvif-zeep-async`](https://github.com/openvideolibs/python-onvif-zeep-async) 4.3.0 for Python:

|                                   | `@2bad/onvif` | `onvif`                | `onvif-zeep-async`   |
| --------------------------------- | ------------- | ---------------------- | -------------------- |
| Event responses parsed per second | 12,160        | 3,402 (3.6x slower)    | 916 (13.3x slower)   |
| Burst of 5,000 events             | 171 ms        | 1,179 ms (6.9x slower) | 796 ms (4.7x slower) |
| CPU time for 5,000 events         | 296 ms        | 804 ms (2.7x more)     | 779 ms (2.6x more)   |
| Requests per second               | 1,133         | 447 (2.5x slower)      | 216 (5.2x slower)    |
| CPU time per request              | 0.47 ms       | 1.80 ms (3.8x more)    | 3.98 ms (8.4x more)  |
| Parsing a 500 KB response         | 5.3 ms        | 30.8 ms (5.9x slower)  | 99 ms (18.9x slower) |
| Cold start                        | 78 ms         | 92 ms (1.2x slower)    | 280 ms (3.6x slower) |

Snapshots are up to 2.6x faster than plain `fetch`.

## License

MIT
