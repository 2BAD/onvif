# Migrating from `onvif`

For code written for [`onvif`](https://www.npmjs.com/package/onvif) 0.8 (`Cam`) or 1.0 (`Onvif`).

## Install

```sh
npm uninstall onvif
npm install @2bad/onvif @2bad/onvif-media @2bad/onvif-events @2bad/onvif-discovery
```

Install only the packages you use. Needs Node.js 26 or later. ESM only.

## Connecting

```js
// onvif
const cam = new Cam({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
await cam.connect()
```

```ts
// @2bad/onvif
import { Device } from '@2bad/onvif'
import { defaultProfile, media } from '@2bad/onvif-media'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(media)
const profile = defaultProfile(await camera.media.getProfiles())
```

`connect()` does not read profiles or video sources. There is no `cam.profiles`, `cam.defaultProfile` or `cam.activeSource`.

A wrong password fails in `connect()` with an `AuthError`.

## `Device.connect()` options

| `onvif`                         | `@2bad/onvif`      |
| ------------------------------- | ------------------ |
| `hostname`, `port`, `path`      | the same, or `url` |
| `username`, `password`          | the same           |
| `useSecure`                     | `secure`           |
| `secureOpts`, `secureOptions`   | `tls`              |
| `timeout`                       | `timeoutMs`        |
| `preserveAddress`               | `serviceAddresses` |
| `autoconnect`, `autoConnect`    | none               |
| `agent`, `useWSSecurity`, `urn` | none               |

`timeoutMs` is 10 seconds by default. It covers the whole call, retries included.

The default `serviceAddresses` works like `preserveAddress: true`. Addresses the camera reports on another host are never used. See [Security](security.md).

## Calls

Device operations go to `device.call()`.

| `onvif`                                 | `@2bad/onvif`                                                 |
| --------------------------------------- | ------------------------------------------------------------- |
| `getDeviceInformation()`                | `DeviceManagement.GetDeviceInformation`                       |
| `getSystemDateAndTime()`                | `DeviceManagement.GetSystemDateAndTime`                       |
| `getCapabilities()`                     | `DeviceManagement.GetCapabilities`                            |
| `getServices()`                         | `DeviceManagement.GetServices`                                |
| `getServiceCapabilities()`              | `DeviceManagement.GetServiceCapabilities`                     |
| `getScopes()`                           | `DeviceManagement.GetScopes`                                  |
| `getHostname()`                         | `DeviceManagement.GetHostname`                                |
| `getNetworkInterfaces()`                | `DeviceManagement.GetNetworkInterfaces`                       |
| `systemReboot()`                        | `DeviceManagement.SystemReboot`                               |
| `getProfiles()`                         | `camera.media.getProfiles()`                                  |
| `getStreamUri({ protocol })`            | `camera.media.getStreamUri(profile, { protocol })`            |
| `getSnapshotUri()`                      | `camera.media.getSnapshotUri(profile)`                        |
| `getVideoSourceConfigurations()`        | `camera.media.getVideoSourceConfigurations()`                 |
| `getVideoEncoderConfigurations()`       | `camera.media.getVideoEncoderConfigurations()`                |
| `getVideoEncoderConfigurationOptions()` | `camera.media.getVideoEncoderConfigurationOptions(encoder)`   |
| `setVideoEncoderConfiguration()`        | `camera.media.setVideoEncoderConfiguration(encoder, changes)` |
| `on('event')`                           | `camera.events.subscribe()`                                   |
| `Discovery.probe()`                     | `discover()`                                                  |

```ts
const info = await device.call(DeviceManagement.GetDeviceInformation)
```

In `onvif` 1.0 these methods are on `onvif.device` and `onvif.media`.

`device.services` replaces `cam.uri`. Its keys are service namespaces.

`device.clock` replaces `cam.timeShift`.

## Responses

Field names are camelCase and have TypeScript types. A field the schema repeats is always an array, even with one item.

`getStreamUri()` returns `uri` as a `URL`. Use `stream.uri.href` for the string.

## Snapshots

```ts
const jpeg = await camera.media.fetchSnapshot(await camera.media.getSnapshotUri(profile))
```

`fetchSnapshot()` sends the credentials passed to `connect()`. See [Snapshots](../../media/examples/snapshots.md).

## Events

```js
// onvif
cam.on('event', (message) => console.log(message.topic._, message.message.message.data))
cam.on('eventsError', (error) => console.error(error))
```

```ts
// @2bad/onvif
import { events } from '@2bad/onvif-events'

const camera = device.use(events)
const subscription = await camera.events.subscribe({ onError: (error) => logger.warn(error) })

for await (const notification of subscription) {
  console.log(notification.topic?.expression, notification.data) // tns1:VideoSource/MotionAlarm { State: 'true' }
}
```

`onError` replaces the `eventsError` listener. Stop with `break` or `subscription.close()`.

`data`, `source` and `key` are plain objects of strings. They replace `simpleItem` and its `$.Name` and `$.Value`.

`motionOf()` reads motion events. See [Motion](../../events/examples/motion.md).

## Discovery

```js
// onvif
const cams = await Discovery.probe()
```

```ts
// @2bad/onvif
import { Device } from '@2bad/onvif'
import { discover } from '@2bad/onvif-discovery'

for await (const found of discover()) {
  const [url] = found.xaddrs
  if (url) await Device.connect({ url, username: 'admin', password: 'secret' })
}
```

`discover()` yields each camera as it answers. The loop ends after 3 seconds. There are no `device` or `error` events.

## Errors

Every error is an `OnvifError` subclass with `host`, `service` and `action`. See [Errors](errors.md).

## Not available yet

PTZ, imaging, recording, replay, search, OSD, users, NTP, network settings and push events.
