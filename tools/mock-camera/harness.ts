import { afterEach } from 'vitest'
import { Device, type ServiceAddressPolicy } from '#onvif/device.ts'
import { parseEnvelope } from '#onvif/soap/envelope.ts'
import type { XmlObject } from '#onvif/soap/parse.ts'
import { fixture } from '#tools/fixtures/corpus.ts'
import {
  type ActionOverride,
  type MockCamera,
  type MockCameraOptions,
  startMockCamera
} from '#tools/mock-camera/server.ts'

export const cam = (name: string): string => fixture(`live/dvc/dcn-bm2220lpr/${name}.xml`).xml
export const hik = (name: string): string => fixture(`live/ezviz/ds-2de2c400ig-w-w/${name}.xml`).xml
export const dahua = (name: string): string => fixture(`live/dahua/dhi-itc413-pw4d-z1/${name}.xml`).xml
export const simulator = (name: string): string => fixture(`simulator/happytimesoft/ipcamera/${name}.xml`).xml

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/**
 * Start a mock camera and connect to it. Both are closed after the test.
 *
 * @param options - Mock camera options
 * @param serviceAddresses - Service address policy of the connection
 * @returns The mock camera and the connected device
 */
export const connectMock = async (
  options?: MockCameraOptions,
  serviceAddresses?: ServiceAddressPolicy
): Promise<{ mock: MockCamera; device: Device }> => {
  const mock = await startMockCamera(options)
  cleanups.push(() => mock.close())
  const url = new URL(mock.url)
  const device = await Device.connect({
    hostname: url.hostname,
    port: Number(url.port),
    username: 'admin',
    password: 'password',
    ...(serviceAddresses ? { serviceAddresses } : {})
  })
  cleanups.push(() => device.close())
  return { mock, device }
}

export const answer = (body: string, status = 200, times?: number): ActionOverride => ({
  kind: 'status',
  status,
  body,
  ...(times === undefined ? {} : { times })
})

export const rawRequestOf = (mock: MockCamera, action: string): string =>
  mock.requests.findLast((request) => request.action === action)?.body ?? ''

export const requestOf = (mock: MockCamera, action: string): XmlObject => parseEnvelope(rawRequestOf(mock, action)).body

export const rejection = async (action: () => Promise<unknown>): Promise<unknown> => {
  try {
    await action()
  } catch (error) {
    return error
  }
  throw new Error('Expected a rejection')
}
