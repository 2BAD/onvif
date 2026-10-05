# @2bad/onvif-discovery

Find ONVIF cameras on the local network with WS-Discovery for [`@2bad/onvif`](https://www.npmjs.com/package/@2bad/onvif).

## Install

```sh
npm install @2bad/onvif @2bad/onvif-discovery
```

## Quick start

```ts
import { discover } from '@2bad/onvif-discovery'

for await (const found of discover()) {
  console.log(found.name, found.hardware, found.xaddrs[0]?.href) // DVC DCN-BM2220LPR http://192.0.2.10/onvif/device_service
}
```

Each camera appears once. The loop ends after 3 seconds.

## Examples

- [Connecting](examples/connecting.md): connect to every camera found
- [Other subnets](examples/other-subnets.md): probe cameras by address
- [Options](examples/options.md): timeout, interfaces, ports and stopping early

## API

```ts
function discover(options?: DiscoverOptions): AsyncGenerator<DiscoveredDevice>

type DiscoveredDevice = {
  xaddrs: URL[] // device service URLs, pass one to Device.connect()
  endpoint: string // stays the same across reboots and address changes
  address: string // IP address the reply came from
  name: string | undefined
  hardware: string | undefined
  profiles: string[] // such as [ 'Streaming', 'T' ]
  scopes: string[]
  types: QualifiedName[]
  droppedXAddrs: string[] // addresses removed by the xaddrs option
}
```

`discover()` throws when an option is invalid or no probe could be sent.

## License

MIT
