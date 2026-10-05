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

Compared with [`onvif`](https://github.com/agsh/onvif) 1.0.0-rc.3, [`onvif-zeep-async`](https://github.com/openvideolibs/python-onvif-zeep-async) 4.3.0 for Python, [`use-go/onvif`](https://github.com/use-go/onvif) 67386c9 for Go and [`onvif-rs`](https://github.com/lumeohq/onvif-rs) fc074aa for Rust:

|                                   | `@2bad/onvif` | `onvif`                | `onvif-zeep-async`   | `use-go/onvif`          | `onvif-rs`             |
| --------------------------------- | ------------- | ---------------------- | -------------------- | ----------------------- | ---------------------- |
| Event responses parsed per second | 11,934        | 3,190 (3.7x slower)    | 878 (13.6x slower)   | 6,781 (1.8x slower)     | 395 (30.2x slower)     |
| Burst of 5,000 events             | 214 ms        | 1,377 ms (6.4x slower) | 840 ms (3.9x slower) | 6,308 ms (29.5x slower) | 1,814 ms (8.5x slower) |
| CPU time for 5,000 events         | 349 ms        | 936 ms (2.7x more)     | 830 ms (2.4x more)   | 3,981 ms (11.4x more)   | 1,675 ms (4.8x more)   |
| Requests per second               | 1,104         | 471 (2.3x slower)      | 220 (5.0x slower)    | 836 (1.3x slower)       | 82 (13.5x slower)      |
| CPU time per request              | 0.48 ms       | 1.73 ms (3.6x more)    | 3.90 ms (8.1x more)  | 1.01 ms (2.1x more)     | 10.9 ms (22.7x more)   |
| Parsing a 500 KB response         | 5.8 ms        | 33.8 ms (5.9x slower)  | 98 ms (17.0x slower) | 10.7 ms (1.9x slower)   | 354 ms (61.4x slower)  |
| Cold start                        | 81 ms         | 93 ms (1.1x slower)    | 280 ms (3.5x slower) | 4 ms (20x faster)       | 20 ms (4.1x faster)    |

Snapshots are up to 2.6x faster than plain `fetch`.

## License

MIT
