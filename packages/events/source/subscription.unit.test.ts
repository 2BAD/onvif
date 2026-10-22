import { AuthError, Device, OnvifError, SoapFaultError } from '@2bad/onvif'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixture } from '../../../tools/fixtures/corpus.ts'
import { motionNotification } from '../../../tools/mock-camera/events.ts'
import { rejection } from '../../../tools/mock-camera/harness.ts'
import {
  type ActionOverride,
  type MockCamera,
  type MockCameraOptions,
  startMockCamera
} from '../../../tools/mock-camera/server.ts'
import { events, motionOf, type Notification, subscribe, type SubscribeOptions, type Subscription } from '#index.ts'

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const camera = async (options?: MockCameraOptions): Promise<MockCamera> => {
  const mock = await startMockCamera(options)
  cleanups.push(() => mock.close())
  return mock
}

const connect = async (mock: MockCamera, serviceAddresses?: 'rewrite' | 'reject'): Promise<Device> => {
  const url = new URL(mock.url)
  const device = await Device.connect({
    hostname: url.hostname,
    port: Number(url.port),
    username: 'admin',
    password: 'password',
    ...(serviceAddresses ? { serviceAddresses } : {})
  })
  cleanups.push(() => device.close())
  return device
}

const open = async (
  device: Device,
  options: Partial<SubscribeOptions> = {}
): Promise<{ subscription: Subscription; errors: OnvifError[] }> => {
  const errors: OnvifError[] = []
  const subscription = await subscribe(device, {
    onError: (error) => errors.push(error),
    pullTimeoutMs: 200,
    ...options
  })
  cleanups.push(() => subscription.close())
  return { subscription, errors }
}

const take = async (subscription: Subscription, count: number): Promise<Notification[]> => {
  const notifications: Notification[] = []
  while (notifications.length < count) {
    const { value, done } = await subscription.next()
    if (done) break
    notifications.push(value)
  }
  return notifications
}

const requests = (mock: MockCamera, action: string) => mock.requests.filter((request) => request.action === action)

