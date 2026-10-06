# Errors

```ts
import { AuthError, OnvifError, SoapFaultError } from '@2bad/onvif'

try {
  await device.systemReboot()
} catch (error) {
  if (error instanceof AuthError) console.log('wrong password for', error.host)
  else if (error instanceof SoapFaultError)
    console.log(error.subcodes) // [ 'ActionNotSupported' ]
  else if (error instanceof OnvifError) console.log(error.action, error.message)
}
```

Every error is an `OnvifError` with `host`, `service` and `action`.

- `AuthError`: credentials rejected, with the camera's `fault` when it sent one
- `SoapFaultError`: the camera answered with a fault, with `code`, `subcodes` and `reason`
- `TransportError`: connection failed or the HTTP response was unexpected, with `status`
- `TimeoutError`: no answer before `timeoutMs`
- `ParseError`: the response isn't valid XML, with `reason` and `position`
- `DecodeError`: the response doesn't match the ONVIF schema, with `path`

Errors never contain the password.
