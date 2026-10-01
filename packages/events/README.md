# @2bad/onvif-events

ONVIF events and motion detection for [`@2bad/onvif`](https://www.npmjs.com/package/@2bad/onvif).

> [!WARNING]
> 2.0 is in alpha. The API can still change.

## Install

```sh
npm install @2bad/onvif@next @2bad/onvif-events@next
```

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

## Stopping

Stop with `break`, `close()` or an aborted `signal`.

## Errors

`subscribe()` throws when the camera refuses the subscription.

After that, the loop recovers from network errors, camera reboots and expired subscriptions. Each one goes to `onError`. It throws when the camera rejects the credentials or reports an event address that `serviceAddresses` refuses.

## Current state

After subscribing and after every reconnect, the camera sends the current state of every topic. To get only changes, skip events whose `propertyOperation` is `'Initialized'`.

## Topics

`motionOf()` returns the standard motion event (`RuleEngine/CellMotionDetector/Motion`) or `undefined`. Match other topics with `isTopic()`.

```ts
isTopic(notification.topic, ['VideoSource', 'MotionAlarm'])
```

Values in `notification.data` and `notification.source` are strings.

## `subscribe()` options

```ts
const events = await subscribe(device, {
  onError: (error) => logger.warn(error), // receives each problem the subscription recovers from

  // optional, values are the defaults
  pullTimeoutMs: 30_000, // how long each request waits for events
  messageLimit: 100, // most events per request
  terminationMs: 60_000, // how long the camera keeps the subscription between requests

  // optional, off by default
  signal // closes the subscription
})
```

## License

MIT
