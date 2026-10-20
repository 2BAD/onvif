import type { Device } from '@2bad/onvif'
import { AnalyticsClient } from '#generated/analytics.ts'

/**
 * Add the analytics operations to a device as `device.analytics`.
 *
 * @param device - A connected device
 * @returns The properties to add
 * @example
 * const camera = device.use(analytics)
 * const configuration = camera.analytics.forConfiguration('VideoAnalyticsToken')
 * const { rule = [] } = await configuration.getRules()
 */
export const analytics = (device: Device) => ({ analytics: new AnalyticsClient(device) })
