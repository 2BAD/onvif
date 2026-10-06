import type { Device } from '@2bad/onvif'
import { ManagementClient } from '#generated/management.ts'

/**
 * Add the device management operations to a device as `device.management`.
 *
 * @param device - A connected device
 * @returns The properties to add
 * @example
 * const camera = device.use(management)
 * const { user = [] } = await camera.management.getUsers()
 */
export const management = (device: Device) => ({ management: new ManagementClient(device) })
