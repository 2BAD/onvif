import { AuthError, DecodeError, Device, OnvifError, SoapFaultError, TimeoutError, TransportError } from '@2bad/onvif'
import { decode, parseEnvelope, type XmlObject } from '@2bad/onvif/soap'
import { afterEach, describe, expect, it } from 'vitest'
import { corpus, fixture } from '../../../tools/fixtures/corpus.ts'
import {
  type ActionOverride,
  type MockCamera,
  type MockCameraOptions,
  startMockCamera
} from '../../../tools/mock-camera/server.ts'
import { Management, management } from '#index.ts'

const live = (name: string): string => fixture(`live/dvc/dcn-bm2220lpr/${name}.xml`).xml
const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const connect = async (options?: MockCameraOptions) => {
  const mock = await startMockCamera(options)
  cleanups.push(() => mock.close())
  const url = new URL(mock.url)
  const device = await Device.connect({
    hostname: url.hostname,
    port: Number(url.port),
    username: 'admin',
    password: 'password'
  })
  cleanups.push(() => device.close())
  return { mock, device: device.use(management) }
}

const answer = (body: string): ActionOverride => ({ kind: 'status', status: 200, body })

const fault = (subcodes: string[], reason: string): ActionOverride => ({
  kind: 'status',
  status: 400,
  body:
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:ter="http://www.onvif.org/ver10/error">' +
    '<s:Body><s:Fault><s:Code><s:Value>s:Sender</s:Value>' +
    subcodes.map((subcode) => `<s:Subcode><s:Value>${subcode}</s:Value>`).join('') +
    subcodes.map(() => '</s:Subcode>').join('') +
    `</s:Code><s:Reason><s:Text xml:lang="en">${reason}</s:Text></s:Reason></s:Fault></s:Body></s:Envelope>`
})

const usersAnswer = (users: string): ActionOverride =>
  answer(live('device.GetUsers').replace(/<tds:User>[\s\S]*<\/tds:User>/, users))

const requestOf = (mock: MockCamera, action: string): XmlObject => {
  const body = mock.requests.findLast((request) => request.action === action)?.body ?? ''
  return parseEnvelope(body).body
}

const rejection = async (action: () => Promise<unknown>): Promise<unknown> => {
  try {
    await action()
  } catch (error) {
    return error
  }
  throw new Error('Expected a rejection')
}

const operations = [
  Management.SetNetworkInterfaces,
  Management.GetNetworkDefaultGateway,
  Management.SetNetworkDefaultGateway,
  Management.GetUsers,
  Management.CreateUsers,
  Management.SetUser,
  Management.DeleteUsers,
  Management.GetNTP,
  Management.SetNTP,
  Management.GetDynamicDNS,
  Management.SetDynamicDNS,
  Management.GetZeroConfiguration,
  Management.SetZeroConfiguration,
  Management.GetIPAddressFilter,
  Management.SetIPAddressFilter,
  Management.AddIPAddressFilter,
  Management.RemoveIPAddressFilter,
  Management.GetRelayOutputs,
  Management.SetRelayOutputSettings,
  Management.SetRelayOutputState,
  Management.GetDNS,
  Management.SetDNS,
  Management.SetHostname,
  Management.SetHostnameFromDHCP,
  Management.GetNetworkProtocols,
  Management.SetNetworkProtocols,
  Management.GetDiscoveryMode,
  Management.SetDiscoveryMode,
  Management.GetRemoteDiscoveryMode,
  Management.SetRemoteDiscoveryMode,
  Management.GetDPAddresses,
  Management.SetDPAddresses,
  Management.GetEndpointReference,
  Management.GetDot11Capabilities,
  Management.GetDot11Status,
  Management.ScanAvailableDot11Networks,
  Management.SetScopes,
  Management.AddScopes,
  Management.RemoveScopes,
  Management.SetSystemDateAndTime,
  Management.SetSystemFactoryDefault,
  Management.GetSystemLog,
  Management.GetSystemSupportInformation,
  Management.GetWsdlUrl,
  Management.SendAuxiliaryCommand,
  Management.GetGeoLocation,
  Management.SetGeoLocation,
  Management.DeleteGeoLocation,
  Management.GetStorageConfigurations,
  Management.CreateStorageConfiguration,
  Management.GetStorageConfiguration,
  Management.SetStorageConfiguration,
  Management.DeleteStorageConfiguration,
  Management.GetUserRoles,
  Management.SetUserRole,
  Management.DeleteUserRole,
  Management.GetRemoteUser,
  Management.SetRemoteUser,
  Management.GetPasswordComplexityOptions,
  Management.GetPasswordComplexityConfiguration,
  Management.SetPasswordComplexityConfiguration,
  Management.GetPasswordHistoryConfiguration,
  Management.SetPasswordHistoryConfiguration,
  Management.GetAuthFailureWarningOptions,
  Management.GetAuthFailureWarningConfiguration,
  Management.SetAuthFailureWarningConfiguration,
  Management.GetAccessPolicy,
  Management.SetAccessPolicy,
  Management.SetHashingAlgorithm,
  Management.CreateCertificate,
  Management.GetCertificates,
  Management.GetCertificatesStatus,
  Management.SetCertificatesStatus,
  Management.DeleteCertificates,
  Management.GetPkcs10Request,
  Management.LoadCertificates,
  Management.GetClientCertificateMode,
  Management.SetClientCertificateMode,
  Management.GetCACertificates,
  Management.LoadCertificateWithPrivateKey,
  Management.GetCertificateInformation,
  Management.LoadCACertificates,
  Management.CreateDot1XConfiguration,
  Management.SetDot1XConfiguration,
  Management.GetDot1XConfiguration,
  Management.GetDot1XConfigurations,
  Management.DeleteDot1XConfiguration,
  Management.GetSystemUris,
  Management.StartFirmwareUpgrade,
  Management.StartSystemRestore,
  Management.UpgradeFirmware
]

// no lab camera accepts these, so the simulator capture covers them
const simulatorOnly = new Set(['SetSystemFactoryDefault', 'SetStorageConfiguration', 'SetHashingAlgorithm'])
// no capture target implements these
const faultOnly = new Set([
  'SendAuxiliaryCommand',
  'UpgradeFirmware',
  'GetUserRoles',
  'SetUserRole',
  'DeleteUserRole',
  'GetPasswordComplexityOptions',
  'GetPasswordComplexityConfiguration',
  'GetPasswordHistoryConfiguration',
  'GetAuthFailureWarningOptions',
  'GetAuthFailureWarningConfiguration'
])
// the capture sends these back as read, and no capture target reads them
const uncaptured = new Set([
  'SetPasswordComplexityConfiguration',
  'SetPasswordHistoryConfiguration',
  'SetAuthFailureWarningConfiguration'
])

describe('generated management operations', () => {
  const captures = corpus.flatMap((entry) => {
    const match = /^(?:live|simulator)\/.+\/device\.(\w+?)(?:Fault)?\.xml$/.exec(entry.name)
    const operation = operations.find((candidate) => candidate.name === match?.[1])
    return operation ? [{ ...entry, operation }] : []
  })
  const fixtures = captures.filter(
    ({ name, operation, status, fault }) => name.endsWith(`device.${operation.name}.xml`) && status === 200 && !fault
  )
  const decodable = fixtures.filter(
    ({ name, xml }) =>
      !/<tds:(?:DynamicDNSInformation|Capabilities|Status|PolicyFile|NvtCertificate|CertificateInformation|Pkcs10Request|Dot1XConfiguration) xsi:nil="true"\/>/.test(
        xml
      ) && name !== 'live/ezviz/ds-2de2c400ig-w-w/device.GetStorageConfiguration.xml'
  )

  it('cover a camera capture for every operation', () => {
    const captured = (prefix: string) =>
      new Set(fixtures.filter(({ name }) => name.startsWith(prefix)).map(({ operation }) => operation.name))
    const live = captured('live/')
    const simulator = captured('simulator/')
    const faulted = new Set(captures.filter(({ fault }) => fault).map(({ operation }) => operation.name))
    const missing = operations
      .map(({ name }) => name)
      .filter((name) => !uncaptured.has(name))
      .filter((name) => !(faultOnly.has(name) ? faulted : simulatorOnly.has(name) ? simulator : live).has(name))
    expect(missing).toEqual([])
  })

  it.each(decodable.map((entry) => [entry.name, entry] as const))('decode %s', (_name, { xml, operation }) => {
    const { body } = parseEnvelope(xml)
    const response = body[operation.response.name]
    expect(response).toBeDefined()
    expect(() => decode(operation.schema, operation.response.type, response ?? '')).not.toThrow()
  })
})

describe('management', () => {
  it('adds a method for every operation as device.management', async () => {
    const { device } = await connect()
    const methods = Object.getOwnPropertyNames(Management.ManagementClient.prototype)
    const expected = operations.map(({ name }) => `${name.charAt(0).toLowerCase()}${name.slice(1)}`)
    expect(typeof device.management.uploadFirmware).toBe('function')
    expect(typeof device.management.uploadBackup).toBe('function')
    expect(methods.filter((name) => name !== 'constructor').toSorted()).toEqual(expected.toSorted())
    expect(device.management).toBeInstanceOf(Management.ManagementClient)
    expect(Object.getOwnPropertyDescriptor(device, 'management')).toMatchObject({ writable: false, enumerable: true })
  })

  it('sends the same request as Device.call', async () => {
    const { mock, device } = await connect()
    const request = { fromDHCP: false, ntpManual: [{ type: 'DNS', dnsName: 'pool.ntp.org' }] }
    await device.call(Management.SetNTP, request)
    await device.management.setNTP(request)
    const [byCall, byMethod] = mock.requests.filter(({ action }) => action === 'SetNTP')
    expect(parseEnvelope(byMethod?.body ?? '').body).toEqual(parseEnvelope(byCall?.body ?? '').body)
    await expect(device.management.getUsers()).resolves.toEqual(await device.call(Management.GetUsers))
  })
})

