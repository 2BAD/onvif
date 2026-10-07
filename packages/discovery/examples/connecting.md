# Connecting

```ts
import { Device } from '@2bad/onvif'
import { discover } from '@2bad/onvif-discovery'

for await (const found of discover()) {
  const [url] = found.xaddrs
  if (!url) continue
  using device = await Device.connect({ url, username: 'admin', password: 'secret' })
  const info = await device.getDeviceInformation()
  console.log(url.host, info.model) // 192.0.2.10 DCN-BM2220LPR
}
```

To collect every camera first:

```ts
const cameras = await Array.fromAsync(discover({ timeoutMs: 5_000 }))
```

Some cameras share `endpoint` with other units of the same model.
