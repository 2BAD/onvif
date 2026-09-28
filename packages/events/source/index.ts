import { Subscription } from '#subscription.ts'

export * as Events from '#generated/events.ts'
export {
  decodeNotification,
  isTopic,
  type Motion,
  motionOf,
  type Notification,
  ONVIF_TOPICS,
  type Topic
} from '#notification.ts'
export type { SubscribeOptions, Subscription } from '#subscription.ts'

export const subscribe = Subscription.open
