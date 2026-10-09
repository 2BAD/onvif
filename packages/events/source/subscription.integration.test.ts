import { Device, type OnvifError } from '@2bad/onvif'
import { describe, expect, it } from 'vitest'
import { Events, events, motionOf, type Notification, subscribe } from '#index.ts'

const hostname = process.env['ONVIF_TEST_HOST']
const username = process.env['ONVIF_TEST_USER']
const password = process.env['ONVIF_TEST_PASS']

const hasMotionTopic = async (device: Device): Promise<boolean> => {
  const { topicSet } = await device.call(Events.GetEventProperties)
  const motion = ['RuleEngine', 'CellMotionDetector', 'Motion'].reduce<unknown>(
    (node, name) => (typeof node === 'object' && node !== null ? Reflect.get(node, name) : undefined),
    topicSet.$any
  )
  return motion !== undefined
}

describe.skipIf(!hostname)('Subscription on a live camera', () => {
  it('receives the initial motion state, keeps pulling and unsubscribes', async (context) => {
    const device = await Device.connect({
      hostname: hostname ?? '',
      username: username ?? '',
      password: password ?? ''
    })
    if (!(await hasMotionTopic(device))) {
      device.close()
      context.skip('The device lists no motion topic')
    }
    const errors: OnvifError[] = []
    const subscription = await subscribe(device, {
      onError: (error) => errors.push(error),
      pullTimeoutMs: 2_000,
      signal: AbortSignal.timeout(10_000)
    })
    try {
      const received: Notification[] = []
      for await (const notification of subscription) {
        received.push(notification)
        if (motionOf(notification)) break
      }
      const motion = received.map(motionOf).find(Boolean)
      const topics = received.map((notification) => notification.topic?.expression).join(', ')
      expect(
        motion,
        `No motion notification within 10 s although the device lists the motion topic. Received: ${topics}`
      ).toBeDefined()
      expect(motion).toMatchObject({ initialized: true, isMotion: expect.any(Boolean) })
      expect(motion?.source['VideoSourceConfigurationToken']).toBeDefined()
      expect(errors).toEqual([])
    } finally {
      await subscription.close()
      device.close()
    }
  })

  it('reads the motion state of a video source through device.events.motion', async () => {
    const device = await Device.connect({
      hostname: hostname ?? '',
      username: username ?? '',
      password: password ?? ''
    })
    const camera = device.use(events)
    const errors: OnvifError[] = []
    const states = camera.events.motion({
      onError: (error) => errors.push(error),
      pullTimeoutMs: 2_000,
      signal: AbortSignal.timeout(10_000)
    })
    try {
      const { value } = await states.next()
      await states.return()
      expect(value).toMatchObject({ videoSource: expect.any(String), isMotion: expect.any(Boolean), initialized: true })
      expect(errors).toEqual([])
    } finally {
      device.close()
    }
  })

  it('reads the event properties and service capabilities through device.events', async () => {
    const connected = await Device.connect({
      hostname: hostname ?? '',
      username: username ?? '',
      password: password ?? ''
    })
    const device = connected.use(events)
    try {
      const { topicNamespaceLocation, topicSet } = await device.events.getEventProperties()
      expect(topicNamespaceLocation.length).toBeGreaterThan(0)
      expect(topicSet.$any).toBeDefined()
      const { capabilities } = await device.events.getServiceCapabilities()
      expect(capabilities.maxPullPoints).toBeGreaterThan(0)
    } finally {
      device.close()
    }
  })

  it('waits for events across several long polls without errors', async () => {
    const device = await Device.connect({
      hostname: hostname ?? '',
      username: username ?? '',
      password: password ?? ''
    })
    const errors: OnvifError[] = []
    const subscription = await subscribe(device, { onError: (error) => errors.push(error), pullTimeoutMs: 1_000 })
    try {
      const deadline = performance.now() + 5_000
      while (performance.now() < deadline) {
        await Promise.race([subscription.next(), new Promise((resolve) => setTimeout(resolve, 1_500))])
      }
      expect(errors).toEqual([])
    } finally {
      await subscription.close()
      device.close()
    }
  })
})
