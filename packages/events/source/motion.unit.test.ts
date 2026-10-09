import { join } from 'node:path'
import { DecodeError, Device, OnvifError, SoapFaultError } from '@2bad/onvif'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixture } from '../../../tools/fixtures/corpus.ts'
import { motionNotification } from '../../../tools/mock-camera/events.ts'
import { type MockCamera, type MockCameraOptions, startMockCamera } from '../../../tools/mock-camera/server.ts'
import { events, motion, type MotionState } from '#index.ts'

const EZVIZ = join(import.meta.dirname, '../../../fixtures/live/ezviz/ds-2de2c400ig-w-w')

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const start = async (options?: MockCameraOptions) => {
  const mock = await startMockCamera(options)
  cleanups.push(() => mock.close())
  const url = new URL(mock.url)
  const device = await Device.connect({
    hostname: url.hostname,
    port: Number(url.port),
    username: 'admin',
    password: 'password'
  })
  cleanups.push(() => device.close())
  const errors: OnvifError[] = []
  const states = motion(device, { onError: (error) => errors.push(error), pullTimeoutMs: 200 })
  cleanups.push(async () => {
    await states.return()
  })
  return { mock, device, errors, states }
}

const next = async (states: AsyncGenerator<MotionState>): Promise<MotionState | undefined> =>
  (await states.next()).value ?? undefined

const captured = (path: string): string[] =>
  fixture(path).xml.match(/<wsnt:NotificationMessage>[\s\S]*?<\/wsnt:NotificationMessage>/g) ?? []

const alarm = (
  state: string,
  operation = 'Changed',
  source = '<tt:SimpleItem Name="Source" Value="VideoSource_token_1"/>'
) =>
  '<wsnt:NotificationMessage><wsnt:Topic Dialect="http://www.onvif.org/ver10/tev/topicExpression/ConcreteSet">' +
  'tns1:VideoSource/MotionAlarm</wsnt:Topic><wsnt:Message>' +
  `<tt:Message UtcTime="2026-10-09T10:00:00Z" PropertyOperation="${operation}"><tt:Source>${source}</tt:Source>` +
  `<tt:Data><tt:SimpleItem Name="State" Value="${state}"/></tt:Data></tt:Message></wsnt:Message>` +
  '</wsnt:NotificationMessage>'

const lookups = (mock: MockCamera) =>
  mock.requests.filter(({ action }) => action === 'GetVideoSourceConfigurations').length

