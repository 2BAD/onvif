# Relays

```ts
import { Device } from '@2bad/onvif'
import { management } from '@2bad/onvif-management'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(management)

const { relayOutputs: [relay] = [] } = await camera.management.getRelayOutputs()
if (relay) await camera.management.setRelayOutputState({ relayOutputToken: relay.token, logicalState: 'active' })
```

A relay in `Monostable` mode returns to idle after its `delayTime`.
