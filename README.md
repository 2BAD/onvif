# @2bad/onvif

High-performance ONVIF client for TypeScript with no runtime dependencies.

> [!NOTE]
> The `1.0.0-beta` releases on npm are the old implementation and are no longer maintained.

## Packages

- [`@2bad/onvif`](packages/onvif): connect to a camera and call device operations
- [`@2bad/onvif-discovery`](packages/discovery): find cameras on the local network
- [`@2bad/onvif-events`](packages/events): event subscriptions and motion detection
- [`@2bad/onvif-media`](packages/media): profiles, snapshots and stream URLs

## Example

```ts
import { Device, DeviceManagement } from '@2bad/onvif'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const info = await device.call(DeviceManagement.GetDeviceInformation)
console.log(info.manufacturer, info.model)
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

Compared with [`onvif`](https://github.com/agsh/onvif) 0.8.3 and 1.0.0-rc.3 on the same machine:

|                                    | `@2bad/onvif` | `onvif`  |             |
| ---------------------------------- | ------------- | -------- | ----------- |
| Event responses decoded per second | 11,400        | 3,500    | 3.3x faster |
| Time for a burst of 5,000 events   | 194 ms        | 1,315 ms | 6.8x faster |
| CPU time for 5,000 events          | 281 ms        | 892 ms   | 3.2x less   |

Snapshots are up to 2.6x faster than plain `fetch`.

## Security

- Credentials are never exposed
- TLS certificate pinning
- No runtime dependencies

## License

MIT
