# Connecting

```ts
import { Device } from '@2bad/onvif'

const device = await Device.connect({
  hostname: '192.0.2.10', // host name, IPv4 or IPv6 address

  // optional, values are the defaults
  port: 80, // 443 when secure
  secure: false, // use HTTPS
  path: '/onvif/device_service',
  timeoutMs: 10_000, // deadline for each call, retries included
  serviceAddresses: 'rewrite', // or 'sameHost', 'reject', see Security
  verifyCredentials: true, // check credentials with an extra request in connect()
  maxResponseBytes: 4 * 1024 * 1024,

  // optional, off by default
  username: 'admin',
  password: 'secret',
  retry: { attempts: 2, delayMs: 250 }, // retry Get* calls on connection errors and HTTP 502, 503, 504
  tls: { fingerprint256: 'AB:CD:...' }, // see Security
  basicAuth: 'https', // allow HTTP Basic on HTTPS, or 'always'
  signal // aborts connect()
})
```

## Device service URL

A URL works in place of `hostname`, `port`, `secure` and `path`.

```ts
const device = await Device.connect({
  url: 'http://192.0.2.10/onvif/device_service',
  username: 'admin',
  password: 'secret'
})
```

## Closing

```ts
using device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
```

`using` calls `device.close()` at the end of the block. `close()` only closes idle connections. The device still works after it.
