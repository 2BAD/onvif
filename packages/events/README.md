# @2bad/onvif-events

ONVIF events and motion detection for [`@2bad/onvif`](https://www.npmjs.com/package/@2bad/onvif).

## Install

```sh
npm install @2bad/onvif @2bad/onvif-media @2bad/onvif-events
```

## Quick start

```ts
import { Device } from '@2bad/onvif'
import { events } from '@2bad/onvif-events'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(events)

for await (const motion of camera.events.motion({ onError: (error) => logger.warn(error) })) {
  console.log(motion.videoSource, motion.isMotion) // VideoSource_1 true
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
camera.events.getEventProperties(): Promise<GetEventPropertiesResponse> // the topics the camera supports
camera.events.getServiceCapabilities(): Promise<GetServiceCapabilitiesResponse>
camera.events.motion(options: SubscribeOptions): AsyncGenerator<MotionState>

function motionOf(notification: Notification): Motion | undefined // RuleEngine/CellMotionDetector/Motion
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

type MotionState = {
  videoSource: string // VideoSource_1
  isMotion: boolean
  initialized: boolean // true for the state sent on subscribe
  utcTime: Date
}

type Motion = {
  isMotion: boolean
  initialized: boolean // true for the state sent on subscribe
  utcTime: Date
  source: Record<string, string>
}
```

`subscribe(device, options)` and `motion(device, options)` are the same as the `camera.events` methods without `use()`.

## License

MIT
