# @2bad/onvif-ptz

ONVIF pan, tilt, zoom, presets and home position for [`@2bad/onvif`](https://www.npmjs.com/package/@2bad/onvif).

## Install

```sh
npm install @2bad/onvif @2bad/onvif-ptz
```

## Quick start

```ts
import { Device } from '@2bad/onvif'
import { ptz } from '@2bad/onvif-ptz'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(ptz)

const profile = camera.ptz.forProfile('Profile_1')
await profile.continuousMove({ velocity: { panTilt: { x: 0.5, y: 0 } }, timeout: 'PT1S' })
await profile.stop()
```

Moves, status and presets belong to a media profile. `getProfiles()` from [`@2bad/onvif-media`](https://www.npmjs.com/package/@2bad/onvif-media) lists the profile tokens.

## Operations

```ts
camera.ptz.getServiceCapabilities()
camera.ptz.getNodes()
camera.ptz.getNode(request)
camera.ptz.getConfigurations()
camera.ptz.getConfiguration(request)
camera.ptz.getConfigurationOptions(request)
camera.ptz.setConfiguration(request)

const profile = camera.ptz.forProfile(profileToken)
profile.getStatus()
profile.continuousMove(request)
profile.relativeMove(request)
profile.absoluteMove(request)
profile.stop()

profile.getPresets()
profile.setPreset(request)
profile.removePreset(request)
profile.gotoPreset(request)
profile.gotoHomePosition()
profile.setHomePosition()
profile.sendAuxiliaryCommand(request)
```

Each method has TypeScript types for its request and response. Each one takes call options as second argument, such as `{ timeoutMs: 2_000 }`.

The profile methods are also on `camera.ptz`, with `profileToken` in the request.

## Moving

```ts
await profile.continuousMove({ velocity: { zoom: { x: -1 } } })
await profile.relativeMove({ translation: { panTilt: { x: 0.1, y: 0 } } })
await profile.stop({ panTilt: true, zoom: false })
```

Only the axes you pass are sent. Pan and tilt only cameras accept a move without `zoom`.

Values are in the camera's generic spaces, -1 to 1, unless a vector names another `space`. `getNodes()` lists the spaces a camera supports.

## Presets

```ts
const { presetToken } = await profile.setPreset({ presetName: 'Gate' })
await profile.gotoPreset({ presetToken })

const { preset = [] } = await profile.getPresets()
console.log(preset.map(({ token, name }) => `${token} ${name}`)) // [ '1 Gate' ]
```

## Errors

A move the camera cannot do throws a `SoapFaultError`. Its `subcodes` say why, such as `['InvalidArgVal', 'SpaceNotSupported']`.

Some cameras answer `gotoHomePosition()` with success and do not move. Check `homeSupported` from `getNodes()` first.

## License

MIT
