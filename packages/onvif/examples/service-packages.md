# Service packages

`use()` adds the methods of a service package to the device.

```ts
import { events } from '@2bad/onvif-events'
import { management } from '@2bad/onvif-management'
import { media } from '@2bad/onvif-media'

const camera = device.use(management).use(media).use(events)
const { user = [] } = await camera.management.getUsers()
const profiles = await camera.media.getProfiles()
const subscription = await camera.events.subscribe({ onError: (error) => logger.warn(error) })
```

Adding a name the device already has throws an `OnvifError`.

The media and events helpers are also exported as functions that take the device as parameter.

```ts
import { getProfiles } from '@2bad/onvif-media'

const profiles = await getProfiles(device)
```
