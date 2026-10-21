# @2bad/onvif-deviceio

ONVIF relay outputs, digital inputs, serial ports and audio and video inputs and outputs for [`@2bad/onvif`](https://www.npmjs.com/package/@2bad/onvif).

## Install

```sh
npm install @2bad/onvif @2bad/onvif-deviceio
```

## Quick start

```ts
import { Device } from '@2bad/onvif'
import { io } from '@2bad/onvif-deviceio'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(io)

const { relayOutputs = [] } = await camera.io.getRelayOutputs()
console.log(relayOutputs.map(({ token, properties }) => `${token} ${properties.mode}`)) // [ '0 Monostable' ]

await camera.io.setRelayOutputState({ relayOutputToken: '0', logicalState: 'active' })
```

## Examples

- [Relays](examples/relays.md): monostable and bistable relays
- [Digital inputs](examples/digital-inputs.md): input states and events
- [Serial ports](examples/serial-ports.md): send a command and read the reply
- [Errors](examples/errors.md): missing tokens and unsupported IO

## API

```ts
camera.io.getServiceCapabilities()

camera.io.getRelayOutputs()
camera.io.getRelayOutputOptions()
camera.io.setRelayOutputSettings(request)
camera.io.setRelayOutputState(request)

camera.io.getDigitalInputs()
camera.io.getDigitalInputConfigurationOptions()
camera.io.setDigitalInputConfigurations(request)

camera.io.getSerialPorts()
camera.io.getSerialPortConfiguration(request)
camera.io.getSerialPortConfigurationOptions(request)
camera.io.setSerialPortConfiguration(request)
camera.io.sendReceiveSerialCommand(request)

camera.io.getVideoSources()
camera.io.getVideoOutputs()
camera.io.getAudioSources()
camera.io.getAudioOutputs()
```

Video and audio sources and outputs also have `get`, `set` and `getOptions` calls for their configuration, such as `getVideoSourceConfiguration()`, `setVideoSourceConfiguration()` and `getVideoSourceConfigurationOptions()`.

Each method has TypeScript types for its request and response. Each one takes call options as second argument, such as `{ timeoutMs: 2_000 }`.

## License

MIT
