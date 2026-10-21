# Users

```ts
import { Device } from '@2bad/onvif'
import { management } from '@2bad/onvif-management'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(management)

await camera.management.createUsers({ user: [{ username: 'viewer', password: 'secret', userLevel: 'User' }] })
await camera.management.setUser({ user: [{ username: 'viewer', password: 'changed', userLevel: 'User' }] })
await camera.management.deleteUsers({ username: ['viewer'] })
```

After changing the password of the user you are connected as, connect again with the new password.
