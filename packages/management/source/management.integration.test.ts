import { randomBytes } from 'node:crypto'
import { AuthError, Device, SoapFaultError } from '@2bad/onvif'
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