const refused: ActionOverride = {
  kind: 'status',
  status: 400,
  body:
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><s:Fault><s:Code><s:Value>s:Sender' +
    '</s:Value><s:Subcode><s:Value>ter:NotAuthorized</s:Value></s:Subcode></s:Code><s:Reason>' +
    '<s:Text xml:lang="en">Sender not Authorized</s:Text></s:Reason></s:Fault></s:Body></s:Envelope>'
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('subscribe', () => {
  it('delivers the initial property events, then changes, with the motion state', async () => {
    const mock = await camera({ requireAddressing: true })
    const { subscription, errors } = await open(await connect(mock))
    const initial = await take(subscription, 7)
    const motion = initial.map(motionOf).find(Boolean)
    expect(motion).toMatchObject({ isMotion: false, initialized: true, source: { Rule: 'MotionDetectorRule' } })

    setTimeout(() => mock.emitEvent(motionNotification(true)), 50)
    const [changed] = await take(subscription, 1)
    expect(changed && motionOf(changed)).toMatchObject({ isMotion: true, initialized: false })
    expect(errors).toEqual([])

    const pull = requests(mock, 'PullMessages')[0]
    expect(pull?.body).toContain(`s:mustUnderstand="1">${subscription.address}</wsa:To>`)
    expect(pull?.body).toContain('>http://www.onvif.org/ver10/events/wsdl/PullPointSubscription/PullMessagesRequest<')
    expect(pull?.body).toMatch(/<tev:Timeout>PT1S<\/tev:Timeout><tev:MessageLimit>100<\/tev:MessageLimit>/)
    const create = requests(mock, 'CreatePullPointSubscription')[0]
    expect(create?.body).toContain('<tev:InitialTerminationTime>PT60S</tev:InitialTerminationTime>')
  })

  it('pulls as many times as the message limit needs and serializes concurrent next() calls', async () => {
    const mock = await camera()
    const { subscription } = await open(await connect(mock), { messageLimit: 2 })
    const results = await Promise.all(Array.from({ length: 7 }, () => subscription.next()))
    const topics = results.map(({ value }) => (value as Notification).topic?.expression)
    expect(new Set(topics).size).toBe(7)
    expect(requests(mock, 'PullMessages')).toHaveLength(4)
  })

  it('echoes Axis reference parameters on every call to the pull point', async () => {
    const mock = await camera({ events: { referenceParameters: true } })
    const { subscription, errors } = await open(await connect(mock))
    expect(await take(subscription, 7)).toHaveLength(7)
    await subscription.close()
    expect(errors).toEqual([])
    for (const request of [...requests(mock, 'PullMessages'), ...requests(mock, 'Unsubscribe')]) {
      expect(request.body).toContain('wsa:IsReferenceParameter="true" xmlns:rp0="http://www.axis.com/2009/event">1<')
    }
    expect(mock.pullPoints()).toEqual([])
  })

  it('follows a hostless subscription address and sends it unchanged in wsa:To (RaySharp)', async () => {
    const mock = await camera({ events: { hostlessAddress: true } })
    const { subscription } = await open(await connect(mock))
    expect(await take(subscription, 1)).toHaveLength(1)
    expect(requests(mock, 'PullMessages')[0]?.body).toContain('>http:///onvif/event/subsription_1</wsa:To>')
  })

  it('rewrites a subscription address behind NAT but keeps the issued one in wsa:To', async () => {
    const mock = await camera({ advertisedHost: '10.0.0.9:80' })
    const { subscription } = await open(await connect(mock))
    expect(await take(subscription, 1)).toHaveLength(1)
    expect(requests(mock, 'PullMessages')[0]?.body).toContain('>http://10.0.0.9:80/onvif/event/subsription_1</wsa:To>')
  })

  it('refuses a subscription address on another host under the reject policy', async () => {
    const mock = await camera({ advertisedHost: '10.0.0.9:80' })
    const device = await connect(mock, 'reject')
    await expect(subscribe(device, { onError: () => {} })).rejects.toThrow(
      /is unavailable: Service address .* is not the configured origin/
    )
  })

  it('renews before the pull point expires when pulls do not extend it (Axis, gSOAP)', async () => {
    const mock = await camera({ events: { terminationMs: 1_500, extendOnPull: false } })
    const { subscription, errors } = await open(await connect(mock), { terminationMs: 1_500 })
    await take(subscription, 7)
    const pending = subscription.next()
    await wait(3_000)
    await subscription.close()
    expect(await pending).toEqual({ value: undefined, done: true })
    expect(errors).toEqual([])
    expect(requests(mock, 'Renew').length).toBeGreaterThan(0)
    expect(requests(mock, 'Renew')[0]?.body).toContain('<wsnt:TerminationTime>PT2S</wsnt:TerminationTime>')
    expect(requests(mock, 'CreatePullPointSubscription')).toHaveLength(1)
  })

  it('keeps pulling when a Renew fails on the connection', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const mock = await camera({
      events: { terminationMs: 5_000, extendOnPull: false },
      overrides: { 'events.Renew': { kind: 'destroy' } }
    })
    const { subscription, errors } = await open(await connect(mock), { terminationMs: 5_000 })
    await take(subscription, 7)
    const pending = subscription.next()
    await wait(700)
    await subscription.close()
    await pending
    expect(errors[0]?.name).toBe('TransportError')
    expect(requests(mock, 'CreatePullPointSubscription')).toHaveLength(1)
    expect(requests(mock, 'PullMessages')).toHaveLength(2)
  })

  it('uses the measured clock when a RenewResponse has no CurrentTime', async () => {
    const mock = await camera({
      clockSkewMs: 7_200_000,
      events: { terminationMs: 1_500, extendOnPull: false, renewCurrentTime: false }
    })
    const { subscription, errors } = await open(await connect(mock), { terminationMs: 1_500 })
    await take(subscription, 7)
    const pending = subscription.next()
    await wait(3_000)
    await subscription.close()
    await pending
    expect(errors).toEqual([])
    expect(requests(mock, 'Renew').length).toBeGreaterThan(1)
    expect(requests(mock, 'CreatePullPointSubscription')).toHaveLength(1)
  })

  it('rebuilds after a response that is not XML and re-pulls after one that does not match the schema', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const invalid =
      '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><PullMessagesResponse ' +
      'xmlns="http://www.onvif.org/ver10/events/wsdl"/></s:Body></s:Envelope>'
    for (const [body, name, creates] of [
      ['<html', 'ParseError', 2],
      [invalid, 'DecodeError', 1]
    ] as const) {
      const mock = await camera({ overrides: { 'events.PullMessages': { kind: 'status', status: 200, body } } })
      const { subscription, errors } = await open(await connect(mock))
      const pending = subscription.next()
      await wait(700)
      await subscription.close()
      await pending
      expect(errors[0]?.name).toBe(name)
      expect(requests(mock, 'CreatePullPointSubscription')).toHaveLength(creates)
    }
  })

  it('reports a failed Unsubscribe', async () => {
    const mock = await camera({ overrides: { 'events.Unsubscribe': { kind: 'status', status: 500 } } })
    const { subscription, errors } = await open(await connect(mock))
    await subscription.close()
    expect(errors.map((error) => error.name)).toEqual(['SoapFaultError'])
  })

  it('rebuilds the pull point when it expires and Renew is not supported', async () => {
    const mock = await camera({ events: { terminationMs: 300, extendOnPull: false, renew: false } })
    const { subscription, errors } = await open(await connect(mock), { terminationMs: 300 })
    await take(subscription, 7)
    const again = await take(subscription, 7)
    expect(again.every((notification) => notification.propertyOperation === 'Initialized')).toBe(true)
    expect(
      errors.some((error) => error instanceof SoapFaultError && error.subcodes.includes('ActionNotSupported'))
    ).toBe(true)
    expect(
      errors.some((error) => error instanceof SoapFaultError && error.subcodes.includes('ResourceUnknownFault'))
    ).toBe(true)
    const renewCalls = requests(mock, 'Renew').filter((request) => request.headers['content-type']?.includes('action='))
    expect(renewCalls).toHaveLength(1)
    expect(requests(mock, 'CreatePullPointSubscription').length).toBeGreaterThanOrEqual(2)
  })

  it('rebuilds right away after a reboot dropped the pull point', async () => {
    const mock = await camera()
    const { subscription, errors } = await open(await connect(mock))
    await take(subscription, 7)
    mock.expirePullPoints()
    const started = performance.now()
    expect(await take(subscription, 7)).toHaveLength(7)
    expect(performance.now() - started).toBeLessThan(900)
    expect(errors).toHaveLength(1)
  })

  it('keeps pulling after the connection of a waiting pull is reset, without repeating a WS-Security nonce', async () => {
    const mock = await camera()
    const { subscription, errors } = await open(await connect(mock), { pullTimeoutMs: 5_000 })
    await take(subscription, 7)
    const pending = take(subscription, 1)
    await vi.waitFor(() => expect(requests(mock, 'PullMessages')).toHaveLength(2))
    mock.resetConnections()
    await vi.waitFor(() => expect(requests(mock, 'PullMessages')).toHaveLength(3))
    mock.emitEvent(motionNotification(true))
    const [changed] = await pending
    expect(changed && motionOf(changed)).toMatchObject({ isMotion: true })
    expect(errors).toEqual([])
    const nonces = mock.requests.flatMap((request) => /<wsse:Nonce[^>]*>([^<]+)</.exec(request.body)?.[1] ?? [])
    expect(new Set(nonces).size).toBe(nonces.length)
  })

  it('backs off exponentially when every pull faults and never leaves pull points behind (Reolink)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const mock = await camera({ overrides: { 'events.PullMessages': { kind: 'status', status: 500 } } })
    const { subscription, errors } = await open(await connect(mock))
    const pending = subscription.next()
    await wait(1_200)
    expect(requests(mock, 'CreatePullPointSubscription')).toHaveLength(2)
    expect(requests(mock, 'Unsubscribe')).toHaveLength(2)
    expect(mock.pullPoints().length).toBeLessThanOrEqual(1)
    expect(errors.every((error) => error instanceof SoapFaultError)).toBe(true)
    await subscription.close()
    expect(await pending).toEqual({ value: undefined, done: true })
  })

  it('keeps backing off while the device refuses every new pull point after a failed pull (Reolink lockout)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const overrides: Record<string, ActionOverride> = {}
    const mock = await camera({ overrides })
    const { subscription, errors } = await open(await connect(mock))
    overrides['events.PullMessages'] = { kind: 'status', status: 500 }
    overrides['events.CreatePullPointSubscription'] = {
      kind: 'status',
      status: 500,
      body:
        '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><s:Fault><s:Code><s:Value>s:Receiver' +
        '</s:Value></s:Code><s:Reason><s:Text xml:lang="en">The device is locked because of entering wrong ' +
        'username/password many times. Please try it after 5 minutes!</s:Text></s:Reason></s:Fault></s:Body>' +
        '</s:Envelope>'
    }
    const pending = subscription.next()
    await wait(2_000)
    expect(requests(mock, 'CreatePullPointSubscription')).toHaveLength(3)
    expect(mock.pullPoints()).toEqual([])
    expect(errors.map((error) => error.name)).toEqual(['SoapFaultError', 'SoapFaultError', 'SoapFaultError'])
    await subscription.close()
    expect(await pending).toEqual({ value: undefined, done: true })
  })

  it('re-pulls without rebuilding after a reset and shortens the pull when resets repeat (TP-Link)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const mock = await camera({ overrides: { 'events.PullMessages': { kind: 'destroy' } } })
    const { subscription, errors } = await open(await connect(mock), { pullTimeoutMs: 4_000 })
    const pending = subscription.next()
    await wait(1_700)
    await subscription.close()
    await pending
    const timeouts = requests(mock, 'PullMessages').map((request) => /<tev:Timeout>([^<]+)</.exec(request.body)?.[1])
    expect(timeouts[0]).toBe('PT4S')
    expect(timeouts.at(-1)).toBe('PT2S')
    expect(errors.filter((error) => error.name === 'TransportError').length).toBeGreaterThanOrEqual(2)
    expect(requests(mock, 'CreatePullPointSubscription')).toHaveLength(1)
    expect(errors.map((error) => error.name)).toContain('TransportError')
  })

  it('raises a shortened pull timeout again after 10 minutes without a reset (TP-Link)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const overrides: Record<string, ActionOverride> = { 'events.PullMessages': { kind: 'destroy' } }
    const mock = await camera({ auth: 'none', overrides })
    const { subscription, errors } = await open(await connect(mock), { pullTimeoutMs: 4_000 })
    const timeouts = () =>
      requests(mock, 'PullMessages').map((request) => /<tev:Timeout>([^<]+)</.exec(request.body)?.[1])
    const first = subscription.next()
    await vi.waitFor(() => expect(errors).toHaveLength(2), { timeout: 3_000 })
    delete overrides['events.PullMessages']
    await first
    const shortened = timeouts().length
    expect(timeouts().at(-1)).toBe('PT2S')

    const tenMinutes = 10 * 60_000
    const now = performance.now.bind(performance)
    vi.spyOn(performance, 'now').mockImplementation(() => now() + tenMinutes)
    mock.setClockSkew(-tenMinutes)
    await take(subscription, 6)
    mock.emitEvent(motionNotification(true))
    await take(subscription, 1)
    mock.emitEvent(motionNotification(false))
    await take(subscription, 1)
    expect(timeouts().slice(shortened)).toEqual(['PT2S', 'PT4S'])
  })

  it('reports a message that cannot be decoded and still delivers the others', async () => {
    const mock = await camera()
    const { subscription, errors } = await open(await connect(mock))
    await take(subscription, 7)
    mock.emitEvent(motionNotification(true).replace(/ UtcTime="[^"]+"/, ''))
    mock.emitEvent(motionNotification(false))
    const [next] = await take(subscription, 1)
    expect(next && motionOf(next)?.isMotion).toBe(false)
    expect(errors.map((error) => error.message)).toEqual(['Missing required attribute UtcTime at Message'])
  })

  it('rebuilds the pull point once when a working subscription is refused, then ends when it is refused again', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const overrides: Record<string, ActionOverride> = { 'events.PullMessages': refused }
    const mock = await camera({ overrides })
    const { subscription, errors } = await open(await connect(mock))
    await expect(subscription.next()).rejects.toThrow(AuthError)
    expect(await subscription.next()).toEqual({ value: undefined, done: true })
    expect(requests(mock, 'CreatePullPointSubscription')).toHaveLength(2)
    expect(requests(mock, 'Unsubscribe')).toHaveLength(2)
    expect(errors.map((error) => error.name)).toEqual(['AuthError'])
  })

  it('keeps delivering after the device refuses the credentials once', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const overrides: Record<string, ActionOverride> = { 'events.PullMessages': refused }
    const mock = await camera({ overrides })
    const { subscription, errors } = await open(await connect(mock), {
      onError: (error) => {
        errors.push(error)
        delete overrides['events.PullMessages']
      }
    })
    expect(await take(subscription, 7)).toHaveLength(7)
    expect(errors.map((error) => error.name)).toEqual(['AuthError'])
    expect(requests(mock, 'CreatePullPointSubscription')).toHaveLength(2)
    expect(mock.pullPoints()).toHaveLength(1)
  })

  it('ends when the rebuild after a refused pull is refused too', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const overrides: Record<string, ActionOverride> = { 'events.PullMessages': refused }
    const mock = await camera({ overrides })
    const { subscription, errors } = await open(await connect(mock), {
      onError: (error) => {
        errors.push(error)
        overrides['events.CreatePullPointSubscription'] = refused
      }
    })
    await expect(subscription.next()).rejects.toThrow(AuthError)
    expect(await subscription.next()).toEqual({ value: undefined, done: true })
    expect(requests(mock, 'CreatePullPointSubscription')).toHaveLength(2)
    expect(errors.map((error) => error.name)).toEqual(['AuthError'])
  })

  it('reports a full device to the caller of subscribe', async () => {
    const mock = await camera({ events: { maxPullPoints: 1 } })
    const device = await connect(mock)
    const { subscription } = await open(device)
    await expect(open(device)).rejects.toThrow(SoapFaultError)
    await subscription.close()
    await expect(open(device)).resolves.toBeDefined()
  })
})

