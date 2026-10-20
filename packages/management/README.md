# @2bad/onvif-management

ONVIF users, roles, password policies, certificates, 802.1X, time, network settings, scopes, logs, storage, IP filter and relay outputs for [`@2bad/onvif`](https://www.npmjs.com/package/@2bad/onvif).

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
camera.management.getUserRoles(request)
camera.management.setUserRole(request)
camera.management.deleteUserRole(request)
camera.management.getRemoteUser()
camera.management.setRemoteUser(request)

camera.management.getPasswordComplexityOptions()
camera.management.getPasswordComplexityConfiguration()
camera.management.setPasswordComplexityConfiguration(request)
camera.management.getPasswordHistoryConfiguration()
camera.management.setPasswordHistoryConfiguration(request)
camera.management.getAuthFailureWarningOptions()
camera.management.getAuthFailureWarningConfiguration()
camera.management.setAuthFailureWarningConfiguration(request)
camera.management.getAccessPolicy()
camera.management.setAccessPolicy(request)
camera.management.setHashingAlgorithm(request)

camera.management.getCertificates()
camera.management.getCertificatesStatus()
camera.management.setCertificatesStatus(request)
camera.management.getCertificateInformation(request)
camera.management.createCertificate(request)
camera.management.getPkcs10Request(request)
camera.management.loadCertificates(request)
camera.management.loadCertificateWithPrivateKey(request)
camera.management.getCACertificates()
camera.management.loadCACertificates(request)
camera.management.deleteCertificates(request)
camera.management.getClientCertificateMode()
camera.management.setClientCertificateMode(request)

camera.management.getDot1XConfigurations()
camera.management.getDot1XConfiguration(request)
camera.management.createDot1XConfiguration(request)
camera.management.setDot1XConfiguration(request)
camera.management.deleteDot1XConfiguration(request)

camera.management.getNTP()
camera.management.setNTP(request)
camera.management.setSystemDateAndTime(request) // device.getSystemDateAndTime() reads it

camera.management.setScopes(request) // device.getScopes() reads them
camera.management.addScopes(request)
camera.management.removeScopes(request)

camera.management.getSystemLog(request)
camera.management.getSystemSupportInformation()
camera.management.getWsdlUrl()
camera.management.sendAuxiliaryCommand(request)
camera.management.setSystemFactoryDefault(request)

camera.management.getGeoLocation()
camera.management.setGeoLocation(request)
camera.management.deleteGeoLocation(request)

camera.management.getStorageConfigurations()
camera.management.getStorageConfiguration(request)
camera.management.createStorageConfiguration(request)
camera.management.setStorageConfiguration(request)
camera.management.deleteStorageConfiguration(request)

camera.management.setNetworkInterfaces(request) // device.getNetworkInterfaces() reads them
camera.management.getNetworkDefaultGateway()
camera.management.setNetworkDefaultGateway(request)
camera.management.getDynamicDNS()
camera.management.setDynamicDNS(request)
camera.management.getZeroConfiguration()
camera.management.setZeroConfiguration(request)
camera.management.getDNS()
camera.management.setDNS(request)
camera.management.setHostname(request) // device.getHostname() reads it
camera.management.setHostnameFromDHCP(request)
camera.management.getNetworkProtocols()
camera.management.setNetworkProtocols(request)

camera.management.getDiscoveryMode()
camera.management.setDiscoveryMode(request)
camera.management.getRemoteDiscoveryMode()
camera.management.setRemoteDiscoveryMode(request)
camera.management.getDPAddresses()
camera.management.setDPAddresses(request)
camera.management.getEndpointReference()

camera.management.getDot11Capabilities()
camera.management.getDot11Status(request)
camera.management.scanAvailableDot11Networks(request)

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

## Certificates

```ts
const { nvtCertificate = [] } = await camera.management.getCertificates()
const der = nvtCertificate[0]?.certificate.data // Uint8Array
```

Certificate, key and policy data is a `Uint8Array` in both directions.

## Date and time

```ts
await camera.management.setSystemDateAndTime({ dateTimeType: 'NTP', daylightSavings: false, timeZone: { TZ: 'UTC0' } })
```

Calls after `setSystemDateAndTime()` are signed with the new device time.

## Relays

```ts
const { relayOutputs: [relay] = [] } = await camera.management.getRelayOutputs()
if (relay) await camera.management.setRelayOutputState({ relayOutputToken: relay.token, logicalState: 'active' })
```

A relay in `Monostable` mode returns to idle after its `delayTime`.

## Network

```ts
const { rebootNeeded } = await camera.management.setHostnameFromDHCP({ fromDHCP: true })
if (rebootNeeded) await camera.systemReboot()
```

`setNetworkInterfaces()` and `setHostnameFromDHCP()` return `rebootNeeded`. The change applies after the reboot.

## Errors

A camera that rejects a setting throws a `SoapFaultError`. Its `subcodes` say why, such as `['OperationProhibited', 'PasswordTooWeak']`.

Network changes can move the camera to another address. Connect again at the new address.

## License

MIT