describe('Management on the camera', () => {
  it('reads the network, time, user, filter and relay settings as typed values', async () => {
    const { device } = await connect()
    expect(await device.management.getNetworkDefaultGateway()).toEqual({
      networkGateway: { ipv4Address: ['192.0.2.18'] }
    })
    expect(await device.management.getUsers()).toEqual({
      user: [{ username: 'REDACTED3', userLevel: 'Administrator' }]
    })
    expect(await device.management.getZeroConfiguration()).toEqual({
      zeroConfiguration: { interfaceToken: 'eth0', enabled: true, addresses: ['192.0.2.20'] }
    })
    expect(await device.management.getIPAddressFilter()).toEqual({ ipAddressFilter: { type: 'Deny' } })
    expect(await device.management.getRelayOutputs()).toEqual({
      relayOutputs: [{ token: '0', properties: { mode: 'Monostable', delayTime: 'PT20S', idleState: 'closed' } }]
    })
  })

  it('returns the NTP server the camera reports with type IPv4 and a DNS name as it is', async () => {
    const { device } = await connect()
    expect(await device.management.getNTP()).toEqual({
      ntpInformation: { fromDHCP: false, ntpManual: [{ type: 'IPv4', dnsName: 'host10.example' }] }
    })
  })

  it('rejects the nil dynamic DNS information of the camera with the path of the element', async () => {
    const { device } = await connect()
    const error = await rejection(() => device.management.getDynamicDNS())
    expect(error).toBeInstanceOf(DecodeError)
    expect(error).toMatchObject({
      path: 'GetDynamicDNSResponse.DynamicDNSInformation',
      service: 'tds',
      action: 'GetDynamicDNS'
    })
  })

  it('keeps names that look like numbers or booleans as strings', async () => {
    const { device } = await connect({
      overrides: {
        'device.GetUsers': usersAnswer(
          '<tds:User><tt:Username>007</tt:Username><tt:UserLevel>Operator</tt:UserLevel></tds:User>' +
            '<tds:User><tt:Username>1234</tt:Username><tt:UserLevel>User</tt:UserLevel></tds:User>'
        ),
        'device.GetDynamicDNS': answer(
          live('device.GetDynamicDNS').replace(
            '<tds:DynamicDNSInformation xsi:nil="true"/>',
            '<tds:DynamicDNSInformation><tt:Type>ClientUpdates</tt:Type><tt:Name>true</tt:Name>' +
              '<tt:TTL>PT1H</tt:TTL></tds:DynamicDNSInformation>'
          )
        )
      }
    })
    expect(await device.management.getUsers()).toEqual({
      user: [
        { username: '007', userLevel: 'Operator' },
        { username: '1234', userLevel: 'User' }
      ]
    })
    expect(await device.management.getDynamicDNS()).toEqual({
      dynamicDNSInformation: { type: 'ClientUpdates', name: 'true', TTL: 'PT1H' }
    })
  })

  it('returns no users when the device lists none', async () => {
    const { device } = await connect({ overrides: { 'device.GetUsers': usersAnswer('') } })
    expect(await device.management.getUsers()).toEqual({})
  })

  it('returns no relays from the DCN-BF5365, which has none', async () => {
    const { device } = await connect({
      overrides: { 'device.GetRelayOutputs': answer(fixture('live/dvc/dcn-bf5365/device.GetRelayOutputs.xml').xml) }
    })
    expect(await device.management.getRelayOutputs()).toEqual({})
  })

  it('rejects the nil dynamic DNS information of the DCN-BF5365 as of the camera', async () => {
    const { device } = await connect({
      overrides: { 'device.GetDynamicDNS': answer(fixture('live/dvc/dcn-bf5365/device.GetDynamicDNS.xml').xml) }
    })
    await expect(device.management.getDynamicDNS()).rejects.toThrow(
      'Missing required element Type at GetDynamicDNSResponse.DynamicDNSInformation'
    )
  })

  it('keeps the empty IPv6 gateway the DRN-3282R lists', async () => {
    const { device } = await connect({
      overrides: {
        'device.GetNetworkDefaultGateway': answer(fixture('live/dvc/drn-3282r/device.GetNetworkDefaultGateway.xml').xml)
      }
    })
    expect(await device.management.getNetworkDefaultGateway()).toEqual({
      networkGateway: { ipv4Address: ['192.0.2.18'], ipv6Address: [''] }
    })
  })

  it('reads the eleven relays of the DRN-3282R with their tokens in braces', async () => {
    const { device } = await connect({
      overrides: { 'device.GetRelayOutputs': answer(fixture('live/dvc/drn-3282r/device.GetRelayOutputs.xml').xml) }
    })
    const { relayOutputs = [] } = await device.management.getRelayOutputs()
    expect(relayOutputs).toHaveLength(11)
    expect(relayOutputs[0]).toEqual({
      token: '{00000000-0000-4000-8000-000000000011}',
      properties: { mode: 'Monostable', delayTime: 'PT5S', idleState: 'closed' }
    })
  })

  it('reports an operation the DRN-3282R does not implement as a SOAP fault without subcodes', async () => {
    const { device } = await connect({
      overrides: {
        'device.GetIPAddressFilter': {
          kind: 'status',
          status: 400,
          body: fixture('live/dvc/drn-3282r/device.UnknownActionFault.xml').xml
        }
      }
    })
    const error = await rejection(() => device.management.getIPAddressFilter())
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({
      code: 'Sender',
      subcodes: [],
      reason: 'method name or namespace not recognized',
      action: 'GetIPAddressFilter'
    })
  })

  it('sends user names and passwords as text, whatever characters they contain', async () => {
    const { mock, device } = await connect()
    const username = 'x</Username><UserLevel>Administrator</UserLevel><Username>y'
    const password = `a<b&"c'd]]>`
    await device.management.createUsers({ user: [{ username, password, userLevel: 'User' }] })
    const users = (requestOf(mock, 'CreateUsers')['CreateUsers'] as XmlObject)['User']
    expect(users).toEqual({ Username: username, Password: password, UserLevel: 'User' })
  })

  it('creates, changes and deletes a user', async () => {
    const { mock, device } = await connect()
    const user = { username: 'operator', password: 'first', userLevel: 'Operator' }
    expect(await device.management.createUsers({ user: [user] })).toEqual({})
    expect(await device.management.setUser({ user: [{ ...user, password: 'second' }] })).toEqual({})
    expect(await device.management.deleteUsers({ username: ['operator', 'viewer'] })).toEqual({})
    expect(requestOf(mock, 'SetUser')).toEqual({
      SetUser: { User: { Username: 'operator', Password: 'second', UserLevel: 'Operator' } }
    })
    expect(requestOf(mock, 'DeleteUsers')).toEqual({ DeleteUsers: { Username: ['operator', 'viewer'] } })
  })

  it('reports a user the device does not know as a SOAP fault with the action', async () => {
    const { device } = await connect({
      overrides: { 'device.DeleteUsers': { kind: 'status', status: 400, body: live('device.DeleteUsersMissingFault') } }
    })
    const error = await rejection(() => device.management.deleteUsers({ username: ['nobody'] }))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({
      subcodes: ['InvalidArgVal', 'UsernameMissing'],
      reason: 'Username not recognized.',
      service: 'tds',
      action: 'DeleteUsers'
    })
  })

  it('keeps the password out of the error when the device rejects it', async () => {
    const { device } = await connect({
      overrides: {
        'device.SetUser': { kind: 'status', status: 400, body: live('device.SetUserWithoutPasswordFault') }
      }
    })
    const password = 'Secret-Password-1'
    const error = await rejection(() =>
      device.management.setUser({ user: [{ username: 'viewer', password, userLevel: 'User' }] })
    )
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: ['OperationProhibited', 'PasswordTooWeak'], action: 'SetUser' })
    expect(`${String(error)} ${JSON.stringify(error)} ${(error as Error).stack ?? ''}`).not.toContain(password)
  })

  it('keeps the password out of the error when it cannot be sent', async () => {
    const { mock, device } = await connect()
    const password = 'Secret\u0000Password'
    const error = await rejection(() =>
      device.management.setUser({ user: [{ username: 'viewer', password, userLevel: 'User' }] })
    )
    expect(error).toBeInstanceOf(OnvifError)
    expect(`${String(error)} ${JSON.stringify(error)} ${(error as Error).stack ?? ''}`).not.toContain('Secret')
    expect(mock.requests.some(({ action }) => action === 'SetUser')).toBe(false)
  })

  it('sends the NTP servers with the spec element names', async () => {
    const { mock, device } = await connect()
    await device.management.setNTP({
      fromDHCP: false,
      ntpManual: [
        { type: 'IPv4', ipv4Address: '192.0.2.1' },
        { type: 'DNS', dnsName: 'pool.ntp.example' }
      ]
    })
    expect(requestOf(mock, 'SetNTP')).toEqual({
      SetNTP: {
        FromDHCP: 'false',
        NTPManual: [
          { Type: 'IPv4', IPv4Address: '192.0.2.1' },
          { Type: 'DNS', DNSname: 'pool.ntp.example' }
        ]
      }
    })
  })

  it('switches the relay and changes its settings', async () => {
    const { mock, device } = await connect()
    const properties = { mode: 'Bistable', delayTime: 'PT1S', idleState: 'open' }
    expect(await device.management.setRelayOutputSettings({ relayOutputToken: '0', properties })).toEqual({})
    expect(await device.management.setRelayOutputState({ relayOutputToken: '0', logicalState: 'active' })).toEqual({})
    expect(requestOf(mock, 'SetRelayOutputSettings')).toEqual({
      SetRelayOutputSettings: {
        RelayOutputToken: '0',
        Properties: { Mode: 'Bistable', DelayTime: 'PT1S', IdleState: 'open' }
      }
    })
    expect(requestOf(mock, 'SetRelayOutputState')).toEqual({
      SetRelayOutputState: { RelayOutputToken: '0', LogicalState: 'active' }
    })
  })

  it('reports a relay the device does not have as a SOAP fault', async () => {
    const { device } = await connect({
      overrides: { 'device.SetRelayOutputState': fault(['ter:InvalidArgVal', 'ter:RelayToken'], 'Unknown relay token') }
    })
    const error = await rejection(() =>
      device.management.setRelayOutputState({ relayOutputToken: '7', logicalState: 'active' })
    )
    expect(error).toMatchObject({ name: 'SoapFaultError', action: 'SetRelayOutputState' })
  })

  it('changes the network interface, gateway, zero configuration and dynamic DNS', async () => {
    const { mock, device } = await connect()
    expect(
      await device.management.setNetworkInterfaces({
        interfaceToken: 'eth0',
        networkInterface: {
          enabled: true,
          MTU: 1500,
          ipv4: { enabled: true, manual: [{ address: '192.0.2.14', prefixLength: 24 }], DHCP: false }
        }
      })
    ).toEqual({ rebootNeeded: false })
    expect(await device.management.setNetworkDefaultGateway({ ipv4Address: ['192.0.2.1'] })).toEqual({})
    expect(await device.management.setZeroConfiguration({ interfaceToken: 'eth0', enabled: false })).toEqual({})
    expect(await device.management.setDynamicDNS({ type: 'NoUpdate' })).toEqual({})
    expect(requestOf(mock, 'SetNetworkInterfaces')).toEqual({
      SetNetworkInterfaces: {
        InterfaceToken: 'eth0',
        NetworkInterface: {
          Enabled: 'true',
          MTU: '1500',
          IPv4: { Enabled: 'true', Manual: { Address: '192.0.2.14', PrefixLength: '24' }, DHCP: 'false' }
        }
      }
    })
  })

  it('replaces, adds and removes IP address filter entries', async () => {
    const { mock, device } = await connect()
    const ipAddressFilter = { type: 'Deny', ipv4Address: [{ address: '198.51.100.7', prefixLength: 32 }] }
    expect(await device.management.setIPAddressFilter({ ipAddressFilter })).toEqual({})
    expect(await device.management.addIPAddressFilter({ ipAddressFilter })).toEqual({})
    expect(await device.management.removeIPAddressFilter({ ipAddressFilter })).toEqual({})
    expect(requestOf(mock, 'RemoveIPAddressFilter')).toEqual({
      RemoveIPAddressFilter: {
        IPAddressFilter: { Type: 'Deny', IPv4Address: { Address: '198.51.100.7', PrefixLength: '32' } }
      }
    })
  })
})

