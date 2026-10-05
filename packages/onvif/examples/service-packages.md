# Service packages

`use()` adds the methods of a service package to the device.

```ts
import { events } from '@2bad/onvif-events'
import { media } from '@2bad/onvif-media'

const camera = device.use(media).use(events)
const profiles = await camera.media.getProfiles()
const subscription = await camera.events.subscribe({ onError: (error) => logger.warn(error) })
```

Adding a name the device already has throws an `OnvifError`.

Each method is also exported as a function that takes the device as parameter.

```ts
import { getProfiles } from '@2bad/onvif-media'

const profiles = await getProfiles(device)
```
