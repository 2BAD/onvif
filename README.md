# @2bad/onvif

ONVIF client for TypeScript with no runtime dependencies.

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

## License

MIT