describe('Network settings on the camera', () => {
  const hikvision = (name: string): string => fixture(`live/ezviz/ds-2de2c400ig-w-w/${name}.xml`).xml
  const happytime = (name: string): string => fixture(`simulator/happytimesoft/ipcamera/${name}.xml`).xml

  it('reads the manual DNS servers and search domain', async () => {
    const { device } = await connect()
    expect(await device.management.getDNS()).toEqual({
      dnsInformation: {
        fromDHCP: false,
        searchDomain: ['domain.name'],
        dnsManual: [
          { type: 'IPv4', ipv4Address: '192.0.2.21' },
          { type: 'IPv4', ipv4Address: '192.0.2.22' }
        ]
      }
    })
  })

  it('reads the DNS servers the DS-2DE2C400IG-W-W got from DHCP', async () => {
    const { device } = await connect({ overrides: { 'device.GetDNS': answer(hikvision('device.GetDNS')) } })
    expect(await device.management.getDNS()).toEqual({
      dnsInformation: { fromDHCP: true, dnsFromDHCP: [{ type: 'IPv4', ipv4Address: '192.0.2.21' }] }
    })
  })

  it('sends the DNS servers with the spec element names', async () => {
    const { mock, device } = await connect()
    await device.management.setDNS({
      fromDHCP: false,
      searchDomain: ['example.com'],
      dnsManual: [
        { type: 'IPv4', ipv4Address: '192.0.2.53' },
        { type: 'IPv6', ipv6Address: '2001:db8::53' }
      ]
    })
    expect(requestOf(mock, 'SetDNS')).toEqual({
      SetDNS: {
        FromDHCP: 'false',
        SearchDomain: 'example.com',
        DNSManual: [
          { Type: 'IPv4', IPv4Address: '192.0.2.53' },
          { Type: 'IPv6', IPv6Address: '2001:db8::53' }
        ]
      }
    })
  })

  it('sends the DNS server fields in the schema namespace', async () => {
    const { mock, device } = await connect()
    await device.management.setDNS({
      fromDHCP: false,
      searchDomain: ['a.example', 'b.example'],
      dnsManual: [{ type: 'IPv6', ipv6Address: '2001:db8::53' }]
    })
    const body = mock.requests.findLast(({ action }) => action === 'SetDNS')?.body ?? ''
    expect(body).toContain('xmlns:tt="http://www.onvif.org/ver10/schema"')
    expect(body).toContain(
      '<tds:SearchDomain>a.example</tds:SearchDomain><tds:SearchDomain>b.example</tds:SearchDomain>' +
        '<tds:DNSManual><tt:Type>IPv6</tt:Type><tt:IPv6Address>2001:db8::53</tt:IPv6Address></tds:DNSManual>'
    )
  })

  it('sends a disabled protocol on port 0', async () => {
    const { mock, device } = await connect()
    await device.management.setNetworkProtocols({ networkProtocols: [{ name: 'HTTPS', enabled: false, port: [0] }] })
    expect(requestOf(mock, 'SetNetworkProtocols')).toEqual({
      SetNetworkProtocols: { NetworkProtocols: { Name: 'HTTPS', Enabled: 'false', Port: '0' } }
    })
  })

  it('reads every port of a protocol as an array', async () => {
    const { device } = await connect()
    expect(await device.management.getNetworkProtocols()).toEqual({
      networkProtocols: [
        { name: 'HTTP', enabled: true, port: [80] },
        { name: 'RTSP', enabled: true, port: [554] }
      ]
    })
  })

  it('sends the protocols with each port as its own element', async () => {
    const { mock, device } = await connect()
    await device.management.setNetworkProtocols({
      networkProtocols: [{ name: 'HTTP', enabled: true, port: [80, 8080] }]
    })
    expect(requestOf(mock, 'SetNetworkProtocols')).toEqual({
      SetNetworkProtocols: { NetworkProtocols: { Name: 'HTTP', Enabled: 'true', Port: ['80', '8080'] } }
    })
  })

  it('reads and sets the discovery modes', async () => {
    const { mock, device } = await connect()
    expect(await device.management.getDiscoveryMode()).toEqual({ discoveryMode: 'Discoverable' })
    expect(await device.management.getRemoteDiscoveryMode()).toEqual({ remoteDiscoveryMode: 'Discoverable' })
    expect(await device.management.setDiscoveryMode({ discoveryMode: 'NonDiscoverable' })).toEqual({})
    expect(await device.management.setRemoteDiscoveryMode({ remoteDiscoveryMode: 'NonDiscoverable' })).toEqual({})
    expect(requestOf(mock, 'SetDiscoveryMode')).toEqual({ SetDiscoveryMode: { DiscoveryMode: 'NonDiscoverable' } })
    expect(requestOf(mock, 'SetRemoteDiscoveryMode')).toEqual({
      SetRemoteDiscoveryMode: { RemoteDiscoveryMode: 'NonDiscoverable' }
    })
  })

  it('reports remote discovery on a device without it as a SOAP fault', async () => {
    const { device } = await connect({
      overrides: {
        'device.GetRemoteDiscoveryMode': {
          kind: 'status',
          status: 400,
          body: happytime('device.GetRemoteDiscoveryMode')
        }
      }
    })
    const error = await rejection(() => device.management.getRemoteDiscoveryMode())
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: ['ActionNotSupported'], action: 'GetRemoteDiscoveryMode' })
  })

  it('returns no discovery proxies when the device lists none', async () => {
    const { mock, device } = await connect()
    expect(await device.management.getDPAddresses()).toEqual({})
    expect(await device.management.setDPAddresses({})).toEqual({})
    expect(requestOf(mock, 'SetDPAddresses')).toEqual({ SetDPAddresses: '' })
  })

  it('sends discovery proxy addresses with the spec element names', async () => {
    const { mock, device } = await connect()
    await device.management.setDPAddresses({
      dpAddress: [
        { type: 'IPv4', ipv4Address: '192.0.2.40' },
        { type: 'DNS', dnsName: 'proxy.example' }
      ]
    })
    expect(requestOf(mock, 'SetDPAddresses')).toEqual({
      SetDPAddresses: {
        DPAddress: [
          { Type: 'IPv4', IPv4Address: '192.0.2.40' },
          { Type: 'DNS', DNSname: 'proxy.example' }
        ]
      }
    })
  })

  it('reports the DS-2DE2C400IG-W-W rejecting the discovery proxy request as a SOAP fault', async () => {
    const { device } = await connect({
      overrides: { 'device.GetDPAddresses': { kind: 'status', status: 500, body: hikvision('device.GetDPAddresses') } }
    })
    const error = await rejection(() => device.management.getDPAddresses())
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: ['InvalidArgVal', 'InvalidParameter'], action: 'GetDPAddresses' })
  })

  it('reports a device that closes the connection without an answer as a transport error after one retry', async () => {
    const { mock, device } = await connect({ overrides: { 'device.GetDPAddresses': { kind: 'destroy' } } })
    const error = await rejection(() => device.management.getDPAddresses())
    expect(error).toBeInstanceOf(TransportError)
    expect(error).toMatchObject({ service: 'tds', action: 'GetDPAddresses' })
    expect(mock.requests.filter(({ action }) => action === 'GetDPAddresses')).toHaveLength(2)
  })

  it('sends the hostname as text, whatever characters it contains', async () => {
    const { mock, device } = await connect()
    const name = 'camera</Name><FromDHCP>true</FromDHCP><Name>'
    expect(await device.management.setHostname({ name })).toEqual({})
    expect(requestOf(mock, 'SetHostname')).toEqual({ SetHostname: { Name: name } })
  })

  it.each([
    'live/dvc/dcn-bm2220lpr',
    'live/ezviz/ds-2de2c400ig-w-w',
    'live/dahua/dhi-itc413-pw4d-z1',
    'simulator/happytimesoft/ipcamera'
  ])('reports the invalid hostname fault of %s with the InvalidHostname subcode', async (directory) => {
    const { xml, status } = fixture(`${directory}/device.SetHostnameInvalidFault.xml`)
    const { device } = await connect({ overrides: { 'device.SetHostname': { kind: 'status', status, body: xml } } })
    const error = await rejection(() => device.management.setHostname({ name: '-invalid_name-' }))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: ['InvalidArgVal', 'InvalidHostname'], action: 'SetHostname' })
  })

  it('reports a hostname the device rejects as a SOAP fault with the subcodes', async () => {
    const { device } = await connect({
      overrides: { 'device.SetHostname': { kind: 'status', status: 400, body: live('device.SetHostnameInvalidFault') } }
    })
    const error = await rejection(() => device.management.setHostname({ name: '-invalid_name-' }))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({
      subcodes: ['InvalidArgVal', 'InvalidHostname'],
      reason: 'The requested hostname cannot be accepted by the device.',
      action: 'SetHostname'
    })
  })

  it('returns whether the device needs a reboot after the hostname source changed', async () => {
    const { mock, device } = await connect()
    expect(await device.management.setHostnameFromDHCP({ fromDHCP: true })).toEqual({ rebootNeeded: false })
    expect(requestOf(mock, 'SetHostnameFromDHCP')).toEqual({ SetHostnameFromDHCP: { FromDHCP: 'true' } })
  })

  it('returns the reboot the DS-2DE2C400IG-W-W asks for after the hostname source changed', async () => {
    const { device } = await connect({
      overrides: { 'device.SetHostnameFromDHCP': answer(hikvision('device.SetHostnameFromDHCP')) }
    })
    expect(await device.management.setHostnameFromDHCP({ fromDHCP: false })).toEqual({ rebootNeeded: true })
  })

  it('reads the endpoint reference GUID', async () => {
    const { device } = await connect()
    expect(await device.management.getEndpointReference()).toEqual({
      GUID: 'urn:uuid:00000000-0000-4000-8000-000000000014'
    })
  })

  it('reads a GUID without the urn:uuid prefix as it is', async () => {
    const { device } = await connect({
      overrides: { 'device.GetEndpointReference': answer(happytime('device.GetEndpointReference')) }
    })
    expect(await device.management.getEndpointReference()).toEqual({ GUID: '00000000-0000-4000-8000-000000000012' })
  })

  it('reads the wireless capabilities of the DS-2DE2C400IG-W-W', async () => {
    const { device } = await connect({
      overrides: { 'device.GetDot11Capabilities': answer(hikvision('device.GetDot11Capabilities')) }
    })
    expect(await device.management.getDot11Capabilities()).toEqual({
      capabilities: {
        TKIP: true,
        scanAvailableNetworks: true,
        multipleConfiguration: true,
        adHocStationMode: true,
        WEP: true
      }
    })
  })

  it('rejects the nil wireless capabilities and status of a camera without wireless with the path', async () => {
    const { device } = await connect()
    await expect(device.management.getDot11Capabilities()).rejects.toMatchObject({
      name: 'DecodeError',
      path: 'GetDot11CapabilitiesResponse.Capabilities',
      action: 'GetDot11Capabilities'
    })
    await expect(device.management.getDot11Status({ interfaceToken: 'eth0' })).rejects.toMatchObject({
      name: 'DecodeError',
      path: 'GetDot11StatusResponse.Status',
      action: 'GetDot11Status'
    })
  })

  it('reads an empty wireless status as empty names', async () => {
    const { device } = await connect({
      overrides: { 'device.GetDot11Status': answer(happytime('device.GetDot11Status')) }
    })
    expect(await device.management.getDot11Status({ interfaceToken: 'wlan0' })).toEqual({
      status: { SSID: '', activeConfigAlias: '' }
    })
  })

  it('reads wireless networks with their ciphers as arrays and a hex SSID of digits as text', async () => {
    const networks =
      '<tds:Networks><tt:SSID>31323334</tt:SSID><tt:BSSID>02:00:00:00:00:30</tt:BSSID>' +
      '<tt:AuthAndMangementSuite>PSK</tt:AuthAndMangementSuite><tt:PairCipher>CCMP</tt:PairCipher>' +
      '<tt:PairCipher>TKIP</tt:PairCipher><tt:GroupCipher>TKIP</tt:GroupCipher>' +
      '<tt:SignalStrength>Very Good</tt:SignalStrength></tds:Networks>'
    const { mock, device } = await connect({
      overrides: {
        'device.ScanAvailableDot11Networks': answer(
          live('device.ScanAvailableDot11Networks').replace(
            '<tds:ScanAvailableDot11NetworksResponse></tds:ScanAvailableDot11NetworksResponse>',
            `<tds:ScanAvailableDot11NetworksResponse>${networks}</tds:ScanAvailableDot11NetworksResponse>`
          )
        )
      }
    })
    expect(await device.management.scanAvailableDot11Networks({ interfaceToken: 'wlan0' })).toEqual({
      networks: [
        {
          SSID: '31323334',
          BSSID: '02:00:00:00:00:30',
          authAndMangementSuite: ['PSK'],
          pairCipher: ['CCMP', 'TKIP'],
          groupCipher: ['TKIP'],
          signalStrength: 'Very Good'
        }
      ]
    })
    expect(requestOf(mock, 'ScanAvailableDot11Networks')).toEqual({
      ScanAvailableDot11Networks: { InterfaceToken: 'wlan0' }
    })
  })

  it('reports the wireless status the DS-2DE2C400IG-W-W does not implement as a SOAP fault', async () => {
    const { device } = await connect({
      overrides: {
        'device.GetDot11Status': { kind: 'status', status: 500, body: hikvision('device.GetDot11Status') }
      }
    })
    const error = await rejection(() => device.management.getDot11Status({ interfaceToken: 'wlan0' }))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ code: 'Receiver', subcodes: ['ActionNotSupported', 'InvalidOperation'] })
  })
})

