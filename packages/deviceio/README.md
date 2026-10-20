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

## Operations

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

## Relays

```ts
await camera.io.setRelayOutputSettings({
  relayOutput: { token: '0', properties: { mode: 'Monostable', delayTime: 'PT5S', idleState: 'closed' } }
})
await camera.io.setRelayOutputState({ relayOutputToken: '0', logicalState: 'active' })
```

A `Monostable` relay returns to its idle state after `delayTime`. A `Bistable` relay stays in the state you set.

`getRelayOutputOptions()` lists the modes and delay times a camera accepts. Delay times are seconds.

## Digital inputs

```ts
const { digitalInputs = [] } = await camera.io.getDigitalInputs()
console.log(digitalInputs) // [ { token: '1', idleState: 'open' } ]
```

Inputs that change state send `tns1:Device/Trigger/DigitalInput` events. Receive them with [`@2bad/onvif-events`](https://www.npmjs.com/package/@2bad/onvif-events).

## Serial ports

```ts
const { serialData } = await camera.io.sendReceiveSerialCommand({
  token: 'SerialPort_1',
  serialData: { binary: new Uint8Array([0xff, 0x01, 0x00, 0x08, 0x00, 0x20, 0x29]) },
  timeOut: 'PT1S'
})
console.log(serialData?.binary) // Uint8Array(4) [ 255, 1, 0, 0 ]
```

`serialData` takes one of `binary` or `string`. Use `binary` for control characters. A `string` reply has its leading and trailing whitespace removed.

## Errors

A token that does not exist throws a `SoapFaultError`, such as with the subcodes `['InvalidArgVal', 'RelayToken']`.

Cameras without a kind of IO throw a `SoapFaultError` from its calls. Its `subcodes` often start with `ActionNotSupported` or `InvalidArgVal`.

## License

MIT
