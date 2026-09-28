import { Device, type OnvifError } from '@2bad/onvif'
import { describe, expect, it } from 'vitest'
import { motionOf, type Notification, subscribe } from '#index.ts'

const hostname = process.env['ONVIF_TEST_HOST']
const username = process.env['ONVIF_TEST_USER']
const password = process.env['ONVIF_TEST_PASS']

describe.skipIf(!hostname)('Subscription on a live camera', () => {
  it('receives the initial motion state, keeps pulling and unsubscribes', async () => {
    const device = await Device.connect({
      hostname: hostname ?? '',
      username: username ?? '',
      password: password ?? ''
    })
    const errors: OnvifError[] = []
    const subscription = await subscribe(device, { onError: (error) => errors.push(error), pullTimeoutMs: 2_000 })
    try {
      const received: Notification[] = []
      for await (const notification of subscription) {
        received.push(notification)
        if (motionOf(notification)) break
      }
      const motion = received.map(motionOf).find(Boolean)
      expect(motion).toMatchObject({ initialized: true, isMotion: expect.any(Boolean) })
      expect(motion?.source['VideoSourceConfigurationToken']).toBeDefined()
      expect(errors).toEqual([])
    } finally {
      await subscription.close()
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
