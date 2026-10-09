import { DecodeError, type Device, OnvifError } from '@2bad/onvif'
import { getVideoSourceConfigurations } from '@2bad/onvif-media'
import { isTopic, MOTION_PATH, motionFrom, type Notification } from '#notification.ts'
import { type SubscribeOptions, Subscription } from '#subscription.ts'

export type MotionState = {
  /** Token of the video source, as in `VideoSourceConfiguration.sourceToken`. */
  videoSource: string
  isMotion: boolean
  /** `true` for the state the camera reports on subscribe, rather than a change. */
  initialized: boolean
  utcTime: Date
}

const TOPICS = [
  { path: MOTION_PATH, state: 'IsMotion', source: 'VideoSourceConfigurationToken', configuration: true },
  { path: ['VideoSource', 'MotionAlarm'], state: 'State', source: 'Source', configuration: false }
] as const

const REFRESH_AFTER_MS = 60_000

/**
 * Subscribe to the motion state of each video source. Merges `RuleEngine/CellMotionDetector/Motion` and
 * `VideoSource/MotionAlarm` and yields only when the state of a video source changes. Opens its own pull point when
 * iterated, and looks up the video sources with `GetVideoSourceConfigurations` on the first motion event. Breaking
 * out of the loop closes the pull point.
 *
 * @param device - A connected device
 * @param options - Error callback, abort signal and pull settings, as for `subscribe()`
 * @yields The first state of each video source, then each change
 * @throws The errors of `subscribe()` and the errors that end the subscription. Motion events that cannot be read go
 *   to `onError`.
 */
export async function* motion(device: Device, options: SubscribeOptions): AsyncGenerator<MotionState, void, undefined> {
  const { onError } = options
  const context = { host: device.address.host, service: 'tev', action: 'PullMessages' }
  const states = new Map<string, boolean>()
  let configurations = new Map<string, string>()
  let videoSources = new Set<string>()
  let fetchedAt = -Infinity

  const lookUp = (token: string, configuration: boolean): string | undefined =>
    configuration ? configurations.get(token) : videoSources.has(token) ? token : undefined

  const videoSourceOf = async (token: string, configuration: boolean): Promise<string> => {
    let videoSource = lookUp(token, configuration)
    if (videoSource === undefined && performance.now() - fetchedAt >= REFRESH_AFTER_MS) {
      const list = await getVideoSourceConfigurations(device)
      configurations = new Map(list.map((entry) => [entry.token, entry.sourceToken]))
      videoSources = new Set(configurations.values())
      fetchedAt = performance.now()
      videoSource = lookUp(token, configuration)
    }
    if (videoSource === undefined) {
      const kind = configuration ? 'video source configuration' : 'video source'
      throw new OnvifError(`Unknown ${kind} '${token.slice(0, 32)}' in a motion event`, context)
    }
    return videoSource
  }

  const read = async (notification: Notification): Promise<MotionState | undefined> => {
    const topic = TOPICS.find(({ path }) => isTopic(notification.topic, path))
    if (!topic) return undefined
    const token = notification.source[topic.source]
    if (token === undefined) throw new DecodeError(`Missing ${topic.source}`, `Message.Source.${topic.source}`, context)
    const videoSource = await videoSourceOf(token, topic.configuration)
    if (notification.propertyOperation === 'Deleted') {
      states.delete(videoSource)
      return undefined
    }
    const { isMotion, initialized, utcTime } = motionFrom(notification, topic.state, context)
    const previous = states.get(videoSource)
    states.set(videoSource, isMotion)
    if (previous === isMotion) return undefined
    return { videoSource, isMotion, initialized: initialized && previous === undefined, utcTime }
  }

  for await (const notification of await Subscription.open(device, options)) {
    let state
    try {
      state = await read(notification)
    } catch (error) {
      if (!(error instanceof OnvifError)) throw error
      onError(error)
    }
    if (state) yield state
  }
}
