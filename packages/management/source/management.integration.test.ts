import { randomBytes } from 'node:crypto'
import { AuthError, Device, SoapFaultError } from '@2bad/onvif'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Management } from '#index.ts'

const hostname = process.env['ONVIF_TEST_HOST']
const username = process.env['ONVIF_TEST_USER']
const password = process.env['ONVIF_TEST_PASS']

describe.skipIf(!hostname)('Management on a live camera', () => {
  let device: Device

  beforeAll(async () => {
    device = await Device.connect({ hostname: hostname ?? '', username: username ?? '', password: password ?? '' })
  })

  afterAll(() => device.close())

  it('sends the NTP, gateway, zero configuration and IP filter settings back unchanged', async () => {
    const { ntpInformation } = await device.call(Management.GetNTP)
    const { networkGateway } = await device.call(Management.GetNetworkDefaultGateway)
    const { zeroConfiguration } = await device.call(Management.GetZeroConfiguration)
    const { ipAddressFilter } = await device.call(Management.GetIPAddressFilter)

    const { fromDHCP, ntpManual } = ntpInformation
    await device.call(Management.SetNTP, { fromDHCP, ...(ntpManual && { ntpManual }) })
    await device.call(Management.SetNetworkDefaultGateway, networkGateway)
    await device.call(Management.SetZeroConfiguration, {
      interfaceToken: zeroConfiguration.interfaceToken,
      enabled: zeroConfiguration.enabled
    })
    await device.call(Management.SetIPAddressFilter, { ipAddressFilter })

    expect((await device.call(Management.GetNTP)).ntpInformation).toEqual(ntpInformation)
    expect((await device.call(Management.GetNetworkDefaultGateway)).networkGateway).toEqual(networkGateway)
    expect((await device.call(Management.GetZeroConfiguration)).zeroConfiguration).toEqual(zeroConfiguration)
    expect((await device.call(Management.GetIPAddressFilter)).ipAddressFilter).toEqual(ipAddressFilter)
  })

  it('adds and removes an entry of a deny filter', async () => {
    const { ipAddressFilter } = await device.call(Management.GetIPAddressFilter)
    if (ipAddressFilter.type !== 'Deny') return
    const entry = { type: 'Deny', ipv4Address: [{ address: '198.51.100.7', prefixLength: 32 }] }
    await device.call(Management.AddIPAddressFilter, { ipAddressFilter: entry })
    try {
      const { ipAddressFilter: added } = await device.call(Management.GetIPAddressFilter)
      expect(added.ipv4Address).toContainEqual(entry.ipv4Address[0])
    } finally {
      await device.call(Management.RemoveIPAddressFilter, { ipAddressFilter: entry })
    }
    expect((await device.call(Management.GetIPAddressFilter)).ipAddressFilter).toEqual(ipAddressFilter)
  })

  it('creates a user, changes its password and deletes it', async () => {
    const user = { username: 'onviftest', password: randomBytes(12).toString('base64url'), userLevel: 'User' }
    const login = async (secret: string): Promise<void> => {
      const test = await Device.connect({ hostname: hostname ?? '', username: user.username, password: secret })
      test.close()
    }
    await device.call(Management.CreateUsers, { user: [user] })
    try {
      const { user: users = [] } = await device.call(Management.GetUsers)
      expect(users).toContainEqual({ username: 'onviftest', userLevel: 'User' })
      await login(user.password)

      const changed = randomBytes(12).toString('base64url')
      await device.call(Management.SetUser, { user: [{ ...user, password: changed }] })
      await login(changed)
      await expect(login(user.password)).rejects.toThrow(AuthError)
    } finally {
      await device.call(Management.DeleteUsers, { username: ['onviftest'] })
    }
    const { user: remaining = [] } = await device.call(Management.GetUsers)
    expect(remaining.map(({ username: name }) => name)).not.toContain('onviftest')
    await expect(device.call(Management.DeleteUsers, { username: ['onviftest'] })).rejects.toThrow(SoapFaultError)
  })

  it('switches the first relay on and off', async () => {
    const { relayOutputs = [] } = await device.call(Management.GetRelayOutputs)
    const [relay] = relayOutputs
    if (!relay) return
    await device.call(Management.SetRelayOutputSettings, {
      relayOutputToken: relay.token,
      properties: relay.properties
    })
    await device.call(Management.SetRelayOutputState, { relayOutputToken: relay.token, logicalState: 'active' })
    await device.call(Management.SetRelayOutputState, { relayOutputToken: relay.token, logicalState: 'inactive' })
    expect((await device.call(Management.GetRelayOutputs)).relayOutputs).toEqual(relayOutputs)
  })
})
