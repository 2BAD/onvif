# Other subnets

Multicast probes stay on the local network. Probe cameras elsewhere by address.

```ts
import { discover } from '@2bad/onvif-discovery'

for await (const found of discover({ hosts: ['192.0.2.10', 'camera.example:3702'] })) {
  console.log(found.address, found.name) // 192.0.2.10 DCN-BM2220LPR
}
```

With `hosts`, no multicast probe is sent.
