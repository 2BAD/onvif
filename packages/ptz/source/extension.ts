import type { Device } from '@2bad/onvif'
import { PTZClient } from '#generated/ptz.ts'

/**
 * Add the PTZ operations to a device as `device.ptz`.
 *
 * @param device - A connected device
 * @returns The properties to add
 * @example
 * const camera = device.use(ptz)
 * await camera.ptz.continuousMove({ profileToken, velocity: { panTilt: { x: 0.5, y: 0 } }, timeout: 'PT1S' })
 */
export const ptz = (device: Device) => ({ ptz: new PTZClient(device) })
