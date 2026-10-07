# Calling operations

```ts
import { Device } from '@2bad/onvif'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })

const { hostnameInformation } = await device.getHostname()
const { networkInterfaces } = await device.getNetworkInterfaces()
console.log(hostnameInformation.name, networkInterfaces.length) // camera-01 1

const { service } = await device.getServices({ includeCapability: false })
for (const { namespace, xAddr } of service) console.log(namespace, xAddr)
```

The request and response of every operation have TypeScript types generated from the ONVIF schema. The request can be left out when all of its fields are optional. Each method shows the ONVIF description of its operation in the editor.

## Options

```ts
const response = await device.getScopes(
  {},
  {
    // optional, values are the defaults
    timeoutMs: device.timeoutMs, // deadline for this call, retries included

    // optional, off by default
    signal, // aborts the call
    to: 'http://192.0.2.10/onvif/subscription?Idx=0', // an address the camera reported
    addressing: true // send WS-Addressing headers
  }
)
```

## Timeouts

```ts
await device.getScopes({}, { timeoutMs: 2_000 })
```

## Cancellation

```ts
const controller = new AbortController()
const info = device.getDeviceInformation({}, { signal: controller.signal })
controller.abort()
```

## Files

```ts
const { contentType, body } = await device.download('http://192.0.2.10/onvif/snapshot')
```

`download()` fetches a file the camera reported, such as a snapshot.
