# Metadata

```ts
import { Device } from '@2bad/onvif'
import { media } from '@2bad/onvif-media'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(media)

const { configurations: [metadata] = [] } = await camera.media.v2.getMetadataConfigurations()
console.log(metadata?.events?.filter?.topicExpression?.[0]?.value) // tns1:RuleEngine/CellMotionDetector/Motion

if (metadata) await camera.media.v2.setMetadataConfiguration({ configuration: { ...metadata, analytics: true } })
```

`getMetadataConfigurations()` returns topics with the prefix `tns1`, whatever prefix the camera sent. A topic in another namespace reads as `{namespace}Name`. Both forms can be sent back.
