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
- [`@2bad/onvif-management`](packages/management): manage users, NTP, network settings, IP filter and relay outputs
- [`@2bad/onvif-media`](packages/media): get RTSP stream URLs and JPEG snapshots, change resolution, frame rate and bitrate

## Example

```ts
import { Device } from '@2bad/onvif'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const info = await device.getDeviceInformation()
console.log(info.manufacturer, info.model) // DVC DCN-BM2220LPR
```

## Migrating from `onvif`

See [Migrating](packages/onvif/examples/migrating.md) for code written for `onvif` 0.8 or 1.0.

## ONVIF profiles

| Profile | Covered  | Missing                      |
| ------- | -------- | ---------------------------- |
| S       | 7 of 7   |                              |
| T       | 15 of 21 | imaging, PTZ                 |
| M       | 5 of 7   | analytics, metadata          |
| C       | 7 of 15  | access control, door control |
| D       | 10 of 19 | access, doors                |
| G       | 2 of 8   | recording search, replay     |
| A       | 9 of 17  | credentials, rules           |

## Performance

Compared with [`onvif`](https://github.com/agsh/onvif) 1.0.0-rc.3, [`onvif-zeep-async`](https://github.com/openvideolibs/python-onvif-zeep-async) 4.3.0 for Python, [`use-go/onvif`](https://github.com/use-go/onvif) 67386c9 for Go and [`onvif-rs`](https://github.com/lumeohq/onvif-rs) fc074aa for Rust:

```text
Event responses parsed per second (higher is better)
  @2bad/onvif       11,934
  use-go/onvif       6,781   1.8x slower
  onvif              3,190   3.7x slower
  onvif-zeep-async     878  13.6x slower
  onvif-rs             395    30x slower

Burst of 5,000 events (lower is better)
  @2bad/onvif         214 ms
  onvif-zeep-async    840 ms  3.9x slower
  onvif             1,377 ms  6.4x slower
  onvif-rs          1,814 ms  8.5x slower
  use-go/onvif      6,308 ms   29x slower

CPU time for 5,000 events (lower is better)
  @2bad/onvif         349 ms
  onvif-zeep-async    830 ms   2.4x more
  onvif               936 ms   2.7x more
  onvif-rs          1,675 ms   4.8x more
  use-go/onvif      3,981 ms  11.4x more

Requests per second (higher is better)
  @2bad/onvif       1,104
  use-go/onvif        836   1.3x slower
  onvif               471   2.3x slower
  onvif-zeep-async    220   5.0x slower
  onvif-rs             82  13.5x slower

CPU time per request (lower is better)
  @2bad/onvif        0.48 ms
  use-go/onvif       1.01 ms  2.1x more
  onvif              1.73 ms  3.6x more
  onvif-zeep-async   3.90 ms  8.1x more
  onvif-rs          10.91 ms   23x more

Parsing a 500 KB response (lower is better)
  @2bad/onvif         5.8 ms
  use-go/onvif       10.7 ms   1.9x slower
  onvif              33.8 ms   5.9x slower
  onvif-zeep-async   98.1 ms  17.0x slower
  onvif-rs          353.7 ms    61x slower

Cold start (lower is better)
  use-go/onvif        4 ms   20x faster
  onvif-rs           20 ms  4.1x faster
  @2bad/onvif        81 ms
  onvif              93 ms  1.1x slower
  onvif-zeep-async  280 ms  3.5x slower
```

Snapshots are up to 2.6x faster than plain `fetch`.

## License

MIT
