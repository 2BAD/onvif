import { afterAll, beforeAll, expect, test } from 'vitest'
import { Device } from '#onvif/device.ts'
import { GetDeviceInformation } from '#onvif/generated/device.ts'
import * as Management from '#onvif-management/generated/management.ts'
import { type MockCamera, startMockCamera } from '#tools/mock-camera/server.ts'

let mock: MockCamera
let device: Device

beforeAll(async () => {
  mock = await startMockCamera({ auth: 'none' })
  const url = new URL(mock.url)
  device = await Device.connect({ hostname: url.hostname, port: Number(url.port) })
})

afterAll(async () => {
  device.close()
  await mock.close()
})

test('GetDeviceInformation through a method or Device.call', async ({ bench }) => {
  const results = await bench.compare(
    bench('Device.call', async () => {
      await device.call(GetDeviceInformation)
    }),
    bench('method', async () => {
      await device.getDeviceInformation()
    })
  )
  expect(results.get('method').throughput.mean).toBeGreaterThan(results.get('Device.call').throughput.mean * 0.8)
})

test('adding the management operations to a device', async ({ bench }) => {
  const { ManagementClient } = Management
  const results = await bench.compare(
    bench('client class', () => new ManagementClient(device)),
    bench('bound function per operation', () => ({
      setNetworkInterfaces: device.call.bind(device, Management.SetNetworkInterfaces),
      getNetworkDefaultGateway: device.call.bind(device, Management.GetNetworkDefaultGateway),
      setNetworkDefaultGateway: device.call.bind(device, Management.SetNetworkDefaultGateway),
      getUsers: device.call.bind(device, Management.GetUsers),
      createUsers: device.call.bind(device, Management.CreateUsers),
      setUser: device.call.bind(device, Management.SetUser),
      deleteUsers: device.call.bind(device, Management.DeleteUsers),
      getNTP: device.call.bind(device, Management.GetNTP),
      setNTP: device.call.bind(device, Management.SetNTP),
      getDynamicDNS: device.call.bind(device, Management.GetDynamicDNS),
      setDynamicDNS: device.call.bind(device, Management.SetDynamicDNS),
      getZeroConfiguration: device.call.bind(device, Management.GetZeroConfiguration),
      setZeroConfiguration: device.call.bind(device, Management.SetZeroConfiguration),
      getIPAddressFilter: device.call.bind(device, Management.GetIPAddressFilter),
      setIPAddressFilter: device.call.bind(device, Management.SetIPAddressFilter),
      addIPAddressFilter: device.call.bind(device, Management.AddIPAddressFilter),
      removeIPAddressFilter: device.call.bind(device, Management.RemoveIPAddressFilter),
      getRelayOutputs: device.call.bind(device, Management.GetRelayOutputs),
      setRelayOutputSettings: device.call.bind(device, Management.SetRelayOutputSettings),
      setRelayOutputState: device.call.bind(device, Management.SetRelayOutputState)
    }))
  )
  expect(results.get('client class').throughput.mean).toBeGreaterThan(
    results.get('bound function per operation').throughput.mean * 5
  )
})
