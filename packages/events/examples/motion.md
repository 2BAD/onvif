# Motion

```ts
import { Device } from '@2bad/onvif'
import { events } from '@2bad/onvif-events'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(events)

for await (const motion of camera.events.motion({ onError: (error) => logger.warn(error) })) {
  if (motion.initialized) continue
  console.log(motion.videoSource, motion.isMotion ? 'started' : 'ended') // VideoSource_1 started
}
```

`motion()` yields once per change for each video source. It reads both motion events cameras send.

Without the `initialized` check, the loop also gets the motion state at the time of subscribing.

Motion events that cannot be read go to `onError`.

`motion()` takes the same options as `subscribe()`. Each loop opens its own subscription. Breaking out of the loop unsubscribes.

## Motion and other events

To handle motion and other events in one subscription, use `motionOf()`.

```ts
import { motionOf } from '@2bad/onvif-events'

const subscription = await camera.events.subscribe({ onError: (error) => logger.warn(error) })

for await (const notification of subscription) {
  const motion = motionOf(notification)
  if (motion && !motion.initialized) console.log(motion.source['VideoSourceConfigurationToken'], motion.isMotion)
}
```

`motionOf()` reads only `RuleEngine/CellMotionDetector/Motion`. Some cameras, such as EZVIZ, send changes only as `VideoSource/MotionAlarm`.
