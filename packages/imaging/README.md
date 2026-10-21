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

## Examples

- [Settings](examples/settings.md): exposure, IR cut filter and other settings
- [Focus](examples/focus.md): continuous and absolute focus moves
- [Presets](examples/presets.md): list and apply imaging presets
- [Errors](examples/errors.md): missing video sources and unsupported calls

## API

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

## License

MIT
