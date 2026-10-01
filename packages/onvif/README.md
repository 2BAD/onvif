# @2bad/onvif

ONVIF client for TypeScript with no runtime dependencies.

> [!WARNING]
> 2.0 is in alpha. The API can still change.

## Install

```sh
npm install @2bad/onvif@next
```

Needs Node.js 26 or later. ESM only. Events and media are in [`@2bad/onvif-events`](https://www.npmjs.com/package/@2bad/onvif-events) and [`@2bad/onvif-media`](https://www.npmjs.com/package/@2bad/onvif-media).

## Usage

```ts
import { Device, DeviceManagement } from '@2bad/onvif'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const info = await device.call(DeviceManagement.GetDeviceInformation)
console.log(info.manufacturer, info.model, info.firmwareVersion)
device.close()
```

## Calling operations

Every operation has TypeScript types for its request and response, generated from the ONVIF schema.

```ts
const services = await device.call(DeviceManagement.GetServices, { includeCapability: false })
```

## `Device.connect()` options

```ts
const device = await Device.connect({
  hostname: '192.0.2.10', // host name, IPv4 or IPv6 address

  // optional, values are the defaults
  port: 80, // 443 when secure
  secure: false, // use HTTPS
  path: '/onvif/device_service',
  timeoutMs: 10_000, // deadline for each call, retries included
  serviceAddresses: 'rewrite', // or 'sameHost', 'reject', see Service addresses
  verifyCredentials: true, // check credentials with an extra request in connect()
  maxResponseBytes: 4 * 1024 * 1024,

  // optional, off by default
  username: 'admin',
  password: 'secret',
  retry: { attempts: 2, delayMs: 250 }, // retry Get* calls on connection errors and HTTP 502, 503, 504
  tls: { fingerprint256: 'AB:CD:...' }, // see TLS
  basicAuth: 'https', // allow HTTP Basic on HTTPS, or 'always'
  signal // aborts connect()
})
```

## `device.call()` options

The third argument takes `signal` to abort the call and `timeoutMs` to override the timeout for that call.

```ts
await device.call(DeviceManagement.GetScopes, {}, { signal: AbortSignal.timeout(2_000) })
```

## Authentication

Uses WS-Security digest and HTTP Digest. Works with cameras whose clock is wrong.

## Service addresses

Credentials are only sent to the protocol, host and port you passed to `connect()`. Cameras behind NAT or a proxy often report internal service addresses. `serviceAddresses` sets what happens to them.

- `'rewrite'` (default): use your host and port, keep the path
- `'sameHost'`: allow another port or HTTPS on your host, rewrite the rest
- `'reject'`: calls to that service fail with an `OnvifError`

`device.services` lists the address used for each service.

## TLS

```ts
const device = await Device.connect({
  hostname: 'camera.example',
  secure: true,
  username: 'admin',
  password: 'secret',
  tls: { fingerprint256: 'AB:CD:...' }
})
```

`tls` takes `ca` (private CA), `cert` and `key` (client certificate), `fingerprint256` (pin a self-signed certificate) and `rejectUnauthorized: false` (accept any certificate).

## License

MIT
