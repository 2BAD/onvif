# @2bad/onvif

ONVIF client for TypeScript with no runtime dependencies.

## Install

```sh
npm install @2bad/onvif
```

Needs Node.js 26 or later. ESM only.

Discovery, events, device management and media are in [`@2bad/onvif-discovery`](https://www.npmjs.com/package/@2bad/onvif-discovery), [`@2bad/onvif-events`](https://www.npmjs.com/package/@2bad/onvif-events), [`@2bad/onvif-management`](https://www.npmjs.com/package/@2bad/onvif-management) and [`@2bad/onvif-media`](https://www.npmjs.com/package/@2bad/onvif-media).

## Quick start

```ts
import { Device, DeviceManagement } from '@2bad/onvif'

using device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const info = await device.call(DeviceManagement.GetDeviceInformation)
console.log(info.manufacturer, info.model, info.firmwareVersion) // DVC DCN-BM2220LPR 2.1.0
```

`using` closes idle connections at the end of the block.

## Examples

- [Connecting](examples/connecting.md): every `Device.connect()` option
- [Calling operations](examples/calling.md): requests, timeouts and cancellation
- [Errors](examples/errors.md): error classes and what they carry
- [Security](examples/security.md): authentication, TLS and service addresses
- [Service packages](examples/service-packages.md): media and events methods on the device
- [Migrating from `onvif`](examples/migrating.md): `Cam` and `Onvif` calls and options in 2.x

## API

```ts
class Device {
  static connect(options: ConnectOptions): Promise<Device>

  call(operation: Operation, request?: Request, options?: CallOptions): Promise<Response>
  use(extension: (device: Device) => Extension): Device & Extension
  download(address: string | URL, options?: { signal; timeoutMs }): Promise<{ contentType; body: Uint8Array }>
  synchronizeClock(options?: { signal; timeoutMs }): Promise<void>
  resolveAddress(address: string): URL // the URL a reported address is sent to
  close(): void // closes idle connections, the device still works after it

  readonly address: URL // URL of the device service
  get services(): ReadonlyMap<string, URL> // service namespace to URL
  get clock(): { skewMs: number; source: 'device' | 'local' } // camera time minus local time
  get timeoutMs(): number
  get serviceAddresses(): 'rewrite' | 'sameHost' | 'reject'
}
```

`DeviceManagement` has `GetCapabilities`, `GetDeviceInformation`, `GetHostname`, `GetNetworkInterfaces`, `GetScopes`, `GetServiceCapabilities`, `GetServices`, `GetSystemDateAndTime` and `SystemReboot`.

Every error is an `OnvifError` with `host`, `service` and `action`.

## License

MIT
