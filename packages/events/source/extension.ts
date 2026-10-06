import type { Device } from '@2bad/onvif'
import { EventsClient } from '#generated/events.ts'
import { Subscription } from '#subscription.ts'

/**
 * Add the event functions to a device as `device.events`, called without the device argument, with
 * `getEventProperties` and `getServiceCapabilities` of the event service.
 *
 * @param device - A connected device
 * @returns The properties to add
 * @example
 * const camera = device.use(events)
 * const subscription = await camera.events.subscribe({ onError })
 * const { topicSet } = await camera.events.getEventProperties()
 */
export const events = (device: Device) => ({
  events: Object.assign(new EventsClient(device), {
    subscribe: Subscription.open.bind(Subscription, device)
  })
})