describe('close', () => {
  it('unsubscribes once, aborts a waiting pull and ends the iteration', async () => {
    const mock = await camera()
    const { subscription } = await open(await connect(mock), { pullTimeoutMs: 5_000 })
    await take(subscription, 7)
    const pending = subscription.next()
    await wait(50)
    const started = performance.now()
    await Promise.all([subscription.close(), subscription.close()])
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(await pending).toEqual({ value: undefined, done: true })
    expect(await subscription.next()).toEqual({ value: undefined, done: true })
    expect(requests(mock, 'Unsubscribe')).toHaveLength(1)
    expect(mock.pullPoints()).toEqual([])
  })

  it('unsubscribes when the loop is left with break and when the signal aborts', async () => {
    const mock = await camera()
    const device = await connect(mock)
    const { subscription } = await open(device)
    for await (const notification of subscription) {
      expect(notification).toBeDefined()
      break
    }
    expect(mock.pullPoints()).toEqual([])

    const controller = new AbortController()
    const { subscription: second } = await open(device, { signal: controller.signal })
    await take(second, 1)
    controller.abort()
    await second.close()
    expect(mock.pullPoints()).toEqual([])
    await expect(open(device, { signal: AbortSignal.abort() })).rejects.toThrow('This operation was aborted')
  })

  it('throws an error from outside the library from the iteration', async () => {
    const mock = await camera()
    const device = await connect(mock)
    const { subscription, errors } = await open(device)
    const call = device.call.bind(device)
    const failure = new TypeError('another copy of @2bad/onvif')
    vi.spyOn(device, 'call').mockImplementation((operation, ...rest) =>
      operation.name === 'PullMessages' ? Promise.reject(failure) : call(operation, ...rest)
    )
    await expect(subscription.next()).rejects.toBe(failure)
    expect(errors).toEqual([])
  })

  it('closes a subscription whose signal aborted while it was created', async () => {
    const mock = await camera()
    const device = await connect(mock)
    const controller = new AbortController()
    const call = device.call.bind(device)
    vi.spyOn(device, 'call').mockImplementation(async (operation, ...rest) => {
      const response = await call(operation, ...rest)
      if (operation.name === 'CreatePullPointSubscription') controller.abort()
      return response
    })
    const { subscription } = await open(device, { signal: controller.signal })
    expect(mock.pullPoints()).toEqual([])
    expect(await subscription.next()).toEqual({ value: undefined, done: true })
  })

  it('stops a pull point rebuild at once when closed', async () => {
    const overrides: Record<string, ActionOverride> = {}
    const mock = await camera({ overrides })
    const { subscription } = await open(await connect(mock))
    await take(subscription, 7)
    overrides['events.CreatePullPointSubscription'] = { kind: 'hang' }
    mock.expirePullPoints()
    const pending = subscription.next()
    await vi.waitFor(() => expect(requests(mock, 'CreatePullPointSubscription')).toHaveLength(2))
    const started = performance.now()
    await subscription.close()
    expect(performance.now() - started).toBeLessThan(500)
    expect(await pending).toEqual({ value: undefined, done: true })
  })

  it('reports a failed Unsubscribe after the signal aborts', async () => {
    const mock = await camera({ overrides: { 'events.Unsubscribe': { kind: 'status', status: 500 } } })
    const controller = new AbortController()
    const { subscription, errors } = await open(await connect(mock), { signal: controller.signal })
    await take(subscription, 1)
    controller.abort()
    await vi.waitFor(() => expect(errors.map((error) => error.name)).toEqual(['SoapFaultError']))
    expect(await subscription.next()).toEqual({ value: undefined, done: true })
  })

  it('reports an Unsubscribe that fails with an error from outside the library after the signal aborts', async () => {
    const mock = await camera()
    const device = await connect(mock)
    const controller = new AbortController()
    const { subscription, errors } = await open(device, { signal: controller.signal })
    await take(subscription, 1)
    const call = device.call.bind(device)
    const failure = new TypeError('another copy of @2bad/onvif')
    vi.spyOn(device, 'call').mockImplementation((operation, ...rest) =>
      operation.name === 'Unsubscribe' ? Promise.reject(failure) : call(operation, ...rest)
    )
    controller.abort()
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(errors[0]).toBeInstanceOf(OnvifError)
    expect(errors[0]).toMatchObject({ service: 'wsnt', action: 'Unsubscribe', cause: failure })
    await expect(subscription.close()).resolves.toBeUndefined()
  })

  it('stops a backoff wait at once', async () => {
    const mock = await camera({ overrides: { 'events.PullMessages': { kind: 'status', status: 500 } } })
    const { subscription } = await open(await connect(mock))
    const pending = subscription.next()
    await wait(100)
    const started = performance.now()
    await subscription.close()
    expect(performance.now() - started).toBeLessThan(500)
    expect(await pending).toEqual({ value: undefined, done: true })
  })

  it('closes with await using', async () => {
    const mock = await camera()
    const device = await connect(mock)
    {
      await using subscription = await subscribe(device, { onError: () => {}, pullTimeoutMs: 200 })
      await take(subscription, 1)
    }
    expect(mock.pullPoints()).toEqual([])
  })
})

