import { DecodeError, Device, OnvifError, SoapFaultError } from '@2bad/onvif'
import { decode, parseEnvelope, type XmlObject } from '@2bad/onvif/soap'
import { afterEach, describe, expect, it } from 'vitest'
import { corpus, fixture } from '../../../tools/fixtures/corpus.ts'
import {
  type ActionOverride,
  type MockCamera,
  type MockCameraOptions,
  startMockCamera
} from '../../../tools/mock-camera/server.ts'
import { Management } from '#index.ts'

const live = (name: string): string => fixture(`live/dvc/dcn-bm2220lpr/${name}.xml`).xml
const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const connect = async (options?: MockCameraOptions): Promise<{ mock: MockCamera; device: Device }> => {
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
  return { mock, device }
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
  Management.SetRelayOutputState
]

describe('generated management operations', () => {
  const fixtures = corpus.flatMap((entry) => {
    const match = /^(?:live\/.+\/device\.|upstream\/device\.)(\w+)\.xml$/.exec(entry.name)
    const operation = operations.find((candidate) => candidate.name === match?.[1])
    return operation ? [{ name: entry.name, xml: entry.xml, operation }] : []
  })
  const decodable = fixtures.filter(({ xml }) => !xml.includes('<tds:DynamicDNSInformation xsi:nil="true"/>'))

  it('cover a lab capture for every operation', () => {
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

describe('Management on the lab camera', () => {
  it('reads the network, time, user, filter and relay settings as typed values', async () => {
    const { device } = await connect()
    expect(await device.call(Management.GetNetworkDefaultGateway)).toEqual({
      networkGateway: { ipv4Address: ['192.0.2.18'] }
    })
    expect(await device.call(Management.GetUsers)).toEqual({
      user: [{ username: 'REDACTED3', userLevel: 'Administrator' }]
    })
    expect(await device.call(Management.GetZeroConfiguration)).toEqual({
      zeroConfiguration: { interfaceToken: 'eth0', enabled: true, addresses: ['192.0.2.20'] }
    })
    expect(await device.call(Management.GetIPAddressFilter)).toEqual({ ipAddressFilter: { type: 'Deny' } })
    expect(await device.call(Management.GetRelayOutputs)).toEqual({
      relayOutputs: [{ token: '0', properties: { mode: 'Monostable', delayTime: 'PT20S', idleState: 'closed' } }]
    })
  })

  it('returns the NTP server the lab camera reports with type IPv4 and a DNS name as it is', async () => {
    const { device } = await connect()
    expect(await device.call(Management.GetNTP)).toEqual({
      ntpInformation: { fromDHCP: false, ntpManual: [{ type: 'IPv4', dnsName: 'host10.example' }] }
    })
  })

  it('rejects the nil dynamic DNS information of the lab camera with the path of the element', async () => {
    const { device } = await connect()
    const error = await rejection(() => device.call(Management.GetDynamicDNS))
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
    expect(await device.call(Management.GetUsers)).toEqual({
      user: [
        { username: '007', userLevel: 'Operator' },
        { username: '1234', userLevel: 'User' }
      ]
    })
    expect(await device.call(Management.GetDynamicDNS)).toEqual({
      dynamicDNSInformation: { type: 'ClientUpdates', name: 'true', TTL: 'PT1H' }
    })
  })

  it('returns no users when the device lists none', async () => {
    const { device } = await connect({ overrides: { 'device.GetUsers': usersAnswer('') } })
    expect(await device.call(Management.GetUsers)).toEqual({})
  })

  it('returns no relays from the DCN-BF5365, which has none', async () => {
    const { device } = await connect({
      overrides: { 'device.GetRelayOutputs': answer(fixture('live/dvc/dcn-bf5365/device.GetRelayOutputs.xml').xml) }
    })
    expect(await device.call(Management.GetRelayOutputs)).toEqual({})
  })

  it('rejects the nil dynamic DNS information of the DCN-BF5365 as of the lab camera', async () => {
    const { device } = await connect({
      overrides: { 'device.GetDynamicDNS': answer(fixture('live/dvc/dcn-bf5365/device.GetDynamicDNS.xml').xml) }
    })
    await expect(device.call(Management.GetDynamicDNS)).rejects.toThrow(
      'Missing required element Type at GetDynamicDNSResponse.DynamicDNSInformation'
    )
  })

  it('keeps the empty IPv6 gateway the DRN-3282R lists', async () => {
    const { device } = await connect({
      overrides: {
        'device.GetNetworkDefaultGateway': answer(fixture('live/dvc/drn-3282r/device.GetNetworkDefaultGateway.xml').xml)
      }
    })
    expect(await device.call(Management.GetNetworkDefaultGateway)).toEqual({
      networkGateway: { ipv4Address: ['192.0.2.18'], ipv6Address: [''] }
    })
  })

  it('reads the eleven relays of the DRN-3282R with their tokens in braces', async () => {
    const { device } = await connect({
      overrides: { 'device.GetRelayOutputs': answer(fixture('live/dvc/drn-3282r/device.GetRelayOutputs.xml').xml) }
    })
    const { relayOutputs = [] } = await device.call(Management.GetRelayOutputs)
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
    const error = await rejection(() => device.call(Management.GetIPAddressFilter))
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
    await device.call(Management.CreateUsers, { user: [{ username, password, userLevel: 'User' }] })
    const users = (requestOf(mock, 'CreateUsers')['CreateUsers'] as XmlObject)['User']
    expect(users).toEqual({ Username: username, Password: password, UserLevel: 'User' })
  })

  it('creates, changes and deletes a user', async () => {
    const { mock, device } = await connect()
    const user = { username: 'operator', password: 'first', userLevel: 'Operator' }
    expect(await device.call(Management.CreateUsers, { user: [user] })).toEqual({})
    expect(await device.call(Management.SetUser, { user: [{ ...user, password: 'second' }] })).toEqual({})
    expect(await device.call(Management.DeleteUsers, { username: ['operator', 'viewer'] })).toEqual({})
    expect(requestOf(mock, 'SetUser')).toEqual({
      SetUser: { User: { Username: 'operator', Password: 'second', UserLevel: 'Operator' } }
    })
    expect(requestOf(mock, 'DeleteUsers')).toEqual({ DeleteUsers: { Username: ['operator', 'viewer'] } })
  })

  it('reports a user the device does not know as a SOAP fault with the action', async () => {
    const { device } = await connect({
      overrides: { 'device.DeleteUsers': { kind: 'status', status: 400, body: live('device.DeleteUsersMissingFault') } }
    })
    const error = await rejection(() => device.call(Management.DeleteUsers, { username: ['nobody'] }))
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
      device.call(Management.SetUser, { user: [{ username: 'viewer', password, userLevel: 'User' }] })
    )
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: ['OperationProhibited', 'PasswordTooWeak'], action: 'SetUser' })
    expect(`${String(error)} ${JSON.stringify(error)} ${(error as Error).stack ?? ''}`).not.toContain(password)
  })

  it('keeps the password out of the error when it cannot be sent', async () => {
    const { mock, device } = await connect()
    const password = 'Secret\u0000Password'
    const error = await rejection(() =>
      device.call(Management.SetUser, { user: [{ username: 'viewer', password, userLevel: 'User' }] })
    )
    expect(error).toBeInstanceOf(OnvifError)
    expect(`${String(error)} ${JSON.stringify(error)} ${(error as Error).stack ?? ''}`).not.toContain('Secret')
    expect(mock.requests.some(({ action }) => action === 'SetUser')).toBe(false)
  })

  it('sends the NTP servers with the spec element names', async () => {
    const { mock, device } = await connect()
    await device.call(Management.SetNTP, {
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
    expect(await device.call(Management.SetRelayOutputSettings, { relayOutputToken: '0', properties })).toEqual({})
    expect(
      await device.call(Management.SetRelayOutputState, { relayOutputToken: '0', logicalState: 'active' })
    ).toEqual({})
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
      device.call(Management.SetRelayOutputState, { relayOutputToken: '7', logicalState: 'active' })
    )
    expect(error).toMatchObject({ name: 'SoapFaultError', action: 'SetRelayOutputState' })
  })

  it('changes the network interface, gateway, zero configuration and dynamic DNS', async () => {
    const { mock, device } = await connect()
    expect(
      await device.call(Management.SetNetworkInterfaces, {
        interfaceToken: 'eth0',
        networkInterface: {
          enabled: true,
          MTU: 1500,
          ipv4: { enabled: true, manual: [{ address: '192.0.2.14', prefixLength: 24 }], DHCP: false }
        }
      })
    ).toEqual({ rebootNeeded: false })
    expect(await device.call(Management.SetNetworkDefaultGateway, { ipv4Address: ['192.0.2.1'] })).toEqual({})
    expect(await device.call(Management.SetZeroConfiguration, { interfaceToken: 'eth0', enabled: false })).toEqual({})
    expect(await device.call(Management.SetDynamicDNS, { type: 'NoUpdate' })).toEqual({})
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
    expect(await device.call(Management.SetIPAddressFilter, { ipAddressFilter })).toEqual({})
    expect(await device.call(Management.AddIPAddressFilter, { ipAddressFilter })).toEqual({})
    expect(await device.call(Management.RemoveIPAddressFilter, { ipAddressFilter })).toEqual({})
    expect(requestOf(mock, 'RemoveIPAddressFilter')).toEqual({
      RemoveIPAddressFilter: {
        IPAddressFilter: { Type: 'Deny', IPv4Address: { Address: '198.51.100.7', PrefixLength: '32' } }
      }
    })
  })
})
