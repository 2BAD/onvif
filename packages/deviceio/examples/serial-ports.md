# Serial ports

```ts
import { Device } from '@2bad/onvif'
import { io } from '@2bad/onvif-deviceio'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(io)

const { serialData } = await camera.io.sendReceiveSerialCommand({
  token: 'SerialPort_1',
  serialData: { binary: new Uint8Array([0xff, 0x01, 0x00, 0x08, 0x00, 0x20, 0x29]) },
  timeOut: 'PT1S'
})
console.log(serialData?.binary) // Uint8Array(4) [ 255, 1, 0, 0 ]
```

`serialData` takes one of `binary` or `string`. Use `binary` for control characters. A `string` reply has its leading and trailing whitespace removed.
