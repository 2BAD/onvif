# Relays

```ts
import { Device } from '@2bad/onvif'
import { io } from '@2bad/onvif-deviceio'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(io)

await camera.io.setRelayOutputSettings({
  relayOutput: { token: '0', properties: { mode: 'Monostable', delayTime: 'PT5S', idleState: 'closed' } }
})
await camera.io.setRelayOutputState({ relayOutputToken: '0', logicalState: 'active' })
```

A `Monostable` relay returns to its idle state after `delayTime`. A `Bistable` relay stays in the state you set.

`getRelayOutputOptions()` lists the modes and delay times a camera accepts. Delay times are seconds.