describe('System settings on the camera', () => {
  const hikvision = (name: string): string => fixture(`live/ezviz/ds-2de2c400ig-w-w/${name}.xml`).xml
  const dahua = (name: string): string => fixture(`live/dahua/dhi-itc413-pw4d-z1/${name}.xml`).xml
  const happytime = (name: string): string => fixture(`simulator/happytimesoft/ipcamera/${name}.xml`).xml
  const rawRequest = (mock: MockCamera, action: string): string =>
    mock.requests.findLast((request) => request.action === action)?.body ?? ''

  it('sets, adds and removes scopes', async () => {
    const { mock, device } = await connect()
    const scope = 'onvif://www.onvif.org/location/hall&gate'
    expect(await device.management.setScopes({ scopes: [scope, 'onvif://www.onvif.org/name/door'] })).toEqual({})
    expect(await device.management.addScopes({ scopeItem: [scope] })).toEqual({})
    expect(await device.management.removeScopes({ scopeItem: [scope] })).toEqual({})
    expect(requestOf(mock, 'SetScopes')).toEqual({ SetScopes: { Scopes: [scope, 'onvif://www.onvif.org/name/door'] } })
    expect(requestOf(mock, 'AddScopes')).toEqual({ AddScopes: { ScopeItem: scope } })
    expect(rawRequest(mock, 'RemoveScopes')).toContain('<tds:ScopeItem>onvif://www.onvif.org/location/hall&amp;gate<')
  })

  it('returns the one removed scope the DS-2DE2C400IG-W-W lists as an array', async () => {
    const { device } = await connect({ overrides: { 'device.RemoveScopes': answer(hikvision('device.RemoveScopes')) } })
    expect(await device.management.removeScopes({ scopeItem: ['onvif://www.onvif.org/onviftest'] })).toEqual({
      scopeItem: ['onvif://www.onvif.org/onviftest']
    })
  })

  it.each([
    'live/dvc/dcn-bm2220lpr',
    'live/ezviz/ds-2de2c400ig-w-w',
    'live/dahua/dhi-itc413-pw4d-z1',
    'simulator/happytimesoft/ipcamera'
  ])('reports removing a scope %s does not have with the NoScope subcode', async (directory) => {
    const { xml, status } = fixture(`${directory}/device.RemoveScopesMissingFault.xml`)
    const { device } = await connect({ overrides: { 'device.RemoveScopes': { kind: 'status', status, body: xml } } })
    const error = await rejection(() => device.management.removeScopes({ scopeItem: ['onvif://www.onvif.org/x'] }))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: ['InvalidArgVal', 'NoScope'], action: 'RemoveScopes' })
  })

  it('sends NTP time without a date and with the time zone in the schema namespace', async () => {
    const { mock, device } = await connect()
    await device.management.setSystemDateAndTime({
      dateTimeType: 'NTP',
      daylightSavings: false,
      timeZone: { TZ: 'CST-8:00:00' }
    })
    expect(requestOf(mock, 'SetSystemDateAndTime')).toEqual({
      SetSystemDateAndTime: { DateTimeType: 'NTP', DaylightSavings: 'false', TimeZone: { TZ: 'CST-8:00:00' } }
    })
    expect(rawRequest(mock, 'SetSystemDateAndTime')).toContain(
      '<tds:TimeZone><tt:TZ>CST-8:00:00</tt:TZ></tds:TimeZone>'
    )
  })

  it('sends manual time as UTC date and time fields', async () => {
    const { mock, device } = await connect()
    await device.management.setSystemDateAndTime({
      dateTimeType: 'Manual',
      daylightSavings: true,
      timeZone: { TZ: 'GMT0BST,M3.5.0/1,M10.5.0<&>' },
      utcDateTime: { date: { year: 2026, month: 1, day: 2 }, time: { hour: 0, minute: 0, second: 5 } }
    })
    expect(requestOf(mock, 'SetSystemDateAndTime')).toEqual({
      SetSystemDateAndTime: {
        DateTimeType: 'Manual',
        DaylightSavings: 'true',
        TimeZone: { TZ: 'GMT0BST,M3.5.0/1,M10.5.0<&>' },
        UTCDateTime: { Time: { Hour: '0', Minute: '0', Second: '5' }, Date: { Year: '2026', Month: '1', Day: '2' } }
      }
    })
    expect(rawRequest(mock, 'SetSystemDateAndTime')).toContain(
      '<tds:UTCDateTime><tt:Time><tt:Hour>0</tt:Hour><tt:Minute>0</tt:Minute><tt:Second>5</tt:Second></tt:Time>'
    )
  })

  it('signs the next call with the device time after the clock was set', async () => {
    const { mock, device } = await connect({
      unauthenticated: ['device.GetSystemDateAndTime', 'device.SetSystemDateAndTime']
    })
    mock.setClockSkew(3_600_000)
    await device.management.setSystemDateAndTime({ dateTimeType: 'NTP', daylightSavings: false })
    expect(device.clock.skewMs).toBeGreaterThan(3_590_000)
    await expect(device.management.getUsers()).resolves.toMatchObject({ user: expect.any(Array) })
    expect(mock.requests.map(({ action }) => action).slice(-3)).toEqual([
      'SetSystemDateAndTime',
      'GetSystemDateAndTime',
      'GetUsers'
    ])
  })

  it('rejects the next call when the clock was set with Device.call and not measured again', async () => {
    const { mock, device } = await connect({
      unauthenticated: ['device.GetSystemDateAndTime', 'device.SetSystemDateAndTime']
    })
    mock.setClockSkew(3_600_000)
    await device.call(Management.SetSystemDateAndTime, { dateTimeType: 'NTP', daylightSavings: false })
    await expect(device.management.getUsers()).rejects.toThrow(AuthError)
  })

  it('reports a clock that cannot be measured after it was set with the action that failed', async () => {
    const overrides: Record<string, ActionOverride> = {}
    const { device } = await connect({ overrides })
    overrides['device.GetSystemDateAndTime'] = { kind: 'status', status: 503, body: '' }
    const error = await rejection(() =>
      device.management.setSystemDateAndTime({ dateTimeType: 'NTP', daylightSavings: false })
    )
    expect(error).toBeInstanceOf(TransportError)
    expect(error).toMatchObject({ status: 503, action: 'GetSystemDateAndTime' })
  })

  it('measures the clock within the deadline of the call', async () => {
    const overrides: Record<string, ActionOverride> = {}
    const { device } = await connect({ overrides })
    overrides['device.SetSystemDateAndTime'] = { kind: 'delay', ms: 150 }
    overrides['device.GetSystemDateAndTime'] = { kind: 'delay', ms: 150 }
    const error = await rejection(() =>
      device.management.setSystemDateAndTime({ dateTimeType: 'NTP', daylightSavings: false }, { timeoutMs: 250 })
    )
    expect(error).toMatchObject({ name: 'TimeoutError', action: 'GetSystemDateAndTime' })
  })

  it.each([
    ['InvalidTimeZone', 'live/dvc/dcn-bm2220lpr'],
    ['InvalidTimeZone', 'live/ezviz/ds-2de2c400ig-w-w'],
    ['InvalidTimeZone', 'live/dahua/dhi-itc413-pw4d-z1'],
    ['InvalidTimeZone', 'simulator/happytimesoft/ipcamera'],
    ['InvalidDate', 'live/dvc/dcn-bm2220lpr'],
    ['InvalidDate', 'live/ezviz/ds-2de2c400ig-w-w'],
    ['InvalidDate', 'live/dahua/dhi-itc413-pw4d-z1'],
    ['InvalidDate', 'simulator/happytimesoft/ipcamera']
  ])('reports the %s fault of %s with its subcode', async (kind, directory) => {
    const { xml, status } = fixture(`${directory}/device.SetSystemDateAndTime${kind}Fault.xml`)
    const { mock, device } = await connect({
      overrides: { 'device.SetSystemDateAndTime': { kind: 'status', status, body: xml } }
    })
    const error = await rejection(() =>
      device.management.setSystemDateAndTime({ dateTimeType: 'NTP', daylightSavings: false, timeZone: { TZ: '!' } })
    )
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({
      subcodes: ['InvalidArgVal', kind === 'InvalidDate' ? 'InvalidDateTime' : 'InvalidTimeZone'],
      action: 'SetSystemDateAndTime'
    })
    expect(mock.requests.at(-1)?.action).toBe('SetSystemDateAndTime')
  })

  it('sends the factory default type', async () => {
    const { mock, device } = await connect({
      overrides: { 'device.SetSystemFactoryDefault': answer(happytime('device.SetSystemFactoryDefault')) }
    })
    expect(await device.management.setSystemFactoryDefault({ factoryDefault: 'Soft' })).toEqual({})
    expect(requestOf(mock, 'SetSystemFactoryDefault')).toEqual({ SetSystemFactoryDefault: { FactoryDefault: 'Soft' } })
  })

  it('reads the system log as text', async () => {
    const { mock, device } = await connect()
    expect(await device.management.getSystemLog({ logType: 'Access' })).toEqual({
      systemLog: { string: 'No available system logs' }
    })
    expect(requestOf(mock, 'GetSystemLog')).toEqual({ GetSystemLog: { LogType: 'Access' } })
  })

  it('reads the empty system log of the DHI-ITC413-PW4D-Z1 as an empty string', async () => {
    const { device } = await connect({ overrides: { 'device.GetSystemLog': answer(dahua('device.GetSystemLog')) } })
    expect(await device.management.getSystemLog({ logType: 'System' })).toEqual({ systemLog: { string: '' } })
  })

  it('keeps log text that looks like a number or boolean as a string', async () => {
    const { device } = await connect({
      overrides: {
        'device.GetSystemLog': answer(live('device.GetSystemLog').replace('No available system logs', '123')),
        'device.GetSystemSupportInformation': answer(
          hikvision('device.GetSystemSupportInformation').replace('No available system support information', 'true')
        )
      }
    })
    expect(await device.management.getSystemLog({ logType: 'System' })).toEqual({ systemLog: { string: '123' } })
    expect(await device.management.getSystemSupportInformation()).toEqual({ supportInformation: { string: 'true' } })
  })

  it('reads a system log sent as an attachment reference', async () => {
    const binary =
      '<tt:Binary xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmime:contentType="text/plain">' +
      '<xop:Include xmlns:xop="http://www.w3.org/2004/08/xop/include" href="cid:log@camera"/></tt:Binary>'
    const { device } = await connect({
      overrides: {
        'device.GetSystemLog': answer(
          live('device.GetSystemLog').replace('<tt:String>No available system logs</tt:String>', binary)
        )
      }
    })
    expect(await device.management.getSystemLog({ logType: 'System' })).toEqual({
      systemLog: { binary: { include: { href: 'cid:log@camera' }, contentType: 'text/plain' } }
    })
  })

  it('reads the nil support information of the camera as neither text nor attachment', async () => {
    const { device } = await connect()
    expect(await device.management.getSystemSupportInformation()).toEqual({ supportInformation: {} })
  })

  it('keeps the space separated WSDL list of the DHI-ITC413-PW4D-Z1 as one string', async () => {
    const { device } = await connect({ overrides: { 'device.GetWsdlUrl': answer(dahua('device.GetWsdlUrl')) } })
    const { wsdlUrl } = await device.management.getWsdlUrl()
    expect(wsdlUrl.split(' ')).toHaveLength(16)
    expect(wsdlUrl.startsWith('http://www.onvif.org/onvif/ver10/device/wsdl/devicemgmt.wsdl ')).toBe(true)
  })

  it('sends an auxiliary command as text and returns the answer', async () => {
    const response =
      '<tds:SendAuxiliaryCommandResponse><tds:AuxiliaryCommandResponse>tt:Wiper|On</tds:AuxiliaryCommandResponse>' +
      '</tds:SendAuxiliaryCommandResponse>'
    const { mock, device } = await connect({
      overrides: {
        'device.SendAuxiliaryCommand': answer(
          live('device.GetWsdlUrl').replace(/<tds:GetWsdlUrlResponse>[\s\S]*<\/tds:GetWsdlUrlResponse>/, response)
        )
      }
    })
    expect(await device.management.sendAuxiliaryCommand({ auxiliaryCommand: 'tt:Wiper|On<&>' })).toEqual({
      auxiliaryCommandResponse: 'tt:Wiper|On'
    })
    expect(requestOf(mock, 'SendAuxiliaryCommand')).toEqual({
      SendAuxiliaryCommand: { AuxiliaryCommand: 'tt:Wiper|On<&>' }
    })
  })

  it('reports an auxiliary command the DS-2DE2C400IG-W-W does not support as a SOAP fault', async () => {
    const { device } = await connect({
      overrides: {
        'device.SendAuxiliaryCommand': { kind: 'status', status: 500, body: hikvision('device.SendAuxiliaryCommand') }
      }
    })
    const error = await rejection(() => device.management.sendAuxiliaryCommand({ auxiliaryCommand: 'tt:x|On' }))
    expect(error).toMatchObject({ subcodes: ['InvalidArgVal', 'AuxiliaryDataNotSupported'] })
  })

  it('sends a location with its token, entity and coordinates as attributes', async () => {
    const { mock, device } = await connect()
    const location = {
      entity: 'Device',
      token: 'onviftest',
      fixed: false,
      geoLocation: { lon: 13.405, lat: 52.52, elevation: 0 }
    }
    expect(await device.management.setGeoLocation({ location: [location] })).toEqual({})
    expect(await device.management.deleteGeoLocation({ location: [location] })).toEqual({})
    expect(rawRequest(mock, 'SetGeoLocation')).toContain(
      '<tds:Location Entity="Device" Token="onviftest" Fixed="false"><tt:GeoLocation lon="13.405" lat="52.52" elevation="0"/></tds:Location>'
    )
  })

  it('reads a location with its attributes', async () => {
    const { device } = await connect({
      overrides: { 'device.GetGeoLocation': answer(happytime('device.GetGeoLocationWithAdded')) }
    })
    expect(await device.management.getGeoLocation()).toEqual({
      location: [{ entity: 'Device', token: 'onviftest', fixed: false, geoLocation: { lon: 0, lat: 0, elevation: 0 } }]
    })
  })

  it('creates, reads, changes and deletes a storage configuration', async () => {
    const answers = Object.fromEntries(
      [
        'CreateStorageConfiguration',
        'GetStorageConfiguration',
        'SetStorageConfiguration',
        'GetStorageConfigurationsWithAdded',
        'DeleteStorageConfiguration'
      ].map((name) => [`device.${name.replace('WithAdded', '')}`, answer(happytime(`device.${name}`))])
    )
    const { mock, device } = await connect({ overrides: answers })
    const data = { type: 'NFS', localPath: '/onviftest', storageUri: 'nfs://192.0.2.22/onviftest' }
    const { token } = await device.management.createStorageConfiguration({ storageConfiguration: data })
    expect(token).toBe('StorageConfigurationToken_1')
    expect(await device.management.getStorageConfiguration({ token })).toEqual({
      storageConfiguration: { token, data }
    })
    expect(await device.management.getStorageConfigurations()).toEqual({ storageConfigurations: [{ token, data }] })
    expect(await device.management.setStorageConfiguration({ storageConfiguration: { token, data } })).toEqual({})
    expect(await device.management.deleteStorageConfiguration({ token })).toEqual({})
    expect(rawRequest(mock, 'CreateStorageConfiguration')).toContain(
      '<tds:StorageConfiguration type="NFS"><tds:LocalPath>/onviftest</tds:LocalPath>'
    )
    expect(rawRequest(mock, 'SetStorageConfiguration')).toContain(
      `<tds:StorageConfiguration token="${token}"><tds:Data type="NFS">`
    )
  })

  it('reports a storage configuration HappyTime does not have as a SOAP fault', async () => {
    const { device } = await connect({
      overrides: {
        'device.GetStorageConfiguration': {
          kind: 'status',
          status: 400,
          body: happytime('device.GetStorageConfigurationMissingFault')
        }
      }
    })
    const error = await rejection(() => device.management.getStorageConfiguration({ token: 'missing' }))
    expect(error).toMatchObject({ name: 'SoapFaultError', subcodes: ['InvalidArgVal', 'NoConfig'] })
  })

  it('reads the nil token of the camera and the empty token of the DS-2DE2C400IG-W-W as an empty string', async () => {
    const { device } = await connect()
    const request = { storageConfiguration: { type: 'NFS', localPath: '/x' } }
    expect(await device.management.createStorageConfiguration(request)).toEqual({ token: '' })
    const other = await connect({
      overrides: { 'device.CreateStorageConfiguration': answer(hikvision('device.CreateStorageConfiguration')) }
    })
    expect(await other.device.management.createStorageConfiguration(request)).toEqual({ token: '' })
  })

  it('rejects the list the DS-2DE2C400IG-W-W returns for one storage configuration', async () => {
    const { device } = await connect({
      overrides: { 'device.GetStorageConfiguration': answer(hikvision('device.GetStorageConfiguration')) }
    })
    await expect(device.management.getStorageConfiguration({ token: '' })).rejects.toMatchObject({
      name: 'DecodeError',
      action: 'GetStorageConfiguration'
    })
  })

  it('keeps the storage password out of the error when the device rejects the configuration', async () => {
    const { device } = await connect({
      overrides: {
        'device.SetStorageConfiguration': {
          kind: 'status',
          status: 500,
          body: hikvision('device.SetStorageConfiguration')
        }
      }
    })
    const password = 'Storage-Secret-9'
    const error = await rejection(() =>
      device.management.setStorageConfiguration({
        storageConfiguration: {
          token: '',
          data: { type: 'CIFS', storageUri: 'cifs://192.0.2.30/share', user: { userName: 'nas', password } }
        }
      })
    )
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(`${String(error)} ${JSON.stringify(error)} ${(error as Error).stack ?? ''}`).not.toContain(password)
  })
})

