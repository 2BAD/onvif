import type { Device } from '@2bad/onvif'
import { DeviceIOClient } from '#generated/deviceio.ts'

/**
 * Add the device IO operations to a device as `device.io`.
 *
 * @param device - A connected device
 * @returns The properties to add
 * @example
 * const camera = device.use(io)
 * const { relayOutputs = [] } = await camera.io.getRelayOutputs()
 * for (const { token } of relayOutputs) await camera.io.setRelayOutputState({ relayOutputToken: token, logicalState: 'active' })
 */
export const io = (device: Device) => ({ io: new DeviceIOClient(device) })
