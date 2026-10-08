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

const profileToken = 'Profile_1'
await camera.ptz.continuousMove({ profileToken, velocity: { panTilt: { x: 0.5, y: 0 } }, timeout: 'PT1S' })
await camera.ptz.stop({ profileToken })
```

Every operation needs a media profile token. `getProfiles()` from [`@2bad/onvif-media`](https://www.npmjs.com/package/@2bad/onvif-media) lists them.

## Operations

```ts
camera.ptz.getServiceCapabilities()
camera.ptz.getNodes()
camera.ptz.getNode(request)
camera.ptz.getConfigurations()
camera.ptz.getConfiguration(request)
camera.ptz.getConfigurationOptions(request)
camera.ptz.setConfiguration(request)

camera.ptz.getStatus(request)
camera.ptz.continuousMove(request)
camera.ptz.relativeMove(request)
camera.ptz.absoluteMove(request)
camera.ptz.stop(request)

camera.ptz.getPresets(request)
camera.ptz.setPreset(request)
camera.ptz.removePreset(request)
camera.ptz.gotoPreset(request)
camera.ptz.gotoHomePosition(request)
camera.ptz.setHomePosition(request)
camera.ptz.sendAuxiliaryCommand(request)
```

Each method has TypeScript types for its request and response. Each one takes call options as second argument, such as `{ timeoutMs: 2_000 }`.

## Moving

```ts
await camera.ptz.continuousMove({ profileToken, velocity: { zoom: { x: -1 } } })
await camera.ptz.relativeMove({ profileToken, translation: { panTilt: { x: 0.1, y: 0 } } })
await camera.ptz.stop({ profileToken, panTilt: true, zoom: false })
```

Only the axes you pass are sent. Pan and tilt only cameras accept a move without `zoom`.

Values are in the camera's generic spaces, -1 to 1, unless a vector names another `space`. `getNodes()` lists the spaces a camera supports.

## Presets

```ts
const { presetToken } = await camera.ptz.setPreset({ profileToken, presetName: 'Gate' })
await camera.ptz.gotoPreset({ profileToken, presetToken })

const { preset = [] } = await camera.ptz.getPresets({ profileToken })
console.log(preset.map(({ token, name }) => `${token} ${name}`)) // [ '1 Gate' ]
```

## Errors

A move the camera cannot do throws a `SoapFaultError`. Its `subcodes` say why, such as `['InvalidArgVal', 'SpaceNotSupported']`.

Some cameras answer `gotoHomePosition()` with success and do not move. Check `homeSupported` from `getNodes()` first.

## License

MIT