describe('Security settings on the camera', () => {
  const hikvision = (name: string): string => fixture(`live/ezviz/ds-2de2c400ig-w-w/${name}.xml`).xml
  const rawRequest = (mock: MockCamera, action: string): string =>
    mock.requests.findLast((request) => request.action === action)?.body ?? ''
  const response = (body: string): ActionOverride =>
    answer(
      live('device.GetRemoteUser').replace(/<tds:GetRemoteUserResponse>[\s\S]*<\/tds:GetRemoteUserResponse>/, body)
    )
  const leaks = (error: unknown, secret: string): boolean =>
    `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack ?? ''}`.includes(secret)

  it('reads user roles with their functions as a list', async () => {
    const roles =
      '<tds:GetUserRolesResponse><tds:UserRole><tt:Name>operator</tt:Name>' +
      '<tt:Functions>tds:GetUsers tds:SetUser  trt:GetProfiles</tt:Functions></tds:UserRole></tds:GetUserRolesResponse>'
    const { mock, device } = await connect({ overrides: { 'device.GetUserRoles': response(roles) } })
    expect(await device.management.getUserRoles({ userRole: 'operator' })).toEqual({
      userRole: [{ name: 'operator', functions: ['tds:GetUsers', 'tds:SetUser', 'trt:GetProfiles'] }]
    })
    expect(requestOf(mock, 'GetUserRoles')).toEqual({ GetUserRoles: { UserRole: 'operator' } })
  })

  it('sends a role with its functions in one space separated element', async () => {
    const { mock, device } = await connect({
      overrides: {
        'device.SetUserRole': response('<tds:SetUserRoleResponse/>'),
        'device.DeleteUserRole': response('<tds:DeleteUserRoleResponse/>')
      }
    })
    const userRole = { name: 'viewer', functions: ['trt:GetProfiles', 'trt:GetStreamUri'] }
    expect(await device.management.setUserRole({ userRole })).toEqual({})
    expect(await device.management.deleteUserRole({ userRole: 'viewer' })).toEqual({})
    expect(rawRequest(mock, 'SetUserRole')).toContain(
      '<tds:UserRole><tt:Name>viewer</tt:Name><tt:Functions>trt:GetProfiles trt:GetStreamUri</tt:Functions></tds:UserRole>'
    )
    expect(requestOf(mock, 'DeleteUserRole')).toEqual({ DeleteUserRole: { UserRole: 'viewer' } })
  })

  it('reports roles on the camera as a SOAP fault without subcodes', async () => {
    const { device } = await connect({
      overrides: { 'device.GetUserRoles': { kind: 'status', status: 400, body: live('device.GetUserRoles') } }
    })
    const error = await rejection(() => device.management.getUserRoles())
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: [], action: 'GetUserRoles' })
  })

  it('returns no remote user when none is configured and clears it with an empty request', async () => {
    const { mock, device } = await connect()
    expect(await device.management.getRemoteUser()).toEqual({})
    expect(await device.management.setRemoteUser()).toEqual({})
    expect(requestOf(mock, 'SetRemoteUser')).toEqual({ SetRemoteUser: '' })
  })

  it('reads the configured remote user', async () => {
    const remote =
      '<tds:GetRemoteUserResponse><tds:RemoteUser><tt:Username>relay</tt:Username>' +
      '<tt:UseDerivedPassword>true</tt:UseDerivedPassword></tds:RemoteUser></tds:GetRemoteUserResponse>'
    const { device } = await connect({ overrides: { 'device.GetRemoteUser': response(remote) } })
    expect(await device.management.getRemoteUser()).toEqual({
      remoteUser: { username: 'relay', useDerivedPassword: true }
    })
  })

  it('sends the remote user password as text and keeps it out of the error', async () => {
    const { mock, device } = await connect({
      overrides: {
        'device.SetRemoteUser': { kind: 'status', status: 500, body: hikvision('device.GetRemoteUser') }
      }
    })
    const password = `Remote<&>"'-Secret`
    const error = await rejection(() =>
      device.management.setRemoteUser({ remoteUser: { username: 'relay', password, useDerivedPassword: false } })
    )
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: ['ActionNotSupported', 'InvalidOperation'], action: 'SetRemoteUser' })
    expect(leaks(error, password)).toBe(false)
    expect(requestOf(mock, 'SetRemoteUser')).toEqual({
      SetRemoteUser: { RemoteUser: { Username: 'relay', Password: password, UseDerivedPassword: 'false' } }
    })
  })

  it('reads the password complexity options and configuration', async () => {
    const range = (name: string, min: number, max: number) =>
      `<tds:${name}><tt:Min>${min}</tt:Min><tt:Max>${max}</tt:Max></tds:${name}>`
    const { device } = await connect({
      overrides: {
        'device.GetPasswordComplexityOptions': response(
          `<tds:GetPasswordComplexityOptionsResponse>${range('MinLenRange', 8, 64)}${range('UppercaseRange', 0, 4)}` +
            '<tds:BlockUsernameOccurrenceSupported>true</tds:BlockUsernameOccurrenceSupported>' +
            '</tds:GetPasswordComplexityOptionsResponse>'
        ),
        'device.GetPasswordComplexityConfiguration': response(
          '<tds:GetPasswordComplexityConfigurationResponse><tds:MinLen>8</tds:MinLen><tds:Uppercase>0</tds:Uppercase>' +
            '<tds:PolicyConfigurationLocked>false</tds:PolicyConfigurationLocked>' +
            '</tds:GetPasswordComplexityConfigurationResponse>'
        )
      }
    })
    expect(await device.management.getPasswordComplexityOptions()).toEqual({
      minLenRange: { min: 8, max: 64 },
      uppercaseRange: { min: 0, max: 4 },
      blockUsernameOccurrenceSupported: true
    })
    expect(await device.management.getPasswordComplexityConfiguration()).toEqual({
      minLen: 8,
      uppercase: 0,
      policyConfigurationLocked: false
    })
  })

  it('sends zero counts and false flags of the password policies', async () => {
    const { mock, device } = await connect({
      overrides: {
        'device.SetPasswordComplexityConfiguration': response('<tds:SetPasswordComplexityConfigurationResponse/>'),
        'device.SetPasswordHistoryConfiguration': response('<tds:SetPasswordHistoryConfigurationResponse/>'),
        'device.SetAuthFailureWarningConfiguration': response('<tds:SetAuthFailureWarningConfigurationResponse/>')
      }
    })
    await device.management.setPasswordComplexityConfiguration({
      minLen: 0,
      number: 0,
      blockUsernameOccurrence: false
    })
    await device.management.setPasswordHistoryConfiguration({ enabled: false, length: 0 })
    await device.management.setAuthFailureWarningConfiguration({ enabled: true, monitorPeriod: 60, maxAuthFailures: 0 })
    expect(requestOf(mock, 'SetPasswordComplexityConfiguration')).toEqual({
      SetPasswordComplexityConfiguration: { MinLen: '0', Number: '0', BlockUsernameOccurrence: 'false' }
    })
    expect(requestOf(mock, 'SetPasswordHistoryConfiguration')).toEqual({
      SetPasswordHistoryConfiguration: { Enabled: 'false', Length: '0' }
    })
    expect(requestOf(mock, 'SetAuthFailureWarningConfiguration')).toEqual({
      SetAuthFailureWarningConfiguration: { Enabled: 'true', MonitorPeriod: '60', MaxAuthFailures: '0' }
    })
  })

  it('reads the password history and the authentication failure warning settings', async () => {
    const { device } = await connect({
      overrides: {
        'device.GetPasswordHistoryConfiguration': response(
          '<tds:GetPasswordHistoryConfigurationResponse><tds:Enabled>true</tds:Enabled><tds:Length>5</tds:Length>' +
            '</tds:GetPasswordHistoryConfigurationResponse>'
        ),
        'device.GetAuthFailureWarningOptions': response(
          '<tds:GetAuthFailureWarningOptionsResponse><tds:MonitorPeriodRange><tt:Min>1</tt:Min><tt:Max>3600</tt:Max>' +
            '</tds:MonitorPeriodRange><tds:AuthFailureRange><tt:Min>1</tt:Min><tt:Max>100</tt:Max></tds:AuthFailureRange>' +
            '</tds:GetAuthFailureWarningOptionsResponse>'
        ),
        'device.GetAuthFailureWarningConfiguration': response(
          '<tds:GetAuthFailureWarningConfigurationResponse><tds:Enabled>true</tds:Enabled>' +
            '<tds:MonitorPeriod>60</tds:MonitorPeriod><tds:MaxAuthFailures>5</tds:MaxAuthFailures>' +
            '</tds:GetAuthFailureWarningConfigurationResponse>'
        )
      }
    })
    expect(await device.management.getPasswordHistoryConfiguration()).toEqual({ enabled: true, length: 5 })
    expect(await device.management.getAuthFailureWarningOptions()).toEqual({
      monitorPeriodRange: { min: 1, max: 3600 },
      authFailureRange: { min: 1, max: 100 }
    })
    expect(await device.management.getAuthFailureWarningConfiguration()).toEqual({
      enabled: true,
      monitorPeriod: 60,
      maxAuthFailures: 5
    })
  })

  it('reads the access policy of the DS-2DE2C400IG-W-W as bytes and sends it back as base64', async () => {
    const { mock, device } = await connect({
      overrides: {
        'device.GetAccessPolicy': answer(hikvision('device.GetAccessPolicy')),
        'device.SetAccessPolicy': answer(hikvision('device.SetAccessPolicy'))
      }
    })
    const { policyFile } = await device.management.getAccessPolicy()
    expect(policyFile).toEqual({ data: new Uint8Array(Buffer.from('eFY0EgHvzas=', 'base64')) })
    expect(await device.management.setAccessPolicy({ policyFile })).toEqual({})
    expect(rawRequest(mock, 'SetAccessPolicy')).toContain(
      '<tds:PolicyFile><tt:Data>eFY0EgHvzas=</tt:Data></tds:PolicyFile>'
    )
  })

  it('sends the content type of the access policy as an xmime attribute', async () => {
    const { mock, device } = await connect({
      overrides: { 'device.SetAccessPolicy': answer(hikvision('device.SetAccessPolicy')) }
    })
    await device.management.setAccessPolicy({
      policyFile: { data: new TextEncoder().encode('<policy/>'), contentType: 'application/xml' }
    })
    const body = rawRequest(mock, 'SetAccessPolicy')
    expect(body).toContain('xmlns:xmime="http://www.w3.org/2005/05/xmlmime"')
    expect(body).toMatch(
      /<tds:PolicyFile [^>]*xmime:contentType="application\/xml"[^>]*><tt:Data>PHBvbGljeS8\+<\/tt:Data>/
    )
  })

  it('rejects the nil access policy of the camera with the path', async () => {
    const { device } = await connect()
    await expect(device.management.getAccessPolicy()).rejects.toMatchObject({
      name: 'DecodeError',
      path: expect.stringContaining('GetAccessPolicyResponse.PolicyFile')
    })
  })

  it('sends the hashing algorithms as one space separated element', async () => {
    const { mock, device } = await connect({
      overrides: { 'device.SetHashingAlgorithm': response('<tds:SetHashingAlgorithmResponse/>') }
    })
    expect(await device.management.setHashingAlgorithm({ algorithm: ['SHA-256', 'MD5'] })).toEqual({})
    expect(rawRequest(mock, 'SetHashingAlgorithm')).toContain('<tds:Algorithm>SHA-256 MD5</tds:Algorithm>')
  })
})

