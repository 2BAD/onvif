# @2bad/onvif-events

ONVIF event subscriptions for [`@2bad/onvif`](https://www.npmjs.com/package/@2bad/onvif): real-time pull points and a typed motion topic.

> [!WARNING]
> Still in development, not usable yet. Check the [repo](https://github.com/2BAD/onvif) for status.

## Usage

```ts
import { Device } from '@2bad/onvif'
import { motionOf, subscribe } from '@2bad/onvif-events'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const events = await subscribe(device, { onError: (error) => logger.warn(error) })

for await (const notification of events) {
  const motion = motionOf(notification)
  if (motion) console.log(motion.source['VideoSourceConfigurationToken'], motion.isMotion)
}
```

The subscription pulls only while it is iterated. It renews the pull point when the device does not extend it on pulls, rebuilds it with exponential backoff after failures, and keeps going until `close()`, an aborted `signal`, or `break` out of the loop, each of which unsubscribes. Failures it recovers from go to `onError`; rejected credentials end the loop with an `AuthError`.

Right after subscribing, and after every rebuild, the device repeats the current state of each property with `propertyOperation: 'Initialized'` (`motion.initialized` is `true`). Treat those as state, not as transitions.

Topics are compared by namespace, not by prefix, so `isTopic(notification.topic, ['RuleEngine', 'CellMotionDetector', 'Motion'])` matches whatever prefix the device declares. Item values stay strings as the device sent them.

## License

MIT
