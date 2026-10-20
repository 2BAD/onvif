import { DecodeError, Device, OnvifError, SoapFaultError, TransportError } from '@2bad/onvif'
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
  Management.ScanAvailableDot11Networks
]

describe('generated management operations', () => {
  const fixtures = corpus.flatMap((entry) => {
    const match = /^(?:live|simulator)\/.+\/device\.(\w+)\.xml$/.exec(entry.name)
    const operation = operations.find((candidate) => candidate.name === match?.[1])
    return operation && entry.status === 200 && !entry.fault ? [{ name: entry.name, xml: entry.xml, operation }] : []
  })
  const decodable = fixtures.filter(
    ({ xml }) => !/<tds:(?:DynamicDNSInformation|Capabilities|Status) xsi:nil="true"\/>/.test(xml)
  )

  it('cover a camera capture for every operation', () => {
    const captured = new Set(
      fixtures.filter(({ name }) => name.startsWith('live/')).map(({ operation }) => operation.name)
    )
    expect(operations.map(({ name }) => name).filter((name) => !captured.has(name))).toEqual([])
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
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(device.management))
    const expected = operations.map(({ name }) => `${name.charAt(0).toLowerCase()}${name.slice(1)}`)
    expect(methods.filter((name) => name !== 'constructor').toSorted()).toEqual(expected.toSorted())
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
