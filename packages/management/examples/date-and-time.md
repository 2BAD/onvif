# Date and time

```ts
import { Device } from '@2bad/onvif'
import { management } from '@2bad/onvif-management'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(management)

await camera.management.setSystemDateAndTime({ dateTimeType: 'NTP', daylightSavings: false, timeZone: { TZ: 'UTC0' } })
```

Calls after `setSystemDateAndTime()` are signed with the new device time.
