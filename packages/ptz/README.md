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

## Examples

- [Moving](examples/moving.md): continuous, relative and stop
- [Presets](examples/presets.md): save and go to presets
- [Errors](examples/errors.md): unsupported moves and home position

## API

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

## License

MIT
