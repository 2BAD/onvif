# Subscription

## Options

```ts
const subscription = await camera.events.subscribe({
  onError: (error) => logger.warn(error), // receives each problem the subscription recovers from

  // optional, values are the defaults
  pullTimeoutMs: 30_000, // how long each request waits for events
  messageLimit: 100, // most events per request
  terminationMs: 60_000, // how long the camera keeps the subscription between requests

  // optional, off by default
  signal // closes the subscription
})
```

## Stopping

Stop with `break`, `subscription.close()` or an aborted `signal`.

```ts
const subscription = await camera.events.subscribe({
  onError: (error) => logger.warn(error),
  signal: AbortSignal.timeout(60_000)
})
```

`await using` closes the subscription at the end of the block.

```ts
await using subscription = await camera.events.subscribe({ onError: (error) => logger.warn(error) })
```

## Without `use()`

```ts
import { subscribe } from '@2bad/onvif-events'

const subscription = await subscribe(device, { onError: (error) => logger.warn(error) })
```

## Errors

`camera.events.subscribe()` throws when the camera refuses the subscription.

The loop throws when the camera rejects the credentials. It also throws when the camera reports an event address that `serviceAddresses` refuses.
