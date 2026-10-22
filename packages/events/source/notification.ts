import { DecodeError, type ErrorContext } from '@2bad/onvif'
import { decode, namespaceInfo, prefixes, type XmlValue } from '@2bad/onvif/soap'
import {
  type ItemList,
  type Message,
  type NotificationMessageHolderType,
  type PropertyOperation,
  schema,
  type TopicExpressionType
} from '#generated/events.ts'

export const ONVIF_TOPICS = 'http://www.onvif.org/ver10/topics'

export type Topic = {
  /**
   * The expression with the prefix `tns1` for ONVIF topics, such as `tns1:RuleEngine/CellMotionDetector/Motion`,
   * whatever prefix the device used. A topic in another namespace reads as `{namespace}Name`.
   */
  expression: string
  dialect: string
  /** Namespace of the topic tree, from the prefix of the first segment; `undefined` if it is not declared. */
  namespace: string | undefined
  /** Topic names without prefixes, from the root down. */
  path: string[]
}

export type Notification = {
  /** Absent when the device leaves out the optional `wsnt:Topic`. */
  topic: Topic | undefined
  utcTime: Date
  /** `Initialized` repeats current state (on subscribe and after a synchronization point), `Changed` is a transition. */
  propertyOperation: PropertyOperation | undefined
  /** Simple items by name, values as sent. */
  source: Readonly<Record<string, string>>
  key: Readonly<Record<string, string>>
  data: Readonly<Record<string, string>>
  /** The whole decoded `tt:Message`, including element items. */
  message: Message
}

export type Motion = {
  isMotion: boolean
  /** `true` for the state the device reports on subscribe, rather than a transition. */
  initialized: boolean
  utcTime: Date
  source: Readonly<Record<string, string>>
}

export const MOTION_PATH = ['RuleEngine', 'CellMotionDetector', 'Motion']

const items = (list: ItemList | undefined): Readonly<Record<string, string>> => {
  const record = Object.create(null) as Record<string, string>
  for (const item of list?.simpleItem ?? []) record[item.name] = item.value
  return record
}

// a segment ends at a slash outside of a {namespace}
const segmentPattern = /(?:\{[^{}]*\}|[^/{])+/g
const leadPattern = /^(?:\{([^{}]*)\}|([^:{}]*):)/

const topicOf = (expression: TopicExpressionType): Topic => {
  const text = expression.value.trim()
  const declared = namespaceInfo(expression)?.namespaces ?? {}
  const segments = text.match(segmentPattern) ?? []
  const [, clark, prefix] = leadPattern.exec(segments[0] ?? '') ?? []
  const own = prefix !== undefined && Object.hasOwn(declared, prefix) ? declared[prefix] : undefined
  const namespace =
    clark ??
    (own !== undefined && prefixes[own] === prefix
      ? own
      : Object.values(declared).find((candidate) => prefix !== undefined && prefixes[candidate] === prefix))
  return {
    expression: text,
    dialect: expression.dialect,
    namespace,
    path: segments.map((segment) => segment.replace(leadPattern, ''))
  }
}

/**
 * Decode one notification of a PullMessages response.
 *
 * @param holder - A `wsnt:NotificationMessage` decoded from a response parsed with namespaces
 * @param context - Host, service and action for errors
 * @returns The notification
 * @throws {DecodeError} If the message is not a valid `tt:Message`
 */
export function decodeNotification(holder: NotificationMessageHolderType, context: ErrorContext): Notification {
  const element = holder.message.$any?.['Message']
  if (element === undefined) throw new DecodeError('Missing tt:Message in the notification', 'Message', context)
  const message = decode(schema, 'Message', element as XmlValue, context) as Message
  return {
    topic: holder.topic ? topicOf(holder.topic) : undefined,
    utcTime: message.utcTime,
    propertyOperation: message.propertyOperation,
    source: items(message.source),
    key: items(message.key),
    data: items(message.data),
    message
  }
}

/**
 * Whether a topic is the given ONVIF topic, compared by namespace and path so that any prefix the device picks works.
 *
 * @param topic - Topic of a notification
 * @param path - Topic names from the root, such as `['RuleEngine', 'CellMotionDetector', 'Motion']`
 * @param namespace - Namespace of the topic tree, the ONVIF topic namespace by default
 * @returns `true` when namespace and path match
 */
export function isTopic(topic: Topic | undefined, path: readonly string[], namespace = ONVIF_TOPICS): boolean {
  return (
    topic !== undefined &&
    topic.namespace === namespace &&
    topic.path.length === path.length &&
    topic.path.every((name, index) => name === path[index])
  )
}

export const motionFrom = (notification: Notification, name: string, context?: ErrorContext): Motion => {
  const value = notification.data[name]?.trim()
  if (value !== 'true' && value !== 'false' && value !== '1' && value !== '0') {
    throw new DecodeError(`Invalid ${name} '${(value ?? '').slice(0, 32)}'`, `Message.Data.${name}`, context)
  }
  return {
    isMotion: value === 'true' || value === '1',
    initialized: notification.propertyOperation === 'Initialized',
    utcTime: notification.utcTime,
    source: notification.source
  }
}

/**
 * Read the cell motion detector state (`tns1:RuleEngine/CellMotionDetector/Motion`) from a notification.
 *
 * @param notification - Any notification
 * @returns The motion state, or `undefined` for other topics
 * @throws {DecodeError} If `IsMotion` is missing or not an `xs:boolean`
 */
export function motionOf(notification: Notification): Motion | undefined {
  return isTopic(notification.topic, MOTION_PATH) ? motionFrom(notification, 'IsMotion') : undefined
}