describe('Certificates and 802.1X on the camera', () => {
  const hikvision = (name: string): string => fixture(`live/ezviz/ds-2de2c400ig-w-w/${name}.xml`).xml
  const rawRequest = (mock: MockCamera, action: string): string =>
    mock.requests.findLast((request) => request.action === action)?.body ?? ''
  const response = (body: string): ActionOverride =>
    answer(
      live('device.GetCertificates').replace(
        /<tds:GetCertificatesResponse>[\s\S]*<\/tds:GetCertificatesResponse>/,
        body
      )
    )
  const notSupported = (): ActionOverride => ({
    kind: 'status',
    status: 500,
    body: hikvision('device.GetCertificates')
  })
  const leaks = (error: unknown, secret: string): boolean =>
    `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack ?? ''}`.includes(secret)
  const der = new Uint8Array([0x30, 0x82, 0x01, 0x0a, 0x02, 0x82, 0x01, 0x01, 0x00, 0xff])
  const base64 = Buffer.from(der).toString('base64')
  const certificate = (id: string) =>
    `<tt:CertificateID>${id}</tt:CertificateID><tt:Certificate><tt:Data>${base64}</tt:Data></tt:Certificate>`

  it('reads every certificate with its bytes and keeps an ID of digits as text', async () => {
    const { device } = await connect({
      overrides: {
        'device.GetCertificates': response(
          `<tds:GetCertificatesResponse><tds:NvtCertificate>${certificate('0123')}</tds:NvtCertificate>` +
            `<tds:NvtCertificate>${certificate('https')}</tds:NvtCertificate></tds:GetCertificatesResponse>`
        )
      }
    })
    expect(await device.management.getCertificates()).toEqual({
      nvtCertificate: [
        { certificateID: '0123', certificate: { data: der } },
        { certificateID: 'https', certificate: { data: der } }
      ]
    })
  })

  it('returns no certificates when the device lists none', async () => {
    const { device } = await connect()
    expect(await device.management.getCertificates()).toEqual({})
    expect(await device.management.getCACertificates()).toEqual({})
    expect(await device.management.getCertificatesStatus()).toEqual({})
  })

  it('creates a certificate with its validity as dates', async () => {
    const { mock, device } = await connect({
      overrides: {
        'device.CreateCertificate': response(
          `<tds:CreateCertificateResponse><tds:NvtCertificate>${certificate('onviftest')}</tds:NvtCertificate>` +
            '</tds:CreateCertificateResponse>'
        )
      }
    })
    const created = await device.management.createCertificate({
      certificateID: 'onviftest',
      subject: 'CN=camera.example, O=A&B',
      validNotBefore: new Date('2026-10-20T00:00:00Z'),
      validNotAfter: new Date('2027-10-20T00:00:00Z')
    })
    expect(created).toEqual({ nvtCertificate: { certificateID: 'onviftest', certificate: { data: der } } })
    expect(requestOf(mock, 'CreateCertificate')).toEqual({
      CreateCertificate: {
        CertificateID: 'onviftest',
        Subject: 'CN=camera.example, O=A&B',
        ValidNotBefore: '2026-10-20T00:00:00.000Z',
        ValidNotAfter: '2027-10-20T00:00:00.000Z'
      }
    })
  })

  it('rejects the nil certificate the camera creates with the path', async () => {
    const { device } = await connect()
    await expect(device.management.createCertificate({ certificateID: 'onviftest' })).rejects.toMatchObject({
      name: 'DecodeError',
      path: expect.stringContaining('CreateCertificateResponse.NvtCertificate')
    })
  })

  it('reads the certificate information with its usage, length and validity', async () => {
    const information =
      '<tds:GetCertificateInformationResponse><tds:CertificateInformation><tt:CertificateID>https</tt:CertificateID>' +
      '<tt:IssuerDN>CN=camera.example</tt:IssuerDN><tt:SubjectDN>CN=camera.example</tt:SubjectDN>' +
      '<tt:KeyUsage Critical="true">digitalSignature keyEncipherment</tt:KeyUsage><tt:KeyLength>2048</tt:KeyLength>' +
      '<tt:Version>3</tt:Version><tt:SerialNum>00A1</tt:SerialNum><tt:SignatureAlgorithm>1.2.840.113549.1.1.11</tt:SignatureAlgorithm>' +
      '<tt:Validity><tt:From>2026-10-20T00:00:00Z</tt:From><tt:Until>2027-10-20T00:00:00Z</tt:Until></tt:Validity>' +
      '</tds:CertificateInformation></tds:GetCertificateInformationResponse>'
    const { mock, device } = await connect({ overrides: { 'device.GetCertificateInformation': response(information) } })
    expect(await device.management.getCertificateInformation({ certificateID: 'https' })).toEqual({
      certificateInformation: {
        certificateID: 'https',
        issuerDN: 'CN=camera.example',
        subjectDN: 'CN=camera.example',
        keyUsage: { critical: true, value: 'digitalSignature keyEncipherment' },
        keyLength: 2048,
        version: '3',
        serialNum: '00A1',
        signatureAlgorithm: '1.2.840.113549.1.1.11',
        validity: { from: new Date('2026-10-20T00:00:00Z'), until: new Date('2027-10-20T00:00:00Z') }
      }
    })
    expect(requestOf(mock, 'GetCertificateInformation')).toEqual({
      GetCertificateInformation: { CertificateID: 'https' }
    })
  })

  it('requests a PKCS#10 request with attributes and reads it as bytes', async () => {
    const { mock, device } = await connect({
      overrides: {
        'device.GetPkcs10Request': response(
          `<tds:GetPkcs10RequestResponse><tds:Pkcs10Request><tt:Data>${base64}</tt:Data></tds:Pkcs10Request>` +
            '</tds:GetPkcs10RequestResponse>'
        )
      }
    })
    const attributes = { data: new Uint8Array([1, 2, 3]), contentType: 'application/octet-stream' }
    expect(
      await device.management.getPkcs10Request({ certificateID: 'onviftest', subject: 'CN=onviftest', attributes })
    ).toEqual({ pkcs10Request: { data: der } })
    expect(rawRequest(mock, 'GetPkcs10Request')).toMatch(
      /<tds:Attributes [^>]*xmime:contentType="application\/octet-stream"[^>]*><tt:Data>AQID<\/tt:Data><\/tds:Attributes>/
    )
  })

  it('loads device and CA certificates with the spec element names', async () => {
    const { mock, device } = await connect()
    const loaded = { certificateID: 'onviftest', certificate: { data: der } }
    expect(await device.management.loadCertificates({ nvtCertificate: [loaded] })).toEqual({})
    expect(await device.management.loadCACertificates({ caCertificate: [loaded] })).toEqual({})
    expect(rawRequest(mock, 'LoadCertificates')).toContain(
      `<tds:NVTCertificate>${certificate('onviftest')}</tds:NVTCertificate>`
    )
    expect(rawRequest(mock, 'LoadCACertificates')).toContain(
      `<tds:CACertificate>${certificate('onviftest')}</tds:CACertificate>`
    )
  })

  it('keeps the private key out of the error when the device rejects it', async () => {
    const { mock, device } = await connect({ overrides: { 'device.LoadCertificateWithPrivateKey': notSupported() } })
    const privateKey = new Uint8Array(Buffer.from('Private-Key-Material-0123456789'))
    const error = await rejection(() =>
      device.management.loadCertificateWithPrivateKey({
        certificateWithPrivateKey: [
          { certificateID: 'onviftestkey', certificate: { data: der }, privateKey: { data: privateKey } }
        ]
      })
    )
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({
      subcodes: ['ActionNotSupported', 'InvalidOperation'],
      action: 'LoadCertificateWithPrivateKey'
    })
    expect(leaks(error, Buffer.from(privateKey).toString('base64'))).toBe(false)
    expect(leaks(error, 'Private-Key-Material')).toBe(false)
    expect(rawRequest(mock, 'LoadCertificateWithPrivateKey')).toContain(
      `<tt:PrivateKey><tt:Data>${Buffer.from(privateKey).toString('base64')}</tt:Data></tt:PrivateKey>`
    )
  })

  it('sets the certificate status and deletes certificates', async () => {
    const { mock, device } = await connect()
    expect(
      await device.management.setCertificatesStatus({
        certificateStatus: [
          { certificateID: 'https', status: true },
          { certificateID: 'onviftest', status: false }
        ]
      })
    ).toEqual({})
    expect(await device.management.deleteCertificates({ certificateID: ['onviftest', 'onviftestca'] })).toEqual({})
    expect(requestOf(mock, 'SetCertificatesStatus')).toEqual({
      SetCertificatesStatus: {
        CertificateStatus: [
          { CertificateID: 'https', Status: 'true' },
          { CertificateID: 'onviftest', Status: 'false' }
        ]
      }
    })
    expect(requestOf(mock, 'DeleteCertificates')).toEqual({
      DeleteCertificates: { CertificateID: ['onviftest', 'onviftestca'] }
    })
  })

  it('reads and sets the client certificate mode', async () => {
    const { mock, device } = await connect()
    expect(await device.management.getClientCertificateMode()).toEqual({ enabled: false })
    expect(await device.management.setClientCertificateMode({ enabled: false })).toEqual({})
    expect(requestOf(mock, 'SetClientCertificateMode')).toEqual({ SetClientCertificateMode: { Enabled: 'false' } })
  })

  it('reports certificates on the DS-2DE2C400IG-W-W as not supported', async () => {
    const { device } = await connect({ overrides: { 'device.GetCertificates': notSupported() } })
    await expect(device.management.getCertificates()).rejects.toMatchObject({
      name: 'SoapFaultError',
      subcodes: ['ActionNotSupported', 'InvalidOperation'],
      action: 'GetCertificates'
    })
  })

  it('creates, reads, changes and deletes an 802.1X configuration', async () => {
    const configuration =
      '<tt:Dot1XConfigurationToken>onviftest</tt:Dot1XConfigurationToken><tt:Identity>camera</tt:Identity>' +
      '<tt:EAPMethod>13</tt:EAPMethod><tt:CACertificateID>ca1</tt:CACertificateID><tt:CACertificateID>ca2</tt:CACertificateID>' +
      '<tt:EAPMethodConfiguration><tt:TLSConfiguration><tt:CertificateID>client</tt:CertificateID></tt:TLSConfiguration>' +
      '</tt:EAPMethodConfiguration>'
    const { mock, device } = await connect({
      overrides: {
        'device.GetDot1XConfiguration': response(
          `<tds:GetDot1XConfigurationResponse><tds:Dot1XConfiguration>${configuration}</tds:Dot1XConfiguration>` +
            '</tds:GetDot1XConfigurationResponse>'
        ),
        'device.GetDot1XConfigurations': response(
          `<tds:GetDot1XConfigurationsResponse><tds:Dot1XConfiguration>${configuration}</tds:Dot1XConfiguration>` +
            '</tds:GetDot1XConfigurationsResponse>'
        )
      }
    })
    const expected = {
      dot1XConfigurationToken: 'onviftest',
      identity: 'camera',
      eapMethod: 13,
      caCertificateID: ['ca1', 'ca2'],
      eapMethodConfiguration: { tlsConfiguration: { certificateID: 'client' } }
    }
    expect(await device.management.createDot1XConfiguration({ dot1XConfiguration: expected })).toEqual({})
    expect(await device.management.getDot1XConfiguration({ dot1XConfigurationToken: 'onviftest' })).toEqual({
      dot1XConfiguration: expected
    })
    expect(await device.management.getDot1XConfigurations()).toEqual({ dot1XConfiguration: [expected] })
    expect(await device.management.setDot1XConfiguration({ dot1XConfiguration: expected })).toEqual({})
    expect(await device.management.deleteDot1XConfiguration({ dot1XConfigurationToken: ['onviftest'] })).toEqual({})
    expect(rawRequest(mock, 'CreateDot1XConfiguration')).toContain(
      '<tds:Dot1XConfiguration><tt:Dot1XConfigurationToken>onviftest</tt:Dot1XConfigurationToken>'
    )
    expect(requestOf(mock, 'DeleteDot1XConfiguration')).toEqual({
      DeleteDot1XConfiguration: { Dot1XConfigurationToken: 'onviftest' }
    })
  })

  it('rejects the nil 802.1X configuration of the camera with the path', async () => {
    const { device } = await connect()
    await expect(
      device.management.getDot1XConfiguration({ dot1XConfigurationToken: 'onviftest' })
    ).rejects.toMatchObject({
      name: 'DecodeError',
      path: expect.stringContaining('GetDot1XConfigurationResponse.Dot1XConfiguration')
    })
  })

  it('sends the 802.1X password as text and keeps it out of the error', async () => {
    const { mock, device } = await connect({ overrides: { 'device.CreateDot1XConfiguration': notSupported() } })
    const password = `Dot1X<&>"'-Secret`
    const error = await rejection(() =>
      device.management.createDot1XConfiguration({
        dot1XConfiguration: {
          dot1XConfigurationToken: 'onviftest',
          identity: 'camera',
          eapMethod: 25,
          eapMethodConfiguration: { password }
        }
      })
    )
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(leaks(error, password)).toBe(false)
    expect(leaks(error, 'Dot1X&lt;')).toBe(false)
    const sent = requestOf(mock, 'CreateDot1XConfiguration')['CreateDot1XConfiguration'] as XmlObject
    expect((sent['Dot1XConfiguration'] as XmlObject)['EAPMethodConfiguration']).toEqual({ Password: password })
  })
})

