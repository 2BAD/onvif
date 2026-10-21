# Rules

## Line crossing

```ts
import { Device } from '@2bad/onvif'
import { analytics } from '@2bad/onvif-analytics'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(analytics)
const configuration = camera.analytics.forConfiguration('VideoAnalytics0')

await configuration.createRules({
  rule: [
    {
      name: 'Gate',
      type: 'tt:LineDetector',
      parameters: {
        simpleItem: [{ name: 'Direction', value: 'Any' }],
        elementItem: [
          {
            name: 'Segments',
            polyline: {
              point: [
                { x: -0.5, y: 0 },
                { x: 0.5, y: 0 }
              ]
            }
          }
        ]
      }
    }
  ]
})
```

`getSupportedRules()` lists the rule types a camera accepts and the parameters of each. Parameter values are strings.

An element item takes one of `cellLayout`, `polygon`, `polyline` or `motionRegionConfig`. Content of other types is read under `$any`. A rule or module with such an item cannot be sent back and throws an `OnvifError`.

## Types

Rule and module types use the prefixes `tt`, `axt` and `xs`, whatever prefix the camera sent. A type in another namespace reads as `{namespace}Name`. Both forms can be sent back.

## Sensitivity

Some cameras store a module's `Sensitivity` in steps. A value sent back unchanged can read back as a different value.
