# @2bad/onvif-management

ONVIF users, NTP, network settings, IP filter and relay outputs for [`@2bad/onvif`](https://www.npmjs.com/package/@2bad/onvif).

## Install

```sh
npm install @2bad/onvif @2bad/onvif-management
```

## Quick start

```ts
import { Device } from '@2bad/onvif'
import { management } from '@2bad/onvif-management'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(management)

const { user = [] } = await camera.management.getUsers()
console.log(user.map(({ username, userLevel }) => `${username} ${userLevel}`)) // [ 'admin Administrator' ]

await camera.management.setNTP({ fromDHCP: false, ntpManual: [{ type: 'DNS', dnsName: 'pool.ntp.org' }] })
```

## Operations

```ts
camera.management.getUsers()
camera.management.createUsers(request)
camera.management.setUser(request)
camera.management.deleteUsers(request)

camera.management.getNTP()
camera.management.setNTP(request)

camera.management.setNetworkInterfaces(request) // device.getNetworkInterfaces() reads them
camera.management.getNetworkDefaultGateway()
camera.management.setNetworkDefaultGateway(request)
camera.management.getDynamicDNS()
camera.management.setDynamicDNS(request)
camera.management.getZeroConfiguration()
camera.management.setZeroConfiguration(request)

camera.management.getIPAddressFilter()
camera.management.setIPAddressFilter(request)
camera.management.addIPAddressFilter(request)
camera.management.removeIPAddressFilter(request)

camera.management.getRelayOutputs()
camera.management.setRelayOutputSettings(request)
camera.management.setRelayOutputState(request)
```

Each method has TypeScript types for its request and response. Each one takes call options as second argument, such as `{ timeoutMs: 2_000 }`.

## Users

```ts
await camera.management.createUsers({ user: [{ username: 'viewer', password: 'secret', userLevel: 'User' }] })
await camera.management.setUser({ user: [{ username: 'viewer', password: 'changed', userLevel: 'User' }] })
await camera.management.deleteUsers({ username: ['viewer'] })
```

After changing the password of the user you are connected as, connect again with the new password.

## Relays

```ts
const { relayOutputs: [relay] = [] } = await camera.management.getRelayOutputs()
if (relay) await camera.management.setRelayOutputState({ relayOutputToken: relay.token, logicalState: 'active' })
```

A relay in `Monostable` mode returns to idle after its `delayTime`.

## Errors

A camera that rejects a setting throws a `SoapFaultError`. Its `subcodes` say why, such as `['OperationProhibited', 'PasswordTooWeak']`.

Network changes can move the camera to another address. Connect again at the new address.

## License

MIT
