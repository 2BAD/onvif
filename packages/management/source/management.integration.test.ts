import { randomBytes } from 'node:crypto'
import { AuthError, Device, SoapFaultError, TransportError } from '@2bad/onvif'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type ManagementClient, management } from '#index.ts'

const hostname = process.env['ONVIF_TEST_HOST']
const username = process.env['ONVIF_TEST_USER']
const password = process.env['ONVIF_TEST_PASS']

const unlessNotSupported = async <T>(action: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await action()
  } catch (error) {
    if (error instanceof SoapFaultError && error.subcodes.includes('ActionNotSupported')) return undefined
    throw error
  }
}

const unlessAnswered = async <T>(action: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await action()
  } catch (error) {
    if (error instanceof SoapFaultError || error instanceof TransportError) return undefined
    throw error
  }
}

describe.skipIf(!hostname)('Management on a live camera', () => {
  let device: Device & { management: ManagementClient }

  beforeAll(async () => {
    const connected = await Device.connect({
      hostname: hostname ?? '',
      username: username ?? '',
      password: password ?? ''
    })
    device = connected.use(management)
  })

  afterAll(() => device.close())

  it('sends the NTP, gateway and zero configuration settings back unchanged', async () => {
    const { ntpInformation } = await device.management.getNTP()
    const { networkGateway } = await device.management.getNetworkDefaultGateway()
    const { zeroConfiguration } = await device.management.getZeroConfiguration()

    const { fromDHCP, ntpManual } = ntpInformation
    await device.management.setNTP({ fromDHCP, ...(ntpManual && { ntpManual }) })
    await device.management.setNetworkDefaultGateway({
      ipv4Address: (networkGateway.ipv4Address ?? []).filter((address) => address !== ''),
      ipv6Address: (networkGateway.ipv6Address ?? []).filter((address) => address !== '')
    })
    await device.management.setZeroConfiguration({
      interfaceToken: zeroConfiguration.interfaceToken,
      enabled: zeroConfiguration.enabled
    })

    expect((await device.management.getNTP()).ntpInformation).toEqual(ntpInformation)
    expect((await device.management.getNetworkDefaultGateway()).networkGateway).toEqual(networkGateway)
    expect((await device.management.getZeroConfiguration()).zeroConfiguration).toEqual(zeroConfiguration)
  })

  it('sends the DNS, hostname, protocol and discovery settings back unchanged', async () => {
    const { dnsInformation } = await device.management.getDNS()
    const { hostnameInformation } = await device.getHostname()
    const { networkProtocols = [] } = await device.management.getNetworkProtocols()
    const { discoveryMode } = await device.management.getDiscoveryMode()

    const { fromDHCP, searchDomain, dnsManual } = dnsInformation
    await device.management.setDNS({ fromDHCP, ...(searchDomain && { searchDomain }), ...(dnsManual && { dnsManual }) })
    if (!hostnameInformation.fromDHCP && hostnameInformation.name !== undefined) {
      await device.management.setHostname({ name: hostnameInformation.name })
    }
    if (networkProtocols.length > 0) await device.management.setNetworkProtocols({ networkProtocols })
    await device.management.setDiscoveryMode({ discoveryMode })

    expect((await device.management.getDNS()).dnsInformation).toEqual(dnsInformation)
    expect((await device.getHostname()).hostnameInformation).toEqual(hostnameInformation)
    expect((await device.management.getNetworkProtocols()).networkProtocols ?? []).toEqual(networkProtocols)
    expect((await device.management.getDiscoveryMode()).discoveryMode).toEqual(discoveryMode)
  })

  it('rejects an invalid hostname', async () => {
    const { hostnameInformation } = await device.getHostname()
    try {
      await expect(device.management.setHostname({ name: '-invalid_name-' })).rejects.toMatchObject({
        subcodes: expect.arrayContaining(['InvalidHostname'])
      })
    } finally {
      if (!hostnameInformation.fromDHCP && hostnameInformation.name !== undefined) {
        await device.management.setHostname({ name: hostnameInformation.name })
      }
    }
  })

  it('sends the remote discovery mode back unchanged', async (context) => {
    const remote = await unlessAnswered(() => device.management.getRemoteDiscoveryMode())
    if (!remote) return context.skip('The device does not answer GetRemoteDiscoveryMode')
    await device.management.setRemoteDiscoveryMode(remote)
    expect(await device.management.getRemoteDiscoveryMode()).toEqual(remote)
  })

  it('sends the discovery proxies back unchanged', async (context) => {
    const proxies = await unlessAnswered(() => device.management.getDPAddresses())
    if (!proxies) return context.skip('The device does not answer GetDPAddresses')
    await device.management.setDPAddresses(proxies)
    expect(await device.management.getDPAddresses()).toEqual(proxies)
  })

  it('reads the wireless capabilities where the device offers wireless configuration', async (context) => {
    const { capabilities: service } = await device.getServiceCapabilities()
    if (!service.network.dot11Configuration) return context.skip('The device has no wireless configuration')
    const { capabilities } = await device.management.getDot11Capabilities()
    expect(capabilities).toMatchObject({ scanAvailableNetworks: expect.any(Boolean) })
  })

  it('sends the date, time and time zone back and signs the next call with the device clock', async () => {
    const { systemDateAndTime } = await device.getSystemDateAndTime()
    const { dateTimeType, daylightSavings, timeZone } = systemDateAndTime
    const now = new Date(Date.now() + device.clock.skewMs)
    const utcDateTime = {
      date: { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() },
      time: { hour: now.getUTCHours(), minute: now.getUTCMinutes(), second: now.getUTCSeconds() }
    }
    await device.management.setSystemDateAndTime({
      dateTimeType,
      daylightSavings,
      ...(timeZone && { timeZone }),
      ...(dateTimeType === 'Manual' && { utcDateTime })
    })
    const { systemDateAndTime: after } = await device.getSystemDateAndTime()
    expect(after).toMatchObject({ dateTimeType, daylightSavings })
    await expect(device.management.getUsers()).resolves.toBeDefined()
  })

  it('rejects an invalid time zone', async () => {
    const { systemDateAndTime } = await device.getSystemDateAndTime()
    const { dateTimeType, daylightSavings, timeZone } = systemDateAndTime
    try {
      await expect(
        device.management.setSystemDateAndTime({ dateTimeType: 'NTP', daylightSavings, timeZone: { TZ: '!invalid' } })
      ).rejects.toMatchObject({ subcodes: expect.arrayContaining(['InvalidTimeZone']) })
    } finally {
      const { systemDateAndTime: current } = await device.getSystemDateAndTime()
      if (current.timeZone?.TZ !== timeZone?.TZ) {
        await device.management.setSystemDateAndTime({
          dateTimeType,
          daylightSavings,
          ...(timeZone && { timeZone }),
          ...(current.utcDateTime && { utcDateTime: current.utcDateTime })
        })
      }
    }
  })

  it('adds and removes a scope', async () => {
    const scope = 'onvif://www.onvif.org/onviftest'
    await device.management.addScopes({ scopeItem: [scope] })
    try {
      const { scopes } = await device.getScopes()
      expect(scopes.map(({ scopeItem }) => scopeItem)).toContain(scope)
    } finally {
      await device.management.removeScopes({ scopeItem: [scope] })
    }
    const { scopes } = await device.getScopes()
    expect(scopes.map(({ scopeItem }) => scopeItem)).not.toContain(scope)
    await expect(device.management.removeScopes({ scopeItem: [scope] })).rejects.toMatchObject({
      subcodes: expect.arrayContaining(['NoScope'])
    })
  })

  it('reads the system log and the WSDL address', async () => {
    const { systemLog } = await device.management.getSystemLog({ logType: 'System' })
    expect(typeof (systemLog.string ?? systemLog.binary?.include.href)).toBe('string')
    expect((await device.management.getWsdlUrl()).wsdlUrl).toMatch(/^https?:\/\//)
  })

  it('creates, reads and deletes a storage configuration', async (context) => {
    const data = { type: 'NFS', localPath: '/onviftest', storageUri: 'nfs://198.51.100.7/onviftest' }
    const created = await unlessAnswered(() =>
      device.management.createStorageConfiguration({ storageConfiguration: data })
    )
    if (!created?.token) return context.skip('The device does not create storage configurations')
    const { token } = created
    try {
      expect((await device.management.getStorageConfiguration({ token })).storageConfiguration).toMatchObject({
        token,
        data: { type: 'NFS', localPath: '/onviftest' }
      })
    } finally {
      await device.management.deleteStorageConfiguration({ token })
    }
    const { storageConfigurations = [] } = await device.management.getStorageConfigurations()
    expect(storageConfigurations.map((configuration) => configuration.token)).not.toContain(token)
  })

  it('sets and deletes a location', async (context) => {
    const before = await unlessAnswered(() => device.management.getGeoLocation())
    if (!before) return context.skip('The device does not implement geo location')
    const location = {
      entity: 'Device',
      token: 'onviftest',
      fixed: false,
      geoLocation: { lon: 0, lat: 0, elevation: 0 }
    }
    await device.management.setGeoLocation({ location: [location] })
    await device.management.deleteGeoLocation({ location: [location] })
    const { location: after = [] } = await device.management.getGeoLocation()
    expect(after.map(({ token }) => token)).not.toContain('onviftest')
  })

  it('sends the IP filter back unchanged', async (context) => {
    const filter = await unlessNotSupported(() => device.management.getIPAddressFilter())
    if (!filter) return context.skip('The device does not implement the IP address filter')
    await device.management.setIPAddressFilter(filter)
    expect((await device.management.getIPAddressFilter()).ipAddressFilter).toEqual(filter.ipAddressFilter)
  })

  it('adds and removes an entry of a deny filter', async (context) => {
    const filter = await unlessNotSupported(() => device.management.getIPAddressFilter())
    if (!filter) return context.skip('The device does not implement the IP address filter')
    const { ipAddressFilter } = filter
    if (ipAddressFilter.type !== 'Deny') return
    const entry = { type: 'Deny', ipv4Address: [{ address: '198.51.100.7', prefixLength: 32 }] }
    await device.management.addIPAddressFilter({ ipAddressFilter: entry })
    try {
      const { ipAddressFilter: added } = await device.management.getIPAddressFilter()
      expect(added.ipv4Address).toContainEqual(entry.ipv4Address[0])
    } finally {
      await device.management.removeIPAddressFilter({ ipAddressFilter: entry })
    }
    expect((await device.management.getIPAddressFilter()).ipAddressFilter).toEqual(ipAddressFilter)
  })

  it('creates a user, changes its password and deletes it', async () => {
    const user = { username: 'onviftest', password: randomBytes(12).toString('base64url'), userLevel: 'User' }
    const login = async (secret: string): Promise<void> => {
      const test = await Device.connect({ hostname: hostname ?? '', username: user.username, password: secret })
      test.close()
    }
    await device.management.createUsers({ user: [user] })
    try {
      const { user: users = [] } = await device.management.getUsers()
      expect(users).toContainEqual({ username: 'onviftest', userLevel: 'User' })
      await login(user.password)

      const changed = randomBytes(12).toString('base64url')
      await device.management.setUser({ user: [{ ...user, password: changed }] })
      await login(changed)
      await expect(login(user.password)).rejects.toThrow(AuthError)
    } finally {
      await device.management.deleteUsers({ username: ['onviftest'] })
    }
    const { user: remaining = [] } = await device.management.getUsers()
    expect(remaining.map(({ username: name }) => name)).not.toContain('onviftest')
    await expect(device.management.deleteUsers({ username: ['onviftest'] })).rejects.toThrow(SoapFaultError)
  })

  it('switches the first relay on and off', async () => {
    const { relayOutputs = [] } = await device.management.getRelayOutputs()
    const [relay] = relayOutputs
    if (!relay) return
    await device.management.setRelayOutputSettings({
      relayOutputToken: relay.token,
      properties: relay.properties
    })
    await device.management.setRelayOutputState({ relayOutputToken: relay.token, logicalState: 'active' })
    await device.management.setRelayOutputState({ relayOutputToken: relay.token, logicalState: 'inactive' })
    expect((await device.management.getRelayOutputs()).relayOutputs).toEqual(relayOutputs)
  })
})
