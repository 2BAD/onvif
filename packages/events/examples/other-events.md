# Other events

## Every event

```ts
for await (const { topic, utcTime, data } of subscription) {
  console.log(utcTime, topic?.expression, data) // 2026-10-05T09:12:44.000Z tns1:VideoSource/MotionAlarm { State: 'true' }
}
```

Values in `source`, `key` and `data` are strings.

## Filtering by topic

```ts
import { isTopic } from '@2bad/onvif-events'

for await (const notification of subscription) {
  if (isTopic(notification.topic, ['VideoSource', 'MotionAlarm'])) console.log(notification.data['State'])
}
```

```ts
const { topicSet } = await camera.events.getEventProperties() // the topics the camera offers
```

## Current state

After subscribing and after every reconnect, the camera sends the current state of every topic. To get only changes, skip events whose `propertyOperation` is `'Initialized'`.