describe('events', () => {
  it('adds subscribe to the device without the device argument', async () => {
    const mock = await camera()
    const device = (await connect(mock)).use(events)
    const errors: OnvifError[] = []
    const subscription = await device.events.subscribe({ onError: (error) => errors.push(error), pullTimeoutMs: 200 })
    cleanups.push(() => subscription.close())
    expect(await take(subscription, 7)).toHaveLength(7)
    expect(errors).toEqual([])
  })

  it('adds the event properties and service capabilities of the event service', async () => {
    const mock = await camera()
    const device = (await connect(mock)).use(events)
    const { topicNamespaceLocation, topicSet } = await device.events.getEventProperties()
    expect(topicNamespaceLocation).toEqual(['http://www.onvif.org/onvif/ver10/topics/topicns.xml'])
    expect(topicSet).toBeDefined()
    const { capabilities } = await device.events.getServiceCapabilities()
    expect(capabilities).toMatchObject({
      maxPullPoints: 10,
      maxNotificationProducers: 20,
      persistentNotificationStorage: false
    })
    expect(mock.requests.filter(({ service }) => service === 'events').map(({ action }) => action)).toEqual([
      'GetEventProperties',
      'GetServiceCapabilities'
    ])
  })
})

describe('durations', () => {
  it('sends a shortened pull timeout in whole seconds (DS-2DE2C400IG-W-W)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const mock = await camera({ overrides: { 'events.PullMessages': { kind: 'destroy' } } })
    const { subscription } = await open(await connect(mock), { pullTimeoutMs: 3_000, terminationMs: 90_500 })
    const pending = subscription.next()
    await wait(1_700)
    await subscription.close()
    await pending
    const timeouts = requests(mock, 'PullMessages').map((request) => /<tev:Timeout>([^<]+)</.exec(request.body)?.[1])
    expect(timeouts.every((timeout) => /^PT\d+S$/.test(timeout ?? ''))).toBe(true)
    expect(timeouts.at(-1)).toBe('PT2S')
    expect(requests(mock, 'CreatePullPointSubscription')[0]?.body).toContain(
      '<tev:InitialTerminationTime>PT91S</tev:InitialTerminationTime>'
    )
  })
})

