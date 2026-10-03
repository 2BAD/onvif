import type { Device } from '@2bad/onvif'
import { Subscription } from '#subscription.ts'

/**
 * Add the event functions to a device as `device.events`, called without the device argument.
 *
 * @param device - A connected device
 * @returns The properties to add
 * @example
 * const camera = device.use(events)
 * const subscription = await camera.events.subscribe({ onError })
 */
export const events = (device: Device) => ({
  events: {
    subscribe: Subscription.open.bind(Subscription, device)
  }
})
