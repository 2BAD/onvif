# @2bad/onvif

High-performance ONVIF client for TypeScript with no runtime dependencies.

> [!WARNING]
> 2.0 is in alpha. The API can still change. The `1.0.0-beta` releases on npm are the old implementation and are no longer maintained.

## Packages

- [`@2bad/onvif`](packages/onvif): connect to a camera and call device operations
- [`@2bad/onvif-events`](packages/events): event subscriptions and motion detection
- [`@2bad/onvif-media`](packages/media): profiles, snapshots and stream URLs

## Example

```ts
import { Device, DeviceManagement } from '@2bad/onvif'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const info = await device.call(DeviceManagement.GetDeviceInformation)
console.log(info.manufacturer, info.model)
```

## Performance

Compared with [`onvif`](https://github.com/agsh/onvif) 0.8.3 and 1.0.0-rc.3 on the same machine:

|                                    | `@2bad/onvif` | `onvif`  |
| ---------------------------------- | ------------- | -------- |
| Event responses decoded per second | 11,400        | 3,500    |
| Time for a burst of 5,000 events   | 194 ms        | 1,315 ms |
| CPU time for 5,000 events          | 281 ms        | 892 ms   |

Snapshots are up to 2.6x faster than plain `fetch`.

## Security

- Credentials are never exposed
- TLS certificate pinning
- No runtime dependencies

## License

MIT
