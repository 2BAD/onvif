import type { Device } from '@2bad/onvif'
import { EventsClient } from '#generated/events.ts'
import { motion } from '#motion.ts'
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
 * for await (const state of camera.events.motion({ onError })) console.log(state.videoSource, state.isMotion)
 */
export const events = (device: Device) => ({
  events: Object.assign(new EventsClient(device), {
    subscribe: Subscription.open.bind(Subscription, device),
    motion: motion.bind(undefined, device)
  })
})
