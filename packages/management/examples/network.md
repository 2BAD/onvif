# Network

```ts
import { Device } from '@2bad/onvif'
import { management } from '@2bad/onvif-management'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(management)

const { rebootNeeded } = await camera.management.setHostnameFromDHCP({ fromDHCP: true })
if (rebootNeeded) await camera.systemReboot()
```

`setNetworkInterfaces()` and `setHostnameFromDHCP()` return `rebootNeeded`. The change applies after the reboot.

Network changes can move the camera to another address. Connect again at the new address.
