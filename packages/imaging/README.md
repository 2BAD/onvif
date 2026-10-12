# @2bad/onvif-imaging

ONVIF brightness, exposure, focus, white balance and IR cut filter for [`@2bad/onvif`](https://www.npmjs.com/package/@2bad/onvif).

## Install

```sh
npm install @2bad/onvif @2bad/onvif-imaging
```

## Quick start

```ts
import { Device } from '@2bad/onvif'
import { imaging } from '@2bad/onvif-imaging'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(imaging)

const source = camera.imaging.forVideoSource('VideoSource_1')
const { imagingSettings } = await source.getImagingSettings()
console.log(imagingSettings.brightness, imagingSettings.irCutFilter) // 25 AUTO

await source.setImagingSettings({ imagingSettings: { brightness: 60 } })
```

Settings belong to a video source. `getVideoSourceConfigurations()` from [`@2bad/onvif-media`](https://www.npmjs.com/package/@2bad/onvif-media) lists the video source tokens as `sourceToken`.

## Operations

```ts
camera.imaging.getServiceCapabilities()

const source = camera.imaging.forVideoSource(videoSourceToken)
source.getImagingSettings()
source.setImagingSettings(request)
source.getOptions()

source.getMoveOptions()
source.move(request)
source.stop()
source.getStatus()

source.getPresets()
source.getCurrentPreset()
source.setCurrentPreset(request)
```

Each method has TypeScript types for its request and response. Each one takes call options as second argument, such as `{ timeoutMs: 2_000 }`.

The video source methods are also on `camera.imaging`, with `videoSourceToken` in the request.

## Settings

```ts
await source.setImagingSettings({
  imagingSettings: { exposure: { mode: 'MANUAL', exposureTime: 2_000, gain: 0 }, irCutFilter: 'OFF' },
  forcePersistence: false // keep the change until the camera restarts
})
```

Only the settings you pass are sent. `getOptions()` lists the modes and ranges a camera accepts.

Settings read with `getImagingSettings()` can be sent back unchanged. Vendor extensions are not sent back.

## Focus

```ts
await source.move({ focus: { continuous: { speed: 0.5 } } })
await source.stop()

await source.move({ focus: { absolute: { position: 0.3 } } })
```

`getMoveOptions()` lists the moves a camera supports. Many cameras support only `continuous`.

## Presets

```ts
const { preset = [] } = await source.getPresets()
console.log(preset.map(({ token, name }) => `${token} ${name}`)) // [ '1 Day', '2 Night' ]
await source.setCurrentPreset({ presetToken: '2' })
```

## Errors

A video source that does not exist throws a `SoapFaultError` with the subcodes `['InvalidArgVal', 'NoSource']`.

Some cameras without presets throw a `SoapFaultError` from `getPresets()`. Its `subcodes` start with `ActionNotSupported`.

## License

MIT