describe('motion', () => {
  it('reads the EZVIZ state on subscribe from CellMotionDetector and changes from MotionAlarm', async () => {
    const { mock, states, errors } = await start({ fixtureDirectory: EZVIZ })
    expect(await next(states)).toEqual({
      videoSource: 'VideoSource_1',
      isMotion: false,
      initialized: true,
      utcTime: new Date('2026-10-07T17:46:23Z')
    })
    for (const notification of captured('live/ezviz/ds-2de2c400ig-w-w/events.PullMessagesMotion.xml')) {
      mock.emitEvent(notification)
    }
    for (const notification of captured('live/ezviz/ds-2de2c400ig-w-w/events.PullMessagesMotionEnd.xml')) {
      mock.emitEvent(notification)
    }
    expect(await next(states)).toEqual({
      videoSource: 'VideoSource_1',
      isMotion: true,
      initialized: false,
      utcTime: new Date('2026-10-07T18:41:46Z')
    })
    expect(await next(states)).toMatchObject({ videoSource: 'VideoSource_1', isMotion: false, initialized: false })
    expect(errors).toEqual([])
    expect(lookups(mock)).toBe(1)
  })

  it('yields one state per change from a DVC camera that sends both topics', async () => {
    const { mock, states, errors } = await start()
    expect(await next(states)).toMatchObject({ videoSource: 'VideoSource_token_1', isMotion: false, initialized: true })
    for (const notification of captured('live/dvc/dcn-bm2220lpr/events.PullMessagesMotion.xml')) {
      mock.emitEvent(notification)
    }
    for (const notification of captured('live/dvc/dcn-bm2220lpr/events.PullMessagesMotionEnd.xml')) {
      mock.emitEvent(notification)
    }
    mock.emitEvent(alarm('true'))
    expect(await next(states)).toMatchObject({ isMotion: true, utcTime: new Date('2026-10-01T04:14:37.113Z') })
    expect(await next(states)).toMatchObject({ isMotion: false })
    expect(await next(states)).toMatchObject({ isMotion: true, utcTime: new Date('2026-10-09T10:00:00Z') })
    expect(errors).toEqual([])
  })

  it('skips a repeated state and reports a different one sent as Initialized as a change', async () => {
    const { mock, states } = await start()
    await next(states)
    mock.emitEvent(motionNotification(false, 'Initialized'))
    mock.emitEvent(motionNotification(true, 'Initialized'))
    expect(await next(states)).toMatchObject({ isMotion: true, initialized: false })
  })

  it('forgets a deleted state', async () => {
    const { mock, states } = await start()
    await next(states)
    mock.emitEvent(alarm('false', 'Deleted'))
    mock.emitEvent(alarm('0', 'Initialized'))
    mock.emitEvent(alarm('1'))
    expect(await next(states)).toMatchObject({ isMotion: false, initialized: true })
    expect(await next(states)).toMatchObject({ isMotion: true, initialized: false })
  })

  it('reports motion events it cannot read to onError and keeps going', async () => {
    const { mock, device, states, errors } = await start()
    await next(states)
    mock.emitEvent(alarm('active'))
    mock.emitEvent(alarm('true', 'Changed', ''))
    mock.emitEvent(alarm('true', 'Changed', '<tt:SimpleItem Name="Source" Value="VideoSource_token_9"/>'))
    mock.emitEvent(motionNotification(true).replace('Value="VideoSource_token_1"', 'Value="Other"'))
    mock.emitEvent(alarm('true'))
    expect(await next(states)).toMatchObject({ isMotion: true })
    expect(errors.map(({ message }) => message)).toEqual([
      "Invalid State 'active' at Message.Data.State",
      'Missing Source at Message.Source.Source',
      "Unknown video source 'VideoSource_token_9' in a motion event",
      "Unknown video source configuration 'Other' in a motion event"
    ])
    expect(errors[0]).toBeInstanceOf(DecodeError)
    expect(errors.every((error) => error.host === device.address.host && error.action === 'PullMessages')).toBe(true)
    expect(lookups(mock)).toBe(1)
  })

  it('looks up the video sources again for an unknown token at most once a minute', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { mock, states, errors } = await start()
    await next(states)
    const unknown = alarm('true', 'Changed', '<tt:SimpleItem Name="Source" Value="VideoSource_token_9"/>')
    mock.emitEvent(unknown)
    mock.emitEvent(alarm('true'))
    await next(states)
    now = 60_000
    mock.emitEvent(unknown)
    mock.emitEvent(unknown)
    mock.emitEvent(alarm('false'))
    await next(states)
    expect(errors).toHaveLength(3)
    expect(lookups(mock)).toBe(2)
  })

  it('reports a failed lookup and tries again on the next motion event', async () => {
    const { mock, states, errors } = await start({
      overrides: {
        'media2.GetVideoSourceConfigurations': { kind: 'status', status: 500, times: 1 },
        'media.GetVideoSourceConfigurations': { kind: 'status', status: 500, times: 1 }
      }
    })
    expect(await next(states)).toMatchObject({ isMotion: false, initialized: true })
    mock.emitEvent(alarm('true'))
    expect(await next(states)).toMatchObject({ isMotion: true, initialized: false })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(OnvifError)
    expect(lookups(mock)).toBe(3)
  })

  it('closes its pull point when the loop ends', async () => {
    const { mock, device } = await start()
    const camera = device.use(events)
    for await (const state of camera.events.motion({ onError: () => {} })) {
      expect(state).toMatchObject({ initialized: true })
      expect(mock.pullPoints()).toHaveLength(1)
      break
    }
    expect(mock.pullPoints()).toEqual([])
  })

  it('ends when the signal is aborted', async () => {
    const { mock, device } = await start()
    const controller = new AbortController()
    const states = motion(device, { onError: () => {}, signal: controller.signal })
    await states.next()
    controller.abort()
    expect(await states.next()).toEqual({ value: undefined, done: true })
    await vi.waitFor(() => expect(mock.pullPoints()).toEqual([]))
  })

  it('throws from the loop when the camera refuses the subscription', async () => {
    const { device } = await start({ events: { maxPullPoints: 0 } })
    await expect(motion(device, { onError: () => {} }).next()).rejects.toThrow(SoapFaultError)
  })
})