describe('topics', () => {
  const filterOf = (body: string | undefined) => {
    const prefix = /xmlns:(\w+)="http:\/\/www\.onvif\.org\/ver10\/topics"/.exec(body ?? '')?.[1] ?? ''
    const expression = /<(?:\w+:)?TopicExpression\b([^>]*)>([^<]*)</.exec(body ?? '')
    return { prefix, attributes: expression?.[1] ?? '', text: expression?.[2] }
  }

  it('sends the topics as one ConcreteSet expression with their namespace declared', async () => {
    const mock = await camera()
    const topics = ['tns1:RuleEngine/CellMotionDetector/Motion', 'tns1:VideoSource/MotionAlarm']
    await open(await connect(mock), { topics })
    const { prefix, attributes, text } = filterOf(requests(mock, 'CreatePullPointSubscription')[0]?.body)
    expect(attributes).toContain('Dialect="http://www.onvif.org/ver10/tev/topicExpression/ConcreteSet"')
    expect(text).toBe(`${prefix}:RuleEngine/CellMotionDetector/Motion|${prefix}:VideoSource/MotionAlarm`)
  })

  it('declares the namespace of a {namespace} topic', async () => {
    const mock = await camera()
    await open(await connect(mock), { topics: ['{http://acme.example/topics}Door//.'] })
    const body = requests(mock, 'CreatePullPointSubscription')[0]?.body ?? ''
    const prefix = /xmlns:(\w+)="http:\/\/acme\.example\/topics"/.exec(body)?.[1]
    expect(filterOf(body).text).toBe(`${prefix}:Door//.`)
  })

  it('sends the filter again when it rebuilds the pull point', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const mock = await camera({ overrides: { 'events.PullMessages': { kind: 'status', status: 500, times: 1 } } })
    const { subscription } = await open(await connect(mock), { topics: ['tns1:VideoSource/MotionAlarm'] })
    const pending = subscription.next()
    await vi.waitFor(() => expect(requests(mock, 'CreatePullPointSubscription')).toHaveLength(2), { timeout: 2_000 })
    await subscription.close()
    await pending
    const [first, second] = requests(mock, 'CreatePullPointSubscription').map(({ body }) => filterOf(body).text)
    expect(first).toMatch(/^\w+:VideoSource\/MotionAlarm$/)
    expect(second).toBe(first)
  })

  it('sends no filter without topics', async () => {
    const mock = await camera()
    await open(await connect(mock), { topics: [] })
    expect(requests(mock, 'CreatePullPointSubscription')[0]?.body).not.toContain('Filter')
  })

  it('rejects a topic with an unknown prefix before sending', async () => {
    const mock = await camera()
    await expect(open(await connect(mock), { topics: ['acme:Door/Forced'] })).rejects.toThrow(
      'Unknown prefix acme at CreatePullPointSubscription.filter.topicExpression[0].value'
    )
    expect(requests(mock, 'CreatePullPointSubscription')).toHaveLength(0)
  })

  it('throws the fault of a device that does not know a topic (DCN-BM2220LPR)', async () => {
    const mock = await camera({
      overrides: {
        'events.CreatePullPointSubscription': {
          kind: 'status',
          status: 500,
          body: fixture('live/dvc/dcn-bm2220lpr/events.CreatePullPointSubscriptionUnknownTopic.xml').xml
        }
      }
    })
    const device = await connect(mock)
    const error = await rejection(() => open(device, { topics: ['tns1:onviftest/Missing'] }))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({
      subcodes: ['InvalidArgVal', 'InvalidTopicExpressionFault'],
      action: 'CreatePullPointSubscription'
    })
  })
})

