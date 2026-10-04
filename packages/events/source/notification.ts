import { DecodeError, type ErrorContext } from '@2bad/onvif'
import { decode, namespaceInfo, type XmlValue } from '@2bad/onvif/soap'
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
  /** The expression as the device sent it, such as `tns1:RuleEngine/CellMotionDetector/Motion`. */
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

const MOTION_PATH = ['RuleEngine', 'CellMotionDetector', 'Motion']

const items = (list: ItemList | undefined): Readonly<Record<string, string>> => {
  const record = Object.create(null) as Record<string, string>
  for (const item of list?.simpleItem ?? []) record[item.name] = item.value
  return record
}

const topicOf = (expression: TopicExpressionType): Topic => {
  const text = expression.value.trim()
  const namespaces = namespaceInfo(expression)?.namespaces ?? {}
  const colon = text.indexOf(':')
  const slash = text.indexOf('/')
  const prefix = colon > 0 && (slash === -1 || colon < slash) ? text.slice(0, colon) : undefined
  return {
    expression: text,
    dialect: expression.dialect,
    namespace: prefix !== undefined && Object.hasOwn(namespaces, prefix) ? namespaces[prefix] : undefined,
    path: text.split('/').map((segment) => segment.slice(segment.indexOf(':') + 1))
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

/**
 * Read the cell motion detector state (`tns1:RuleEngine/CellMotionDetector/Motion`) from a notification.
 *
 * @param notification - Any notification
 * @returns The motion state, or `undefined` for other topics
 * @throws {DecodeError} If `IsMotion` is missing or not an `xs:boolean`
 */
export function motionOf(notification: Notification): Motion | undefined {
  if (!isTopic(notification.topic, MOTION_PATH)) return undefined
  const value = notification.data['IsMotion']?.trim()
  if (value !== 'true' && value !== 'false' && value !== '1' && value !== '0') {
    throw new DecodeError(`Invalid IsMotion '${(value ?? '').slice(0, 32)}'`, 'Message.Data.IsMotion')
  }
  return {
    isMotion: value === 'true' || value === '1',
    initialized: notification.propertyOperation === 'Initialized',
    utcTime: notification.utcTime,
    source: notification.source
  }
}