describe('Firmware upgrade and system restore on the camera', () => {
  const hikvision = (name: string): string => fixture(`live/ezviz/ds-2de2c400ig-w-w/${name}.xml`).xml
  const dahua = (name: string): string => fixture(`live/dahua/dhi-itc413-pw4d-z1/${name}.xml`).xml
  const happytime = (name: string): string => fixture(`simulator/happytimesoft/ipcamera/${name}.xml`).xml
  const firmware = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01])
  const startAnswer = (uploadUri: string, uploadDelay: string): ActionOverride =>
    answer(
      happytime('device.StartFirmwareUpgrade')
        .replace('http://192.0.2.12:80/FirmwareUpgrade', uploadUri)
        .replace('<tds:UploadDelay>PT5S</tds:UploadDelay>', `<tds:UploadDelay>${uploadDelay}</tds:UploadDelay>`)
    )

  it('reads the download addresses of logs, support information and backup', async () => {
    const { device } = await connect({
      overrides: { 'device.GetSystemUris': answer(happytime('device.GetSystemUris')) }
    })
    expect(await device.management.getSystemUris()).toEqual({
      systemLogUris: {
        systemLog: [
          { type: 'System', uri: 'http://192.0.2.12:80/SystemLog' },
          { type: 'Access', uri: 'http://192.0.2.12:80/AccessLog' }
        ]
      },
      supportInfoUri: 'http://192.0.2.12:80/SupportInfo',
      systemBackupUri: 'http://192.0.2.12:80/SystemBackup'
    })
  })

  it('reads the empty addresses of the DS-2DE2C400IG-W-W as empty strings', async () => {
    const { device } = await connect({
      overrides: { 'device.GetSystemUris': answer(hikvision('device.GetSystemUris')) }
    })
    expect(await device.management.getSystemUris()).toEqual({
      systemLogUris: { systemLog: [{ type: 'System', uri: '' }] },
      supportInfoUri: ''
    })
  })

  it('uploads the firmware to the address the DS-2DE2C400IG-W-W returns, on the configured device', async () => {
    const { mock, device } = await connect({
      overrides: { 'device.StartFirmwareUpgrade': answer(hikvision('device.StartFirmwareUpgrade')) }
    })
    expect(await device.management.uploadFirmware(firmware)).toEqual({ expectedDownTime: 'PT180S' })
    expect(mock.uploads).toEqual([
      {
        path: '/onvif/device_service/StartFirmwareUpgrade',
        contentType: 'application/octet-stream',
        body: Buffer.from(firmware)
      }
    ])
  })

  it('waits the upload delay of the DHI-ITC413-PW4D-Z1 before uploading', async () => {
    const { mock, device } = await connect({
      overrides: {
        'device.StartFirmwareUpgrade': answer(
          dahua('device.StartFirmwareUpgrade').replace(
            '<tds:UploadDelay>PT3S</tds:UploadDelay>',
            '<tds:UploadDelay>PT0.2S</tds:UploadDelay>'
          )
        )
      }
    })
    const started = performance.now()
    expect(await device.management.uploadFirmware(firmware)).toEqual({ expectedDownTime: 'PT300S' })
    expect(performance.now() - started).toBeGreaterThanOrEqual(190)
    expect(mock.uploads.map(({ path }) => path)).toEqual(['/onvif/firmwareupgrade_service/10031372'])
  })

  it('fails at once when the upload delay is longer than the timeout and uploads nothing', async () => {
    const { mock, device } = await connect({
      overrides: { 'device.StartFirmwareUpgrade': startAnswer('http://192.0.2.12/upload', 'PT1H') }
    })
    const started = performance.now()
    const error = await rejection(() => device.management.uploadFirmware(firmware, { timeoutMs: 2_000 }))
    expect(error).toBeInstanceOf(TimeoutError)
    expect(error).toMatchObject({
      action: 'StartFirmwareUpgrade',
      message: 'Upload delay of PT1H exceeds the timeout of 2000 ms'
    })
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(mock.uploads).toEqual([])
  })

  it.each(['P1M', 'PT-5S', 'P', 'PT', '5S', ''])(
    'rejects the upload delay %j with the path and uploads nothing',
    async (delay) => {
      const { mock, device } = await connect({
        overrides: { 'device.StartFirmwareUpgrade': startAnswer('http://192.0.2.12/upload', delay) }
      })
      const error = await rejection(() => device.management.uploadFirmware(firmware))
      expect(error).toBeInstanceOf(DecodeError)
      expect(error).toMatchObject({ path: 'StartFirmwareUpgradeResponse.UploadDelay', action: 'StartFirmwareUpgrade' })
      expect(mock.uploads).toEqual([])
    }
  )

  it('reads days, hours, minutes and fractional seconds of the upload delay', async () => {
    const { device } = await connect({
      overrides: { 'device.StartFirmwareUpgrade': startAnswer('http://192.0.2.12/upload', 'P0DT0H0M0.05S') }
    })
    expect(await device.management.uploadFirmware(firmware)).toEqual({ expectedDownTime: 'PT300S' })
  })

  it('stops waiting the upload delay when aborted and uploads nothing', async () => {
    const { mock, device } = await connect({
      overrides: { 'device.StartFirmwareUpgrade': startAnswer('http://192.0.2.12/upload', 'PT5S') }
    })
    const controller = new AbortController()
    const reason = new Error('stopped')
    setTimeout(() => controller.abort(reason), 50)
    await expect(device.management.uploadFirmware(firmware, { signal: controller.signal })).rejects.toBe(reason)
    expect(mock.uploads).toEqual([])
  })

  it('reports a firmware file the device does not accept as a TransportError with the status', async () => {
    const { device } = await connect({
      upload: { status: 415 },
      overrides: { 'device.StartFirmwareUpgrade': startAnswer('http://192.0.2.12/upload', 'PT0S') }
    })
    await expect(device.management.uploadFirmware(firmware)).rejects.toMatchObject({
      name: 'TransportError',
      status: 415,
      action: 'POST'
    })
  })

  it('counts the upload delay and the upload against one timeout', async () => {
    const { device } = await connect({
      upload: { delayMs: 1_000 },
      overrides: { 'device.StartFirmwareUpgrade': startAnswer('http://192.0.2.12/upload', 'PT0.2S') }
    })
    const started = performance.now()
    const error = await rejection(() => device.management.uploadFirmware(firmware, { timeoutMs: 400 }))
    expect(error).toMatchObject({ name: 'TimeoutError', action: 'POST' })
    expect(performance.now() - started).toBeLessThan(900)
  })

  it('uploads a backup to the address HappyTime returns', async () => {
    const { mock, device } = await connect({
      overrides: { 'device.StartSystemRestore': answer(happytime('device.StartSystemRestore')) }
    })
    const backup = new TextEncoder().encode('<config/>')
    expect(await device.management.uploadBackup(backup)).toEqual({ expectedDownTime: 'PT300S' })
    expect(mock.uploads).toEqual([
      { path: '/SystemRestore', contentType: 'application/octet-stream', body: Buffer.from(backup) }
    ])
  })

  it('rejects the nil upload address of the camera before sending the backup', async () => {
    const { mock, device } = await connect()
    const error = await rejection(() => device.management.uploadBackup(new Uint8Array([1])))
    expect(error).toBeInstanceOf(OnvifError)
    expect((error as Error).message).toContain('Invalid service address')
    expect(mock.uploads).toEqual([])
    expect(mock.requests.filter(({ service }) => service === 'upload')).toEqual([])
  })

  it('sends the firmware version of a cloud upgrade and returns the down time', async () => {
    const { mock, device } = await connect({
      overrides: {
        'device.UpgradeFirmware': answer(
          happytime('device.StartSystemRestore').replace(
            /<tds:StartSystemRestoreResponse>[\s\S]*<\/tds:StartSystemRestoreResponse>/,
            '<tds:UpgradeFirmwareResponse><tds:ExpectedDownTime>PT10M</tds:ExpectedDownTime></tds:UpgradeFirmwareResponse>'
          )
        )
      }
    })
    expect(await device.management.upgradeFirmware({ version: '5.1.2' })).toEqual({ expectedDownTime: 'PT10M' })
    expect(requestOf(mock, 'UpgradeFirmware')).toEqual({ UpgradeFirmware: { Version: '5.1.2' } })
  })
})
