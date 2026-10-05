# @2bad/onvif-events

ONVIF events and motion detection for [`@2bad/onvif`](https://www.npmjs.com/package/@2bad/onvif).

## Install

```sh
npm install @2bad/onvif @2bad/onvif-events
```

## Quick start

```ts
import { Device } from '@2bad/onvif'
import { events, motionOf } from '@2bad/onvif-events'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(events)
const subscription = await camera.events.subscribe({ onError: (error) => logger.warn(error) })

for await (const notification of subscription) {
  const motion = motionOf(notification)
  if (motion && !motion.initialized) console.log(motion.utcTime, motion.isMotion) // 2026-10-05T09:12:44.000Z true
}
```

The loop recovers from network errors, camera reboots and expired subscriptions. Each one goes to `onError`.

## Examples

- [Motion](examples/motion.md): motion start and end
- [Other events](examples/other-events.md): every event, filtering by topic, current state
- [Subscription](examples/subscription.md): options, stopping and errors

## API

```ts
camera.events.subscribe(options: SubscribeOptions): Promise<Subscription>

function motionOf(notification: Notification): Motion | undefined
function isTopic(topic: Topic | undefined, path: string[], namespace?: string): boolean

class Subscription implements AsyncIterableIterator<Notification> {
  get address(): string | undefined
  close(): Promise<void>
}

type Notification = {
  topic: Topic | undefined // { expression, path, namespace, dialect }
  utcTime: Date
  propertyOperation: 'Initialized' | 'Changed' | 'Deleted' | undefined
  source: Record<string, string> // { VideoSourceConfigurationToken: 'VideoSourceConfig_1' }
  key: Record<string, string>
  data: Record<string, string> // { IsMotion: 'true' }
  message: Message // the whole decoded message
}

type Motion = {
  isMotion: boolean
  initialized: boolean // true for the state sent on subscribe
  utcTime: Date
  source: Record<string, string>
}
```

`subscribe(device, options)` is the same as `camera.events.subscribe(options)` without `use()`.

`Events` has the generated operations for `device.call()`.

## License

MIT
