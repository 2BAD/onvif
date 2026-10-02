# @2bad/onvif-discovery

Find ONVIF cameras on the local network with WS-Discovery for [`@2bad/onvif`](https://www.npmjs.com/package/@2bad/onvif).

> [!WARNING]
> 2.0 is in alpha. The API can still change.

## Install

```sh
npm install @2bad/onvif@next @2bad/onvif-discovery@next
```

## Usage

```ts
import { Device } from '@2bad/onvif'
import { discover } from '@2bad/onvif-discovery'

for await (const found of discover()) {
  console.log(found.name, found.hardware, found.xaddrs[0]?.href) // DVC DCN-BM2220LPR http://192.0.2.10/onvif/device_service
}
```

Each camera appears once. The loop ends after `timeoutMs`.

## Connecting

```ts
const [url] = found.xaddrs
if (url) {
  const device = await Device.connect({ url, username: 'admin', password: 'secret' })
}
```

`found.endpoint` identifies the camera across reboots and address changes.

## Addresses on other hosts

Anyone on the network can answer a probe. By default `xaddrs` only has addresses on the host that answered. The others are in `droppedXAddrs`.

Pass `xaddrs: 'any'` for cameras that report an address behind NAT.

## Other subnets

```ts
discover({ hosts: ['192.0.2.10', 'camera.example:3702'] })
```

With `hosts`, the probe goes only to those hosts. No multicast probe is sent.

## Stopping

Stop with `break` or an aborted `signal`.

## Errors

`discover()` throws when an option is invalid or no probe could be sent. Replies that cannot be read go to `onError`.

## `discover()` options

```ts
discover({
  // optional, values are the defaults
  timeoutMs: 3_000, // how long to wait for replies
  xaddrs: 'sender', // keep only addresses on the host that answered

  // optional, off by default
  interfaces: ['eth0'], // probe only these interfaces, every IPv4 interface except loopback otherwise
  hosts: ['192.0.2.10'], // probe these hosts directly instead of multicast
  port: 3702, // fixed local port for replies, for firewalls
  onError: (error) => logger.warn(error), // receives each reply that cannot be read
  signal // ends the discovery
})
```

## License

MIT
