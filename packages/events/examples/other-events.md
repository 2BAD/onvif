# Other events

## Every event

```ts
for await (const { topic, utcTime, data } of subscription) {
  console.log(utcTime, topic?.expression, data) // 2026-10-05T09:12:44.000Z tns1:VideoSource/MotionAlarm { State: 'true' }
}
```

Values in `source`, `key` and `data` are strings.

`topic.expression` has the prefix `tns1` for ONVIF topics, whatever prefix the camera sent. A topic in another namespace reads as `{namespace}Name`.

## Filtering by topic

```ts
const subscription = await camera.events.subscribe({
  onError: (error) => logger.warn(error),
  topics: ['tns1:VideoSource/MotionAlarm', 'tns1:Device/Trigger//.']
})
```

`//.` matches a topic and every topic below it. Some cameras accept a topic they do not have and send nothing for it.

`isTopic()` checks the topic of a notification.

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

```ts
await subscription.setSynchronizationPoint() // the camera sends the current state again
```

Some cameras leave out a few topics in that repeat.
