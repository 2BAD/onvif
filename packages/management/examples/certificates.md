# Certificates

```ts
import { Device } from '@2bad/onvif'
import { management } from '@2bad/onvif-management'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(management)

const { nvtCertificate = [] } = await camera.management.getCertificates()
const der = nvtCertificate[0]?.certificate.data // Uint8Array
```

Certificate, key and policy data is a `Uint8Array` in both directions.
