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

## Examples

- [Rules](examples/rules.md): line crossing rules, rule types and sensitivity
- [Errors](examples/errors.md): missing configurations and unsupported calls

## API

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

## License

MIT
