# @2bad/onvif-analytics

ONVIF analytics modules and rules, such as motion, line crossing and field detection, for [`@2bad/onvif`](https://www.npmjs.com/package/@2bad/onvif).

## Install

```sh
npm install @2bad/onvif @2bad/onvif-analytics
```

## Quick start

```ts
import { Device } from '@2bad/onvif'
import { analytics } from '@2bad/onvif-analytics'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(analytics)

const configuration = camera.analytics.forConfiguration('VideoAnalytics0')
const { rule = [] } = await configuration.getRules()
console.log(rule.map(({ name, type }) => `${name} ${type}`)) // [ 'MotionDetectorRule0 tt:CellMotionDetector' ]
```

Modules and rules belong to a video analytics configuration. `v1.getProfiles()` from [`@2bad/onvif-media`](https://www.npmjs.com/package/@2bad/onvif-media) lists its token as `videoAnalyticsConfiguration.token`.

## Operations

```ts
camera.analytics.getServiceCapabilities()
camera.analytics.getSupportedMetadata()

const configuration = camera.analytics.forConfiguration(configurationToken)
configuration.getSupportedAnalyticsModules()
configuration.getAnalyticsModules()
configuration.createAnalyticsModules(request)
configuration.modifyAnalyticsModules(request)
configuration.deleteAnalyticsModules(request)
configuration.getAnalyticsModuleOptions()

configuration.getSupportedRules()
configuration.getRules()
configuration.createRules(request)
configuration.modifyRules(request)
configuration.deleteRules(request)
configuration.getRuleOptions()
```

Each method has TypeScript types for its request and response. Each one takes call options as second argument, such as `{ timeoutMs: 2_000 }`.

The configuration methods are also on `camera.analytics`, with `configurationToken` in the request.

## Rules

```ts
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

## Errors

A configuration that does not exist throws a `SoapFaultError` with the subcodes `['InvalidArgs', 'NoConfig']` or `['InvalidArgVal', 'NoConfig']`.

Many cameras do not implement `getRuleOptions()`, `getAnalyticsModuleOptions()` or `getSupportedMetadata()`. They throw a `SoapFaultError`, often with `ActionNotSupported` as the first subcode.

## License

MIT
