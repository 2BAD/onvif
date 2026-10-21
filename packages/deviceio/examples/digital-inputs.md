# Digital inputs

```ts
import { Device } from '@2bad/onvif'
import { io } from '@2bad/onvif-deviceio'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(io)

const { digitalInputs = [] } = await camera.io.getDigitalInputs()
console.log(digitalInputs) // [ { token: '1', idleState: 'open' } ]
```

Inputs that change state send `tns1:Device/Trigger/DigitalInput` events. Receive them with [`@2bad/onvif-events`](https://www.npmjs.com/package/@2bad/onvif-events).
