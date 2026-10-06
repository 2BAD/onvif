# @2bad/onvif-management

ONVIF users, NTP, network settings, IP filter and relay outputs for [`@2bad/onvif`](https://www.npmjs.com/package/@2bad/onvif).

## Install

```sh
npm install @2bad/onvif @2bad/onvif-management
```

## Quick start

```ts
import { Device } from '@2bad/onvif'
import { Management } from '@2bad/onvif-management'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })

const { user = [] } = await device.call(Management.GetUsers)
console.log(user.map(({ username, userLevel }) => `${username} ${userLevel}`)) // [ 'admin Administrator' ]

await device.call(Management.SetNTP, { fromDHCP: false, ntpManual: [{ type: 'DNS', dnsName: 'pool.ntp.org' }] })
```

## Operations

```ts
Management.GetUsers
Management.CreateUsers
Management.SetUser
Management.DeleteUsers

Management.GetNTP
Management.SetNTP

Management.SetNetworkInterfaces // DeviceManagement.GetNetworkInterfaces reads them
Management.GetNetworkDefaultGateway
Management.SetNetworkDefaultGateway
Management.GetDynamicDNS
Management.SetDynamicDNS
Management.GetZeroConfiguration
Management.SetZeroConfiguration

Management.GetIPAddressFilter
Management.SetIPAddressFilter
Management.AddIPAddressFilter
Management.RemoveIPAddressFilter

Management.GetRelayOutputs
Management.SetRelayOutputSettings
Management.SetRelayOutputState
```

Each one is called with `device.call()` and has TypeScript types for its request and response.

## Users

```ts
await device.call(Management.CreateUsers, { user: [{ username: 'viewer', password: 'secret', userLevel: 'User' }] })
await device.call(Management.SetUser, { user: [{ username: 'viewer', password: 'changed', userLevel: 'User' }] })
await device.call(Management.DeleteUsers, { username: ['viewer'] })
```

After changing the password of the user you are connected as, connect again with the new password.

## Relays

```ts
const { relayOutputs: [relay] = [] } = await device.call(Management.GetRelayOutputs)
if (relay) await device.call(Management.SetRelayOutputState, { relayOutputToken: relay.token, logicalState: 'active' })
```

A relay in `Monostable` mode returns to idle after its `delayTime`.

## Errors

A camera that rejects a setting throws a `SoapFaultError`. Its `subcodes` say why, such as `['OperationProhibited', 'PasswordTooWeak']`.

Network changes can move the camera to another address. Connect again at the new address.

## License

MIT