describe('setSynchronizationPoint()', () => {
  it('makes a waiting pull return the current state again', async () => {
    const mock = await camera()
    const { subscription, errors } = await open(await connect(mock), { pullTimeoutMs: 5_000 })
    await take(subscription, 7)
    const pending = subscription.next()
    await vi.waitFor(() => expect(requests(mock, 'PullMessages')).toHaveLength(2))
    const started = performance.now()
    await subscription.setSynchronizationPoint()
    const { value } = await pending
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(value?.propertyOperation).toBe('Initialized')
    expect(await take(subscription, 6)).toHaveLength(6)
    const [request] = requests(mock, 'SetSynchronizationPoint')
    expect(request?.body).toContain(`s:mustUnderstand="1">${subscription.address}</wsa:To>`)
    expect(request?.body).toContain(
      '>http://www.onvif.org/ver10/events/wsdl/PullPointSubscription/SetSynchronizationPointRequest<'
    )
    expect(errors).toEqual([])
  })

  it('does nothing while the pull point is rebuilt', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const mock = await camera({ overrides: { 'events.PullMessages': { kind: 'status', status: 500, times: 1 } } })
    const { subscription, errors } = await open(await connect(mock))
    const pending = subscription.next()
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    await vi.waitFor(() => expect(subscription.address).toBeUndefined())
    await subscription.setSynchronizationPoint()
    expect(requests(mock, 'SetSynchronizationPoint')).toHaveLength(0)
    await subscription.close()
    await pending
  })

  it('throws a fault of the device', async () => {
    const mock = await camera({ overrides: { 'events.SetSynchronizationPoint': { kind: 'status', status: 500 } } })
    const { subscription, errors } = await open(await connect(mock))
    const error = await rejection(() => subscription.setSynchronizationPoint())
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ action: 'SetSynchronizationPoint' })
    expect(errors).toEqual([])
  })

  it('throws once the subscription is closed', async () => {
    const mock = await camera()
    const { subscription } = await open(await connect(mock))
    await subscription.close()
    const error = await rejection(() => subscription.setSynchronizationPoint())
    expect(error).toBeInstanceOf(OnvifError)
    expect(error).toMatchObject({ message: 'The subscription is closed', action: 'SetSynchronizationPoint' })
    expect(requests(mock, 'SetSynchronizationPoint')).toHaveLength(0)
  })

  it('stops waiting when its signal aborts', async () => {
    const mock = await camera({ overrides: { 'events.SetSynchronizationPoint': { kind: 'hang' } } })
    const { subscription } = await open(await connect(mock))
    const error = await rejection(() => subscription.setSynchronizationPoint({ signal: AbortSignal.timeout(100) }))
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toMatch(/Abort|Timeout/)
  })
})

