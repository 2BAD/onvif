import { DecodeError, Device, type OnvifError } from '@2bad/onvif'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type MockCamera, startMockCamera } from '../../../tools/mock-camera/server.ts'
import {
  decodeNotification,
  isTopic,
  motionOf,
  type Notification,
  ONVIF_TOPICS,
  subscribe,
  type Subscription
} from '#index.ts'

const CONCRETE_SET = 'http://www.onvif.org/ver10/tev/topicExpression/ConcreteSet'

let mock: MockCamera
let device: Device
let subscription: Subscription
const errors: OnvifError[] = []

beforeAll(async () => {
  mock = await startMockCamera()
  const url = new URL(mock.url)
  device = await Device.connect({
    hostname: url.hostname,
    port: Number(url.port),
    username: 'admin',
    password: 'password'
  })
  subscription = await subscribe(device, { onError: (error) => errors.push(error), pullTimeoutMs: 200 })
  for (let index = 0; index < 7; index++) await subscription.next()
})

afterAll(async () => {
  await subscription.close()
  device.close()
  await mock.close()
})

const message = (data: string, attributes = 'UtcTime="2026-09-28T04:01:39.352Z" PropertyOperation="Changed"') =>
  `<tt:Message ${attributes}><tt:Source><tt:SimpleItem Name="InputToken" Value="1"/></tt:Source>` +
  `<tt:Data>${data}</tt:Data></tt:Message>`

const receive = async (topic: string, body = message('<tt:SimpleItem Name="State" Value="true"/>')) => {
  errors.length = 0
  mock.emitEvent(`<wsnt:NotificationMessage>${topic}<wsnt:Message>${body}</wsnt:Message></wsnt:NotificationMessage>`)
  mock.emitEvent(
    '<wsnt:NotificationMessage><wsnt:Message>' +
      message('<tt:SimpleItem Name="End" Value="1"/>') +
      '</wsnt:Message></wsnt:NotificationMessage>'
  )
  const received: Notification[] = []
  for (;;) {
    const { value } = await subscription.next()
    if (!value) break
    if (value.data['End'] === '1') break
    received.push(value)
  }
  return received
}

const topic = (expression: string, attributes = `Dialect="${CONCRETE_SET}"`) =>
  `<wsnt:Topic ${attributes}>${expression}</wsnt:Topic>`

describe('notifications', () => {
  it('resolves topic prefixes to namespaces, whatever prefix the device picks', async () => {
    const [notification] = await receive(
      topic('ns9:RuleEngine/CellMotionDetector/Motion', `xmlns:ns9="${ONVIF_TOPICS}" Dialect="${CONCRETE_SET}"`),
      message('<tt:SimpleItem Name="IsMotion" Value="1"/>')
    )
    expect(notification?.topic).toEqual({
      expression: 'ns9:RuleEngine/CellMotionDetector/Motion',
      dialect: CONCRETE_SET,
      namespace: ONVIF_TOPICS,
      path: ['RuleEngine', 'CellMotionDetector', 'Motion']
    })
    expect(notification && motionOf(notification)?.isMotion).toBe(true)
  })

  it('reads Samsung topics with a prefix on every segment and junk in the dialect', async () => {
    const [notification] = await receive(
      topic(
        'tns1:Device/tns1:Trigger/tnssamsung:DigitalInput',
        `xmlns:tnssamsung="urn:samsung" Dialect="${CONCRETE_SET} xmlns:wsnt=http://docs.oasis-open.org/wsn/b-2"`
      )
    )
    expect(notification?.topic).toMatchObject({ namespace: ONVIF_TOPICS, path: ['Device', 'Trigger', 'DigitalInput'] })
    expect(isTopic(notification?.topic, ['Device', 'Trigger', 'DigitalInput'])).toBe(true)
  })

  it('leaves undeclared prefixes unresolved so they never match an ONVIF topic', async () => {
    for (const expression of ['vendor:RuleEngine/CellMotionDetector/Motion', 'constructor:A', 'RuleEngine/A']) {
      const [notification] = await receive(topic(expression), message('<tt:SimpleItem Name="IsMotion" Value="true"/>'))
      expect(notification?.topic?.namespace).toBeUndefined()
      expect(notification && motionOf(notification)).toBeUndefined()
    }
  })

  it('accepts notifications without a topic', async () => {
    const [notification] = await receive('')
    expect(notification?.topic).toBeUndefined()
    expect(notification && motionOf(notification)).toBeUndefined()
    expect(isTopic(undefined, [])).toBe(false)
  })

  it('keeps item values as sent in records without a prototype, including hostile names', async () => {
    const [notification] = await receive(
      topic('tns1:Device/Trigger/DigitalInput'),
      message('<tt:SimpleItem Name="__proto__" Value="x"/><tt:SimpleItem Name="Code" Value="00012345678901234567"/>')
    )
    expect(notification?.data['Code']).toBe('00012345678901234567')
    expect(Object.getPrototypeOf(notification?.data)).toBeNull()
    expect(Object.keys(notification?.data ?? {})).toEqual(['__proto__', 'Code'])
    expect(notification?.source).toMatchObject({ InputToken: '1' })
    expect(notification?.propertyOperation).toBe('Changed')
    expect(notification?.message.data?.simpleItem).toHaveLength(2)
  })

  it('reads a UtcTime without a zone as UTC', async () => {
    const [notification] = await receive(
      topic('tns1:Device/Trigger/DigitalInput'),
      message('<tt:SimpleItem Name="State" Value="true"/>', 'UtcTime="2026-09-28T04:01:39"')
    )
    expect(notification?.utcTime.toISOString()).toBe('2026-09-28T04:01:39.000Z')
  })

  it('reports a notification without a tt:Message', async () => {
    const received = await receive(topic('tns1:Device/Trigger/DigitalInput'), '<vendor:Payload xmlns:vendor="urn:v"/>')
    expect(received).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(DecodeError)
    expect(errors[0]?.message).toBe('Missing tt:Message in the notification at Message')
  })

  it('cannot resolve prefixes of a notification decoded without namespaces', () => {
    const notification = decodeNotification(
      {
        topic: { dialect: CONCRETE_SET, value: 'tns1:RuleEngine/CellMotionDetector/Motion' },
        message: { $any: { Message: { $: { UtcTime: '2026-09-28T04:01:39Z' } } } }
      },
      {}
    )
    expect(notification.topic).toMatchObject({
      namespace: undefined,
      path: ['RuleEngine', 'CellMotionDetector', 'Motion']
    })
  })

  it('rejects a motion notification without IsMotion', async () => {
    const [notification] = await receive(topic('tns1:RuleEngine/CellMotionDetector/Motion'))
    expect(() => notification && motionOf(notification)).toThrow("Invalid IsMotion '' at Message.Data.IsMotion")
  })

  it('rejects an IsMotion that is not an xs:boolean', async () => {
    const [notification] = await receive(
      topic('tns1:RuleEngine/CellMotionDetector/Motion'),
      message('<tt:SimpleItem Name="IsMotion" Value="yes"/>')
    )
    expect(() => notification && motionOf(notification)).toThrow("Invalid IsMotion 'yes' at Message.Data.IsMotion")
  })
})
