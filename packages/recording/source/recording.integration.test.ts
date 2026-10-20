import { Device, TimeoutError } from '@2bad/onvif'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { recording } from '#index.ts'

const hostname = process.env['ONVIF_TEST_HOST']
const username = process.env['ONVIF_TEST_USER']
const password = process.env['ONVIF_TEST_PASS']

describe.skipIf(!hostname)('recording, search and replay on a live camera', () => {
  let device: Device & ReturnType<typeof recording>

  beforeAll(async () => {
    device = (
      await Device.connect({ hostname: hostname ?? '', username: username ?? '', password: password ?? '' })
    ).use(recording)
  })

  afterAll(() => device.close())

  it('lists the recordings and finds only those with a search', async () => {
    await device.recording.getServiceCapabilities()
    await device.search.getServiceCapabilities()
    const { recordingItem = [] } = await device.recording.getRecordings()
    const { summary } = await device.search.getRecordingSummary()
    expect(summary.numberRecordings).toBe(recordingItem.length)
    const tokens = recordingItem.map(({ recordingToken }) => recordingToken)
    for await (const found of device.search.recordings({}, { timeoutMs: 20_000 })) {
      expect(tokens).toContain(found.recordingToken)
    }
  })

  it('searches the events of the last day', async (context) => {
    const startPoint = new Date(Date.now() - 86_400_000)
    try {
      for await (const found of device.search.events({ startPoint }, { timeoutMs: 20_000 })) {
        expect(found.time).toBeInstanceOf(Date)
      }
    } catch (error) {
      if (error instanceof TimeoutError) return context.skip('The camera did not complete the search')
      throw error
    }
  })

  it('returns a replay address on the configured host', async (context) => {
    const { recordingItem: [first] = [] } = await device.recording.getRecordings()
    if (!first) return context.skip('No recordings')
    const { uri } = await device.replay.uri(first.recordingToken)
    expect(uri.protocol).toBe('rtsp:')
    expect(uri.hostname).toBe(device.address.hostname)
  })

  it('sends the replay configuration back and reads the same', async () => {
    const { configuration } = await device.replay.getReplayConfiguration()
    await device.replay.setReplayConfiguration({ configuration })
    expect((await device.replay.getReplayConfiguration()).configuration).toEqual(configuration)
  })

  it('creates a recording with a track and a job and deletes them', async (context) => {
    const { capabilities } = await device.recording.getServiceCapabilities()
    if (!capabilities.dynamicRecordings) return context.skip('No dynamic recordings')
    const before = (await device.recording.getRecordings()).recordingItem ?? []
    const source = { sourceId: 'onviftest', name: 'onviftest', location: '', description: '', address: '' }
    const { recordingToken } = await device.recording.createRecording({
      recordingConfiguration: { source, content: 'onviftest', maximumRetentionTime: 'PT0S' }
    })
    const scoped = device.recording.forRecording(recordingToken)
    try {
      const { recordingConfiguration } = await scoped.getRecordingConfiguration()
      expect(recordingConfiguration.content).toBe('onviftest')
      if (capabilities.dynamicTracks) {
        const { trackToken } = await scoped.createTrack({
          trackConfiguration: { trackType: 'Video', description: 'onviftest' }
        })
        await scoped.deleteTrack({ trackToken })
      }
      const { jobToken } = await device.recording.createRecordingJob({
        jobConfiguration: { recordingToken, mode: 'Idle', priority: 0 }
      })
      try {
        expect((await device.recording.getRecordingJobState({ jobToken })).state.state).toBe('Idle')
      } finally {
        await device.recording.deleteRecordingJob({ jobToken })
      }
    } finally {
      await scoped.deleteRecording()
    }
    expect((await device.recording.getRecordings()).recordingItem ?? []).toEqual(before)
  })
})