describe('pull limits', () => {
  const faultWith = (detail: string): ActionOverride => ({
    kind: 'status',
    status: 400,
    times: 1,
    body:
      '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tev="http://www.onvif.org/ver10/events/wsdl">' +
      '<s:Body><s:Fault><s:Code><s:Value>s:Receiver</s:Value></s:Code><s:Reason><s:Text xml:lang="en">Limits' +
      `</s:Text></s:Reason><s:Detail><tev:PullMessagesFaultResponse>${detail}</tev:PullMessagesFaultResponse>` +
      '</s:Detail></s:Fault></s:Body></s:Envelope>'
  })

  it('pulls again with the limits of a PullMessagesFaultResponse without rebuilding', async () => {
    const mock = await camera({ events: { pullLimits: { maxTimeout: 'PT2S', maxMessageLimit: 5 } } })
    const { subscription, errors } = await open(await connect(mock), { pullTimeoutMs: 4_000 })
    expect(await take(subscription, 7)).toHaveLength(7)
    expect(errors.map((error) => error.name)).toEqual(['SoapFaultError'])
    const pulls = requests(mock, 'PullMessages').map(({ body }) => [
      /<tev:Timeout>([^<]+)</.exec(body)?.[1],
      /<tev:MessageLimit>([^<]+)</.exec(body)?.[1]
    ])
    expect(pulls.slice(0, 3)).toEqual([
      ['PT4S', '100'],
      ['PT2S', '5'],
      ['PT2S', '5']
    ])
    expect(requests(mock, 'CreatePullPointSubscription')).toHaveLength(1)
    expect(requests(mock, 'Unsubscribe')).toHaveLength(0)
  })

  it('rebuilds as for any fault when the limits are not lower', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fault = faultWith('<tev:MaxTimeout>PT1M</tev:MaxTimeout><tev:MaxMessageLimit>1000</tev:MaxMessageLimit>')
    const mock = await camera({ overrides: { 'events.PullMessages': fault } })
    const { subscription, errors } = await open(await connect(mock))
    expect(await take(subscription, 7)).toHaveLength(7)
    expect(errors.map((error) => error.name)).toEqual(['SoapFaultError'])
    expect(requests(mock, 'CreatePullPointSubscription')).toHaveLength(2)
    expect(requests(mock, 'PullMessages')[1]?.body).toContain('<tev:MessageLimit>100</tev:MessageLimit>')
  })

  it('reports limits that do not match the schema and rebuilds', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fault = faultWith('<tev:MaxTimeout>PT1S</tev:MaxTimeout><tev:MaxMessageLimit>many</tev:MaxMessageLimit>')
    const mock = await camera({ overrides: { 'events.PullMessages': fault } })
    const { subscription, errors } = await open(await connect(mock))
    expect(await take(subscription, 7)).toHaveLength(7)
    expect(errors.map((error) => error.name)).toEqual(['DecodeError', 'SoapFaultError'])
    expect(requests(mock, 'CreatePullPointSubscription')).toHaveLength(2)
  })

  it('ignores a MaxTimeout that is not a duration and keeps the pull timeout', async () => {
    const fault = faultWith('<tev:MaxTimeout>soon</tev:MaxTimeout><tev:MaxMessageLimit>10</tev:MaxMessageLimit>')
    const mock = await camera({ overrides: { 'events.PullMessages': fault } })
    const { subscription } = await open(await connect(mock), { pullTimeoutMs: 3_000 })
    expect(await take(subscription, 7)).toHaveLength(7)
    expect(requests(mock, 'PullMessages')[1]?.body).toMatch(
      /<tev:Timeout>PT3S<\/tev:Timeout><tev:MessageLimit>10<\/tev:MessageLimit>/
    )
  })
})
