# Motion

```ts
import { Device } from '@2bad/onvif'
import { events, motionOf } from '@2bad/onvif-events'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(events)
const subscription = await camera.events.subscribe({ onError: (error) => logger.warn(error) })

for await (const notification of subscription) {
  const motion = motionOf(notification)
  if (!motion || motion.initialized) continue
  console.log(motion.source['VideoSourceConfigurationToken'], motion.isMotion ? 'started' : 'ended') // VideoSourceConfig_1 started
}
```

`motionOf()` reads the standard motion event `RuleEngine/CellMotionDetector/Motion`. It returns `undefined` for other events.

Without the `initialized` check, the loop also gets the motion state at the time of subscribing.

## Motion alarm

```ts
import { motionAlarmOf } from '@2bad/onvif-events'

for await (const notification of subscription) {
  const motion = motionAlarmOf(notification)
  if (!motion || motion.initialized) continue
  console.log(motion.source['Source'], motion.isMotion ? 'started' : 'ended') // VideoSource_1 started
}
```

Some cameras, such as Hikvision and EZVIZ, report motion only as `VideoSource/MotionAlarm`. Use `motionAlarmOf()` for them.

Some cameras send both events for each change. Read only one of them per camera.
