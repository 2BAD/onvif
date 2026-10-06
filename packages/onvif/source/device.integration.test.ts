import { afterAll, describe, expect, it } from 'vitest'
import { DEVICE_NAMESPACE, Device } from '#device.ts'
import { AuthError } from '#errors.ts'
import { GetDeviceInformation, GetScopes, GetSystemDateAndTime } from '#generated/device.ts'

const hostname = process.env['ONVIF_TEST_HOST']
const username = process.env['ONVIF_TEST_USER']
const password = process.env['ONVIF_TEST_PASS']
const devices: Device[] = []

afterAll(() => {
  for (const device of devices) device.close()
})

const connect = async (secret = password ?? ''): Promise<Device> => {
  const device = await Device.connect({ hostname: hostname ?? '', username: username ?? '', password: secret })
  devices.push(device)
  return device
}

const rejection = async (action: () => Promise<unknown>): Promise<unknown> => {
  try {
    await action()
  } catch (error) {
    return error
  }
  throw new Error('Expected a rejection')
}

describe.skipIf(!hostname)('Device on a live camera', () => {
  it('connects, measures the clock and finds the services', async () => {
    const device = await connect()
    expect(device.clock.source).toBe('device')
    expect(device.services.has(DEVICE_NAMESPACE)).toBe(true)
    expect(device.services.size).toBeGreaterThan(1)
    for (const url of device.services.values()) expect(url.hostname).toBe(device.address.hostname)
  })

  it('calls authenticated operations', async () => {
    const device = await connect()
    const information = await device.call(GetDeviceInformation)
    expect(information.manufacturer).toEqual(expect.any(String))
    expect((await device.call(GetScopes)).scopes.length).toBeGreaterThan(0)
    const { systemDateAndTime } = await device.call(GetSystemDateAndTime)
    expect(systemDateAndTime.dateTimeType).toEqual(expect.any(String))
  })

  it('reads the device service through its methods', async () => {
    const device = await connect()
    expect((await device.getDeviceInformation()).manufacturer).toEqual(expect.any(String))
    expect((await device.getScopes()).scopes.length).toBeGreaterThan(0)
    expect((await device.getSystemDateAndTime()).systemDateAndTime.utcDateTime).toBeDefined()
    expect((await device.getHostname()).hostnameInformation).toBeDefined()
    expect((await device.getNetworkInterfaces()).networkInterfaces.length).toBeGreaterThan(0)
    expect((await device.getServiceCapabilities()).capabilities).toBeDefined()
    const { service } = await device.getServices({ includeCapability: false })
    expect(service.map(({ namespace }) => namespace)).toContain(DEVICE_NAMESPACE)
    expect((await device.getCapabilities({ category: ['All'] })).capabilities.device).toBeDefined()
  })

  it('rejects a wrong password with AuthError', async () => {
    const error = await rejection(async () => {
      const device = await connect(`${password ?? ''}-wrong`)
      await device.call(GetDeviceInformation)
    })
    expect(error).toBeInstanceOf(AuthError)
  })
})
