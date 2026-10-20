import { OnvifError, SoapFaultError, TimeoutError } from '@2bad/onvif'
import { parseEnvelope, type XmlObject } from '@2bad/onvif/soap'
import { describe, expect, it } from 'vitest'
import { capturesOf, decodeCapture, operationsOf } from '../../../tools/fixtures/corpus.ts'
import {
  answer,
  cam,
  connectMock,
  hik,
  rawRequestOf,
  rejection,
  simulator
} from '../../../tools/mock-camera/harness.ts'
import { type MockCamera, type MockCameraOptions } from '../../../tools/mock-camera/server.ts'
import { Recording, recording, Replay, Search } from '#index.ts'

const connect = async (options?: MockCameraOptions, serviceAddresses?: 'rewrite' | 'reject') => {
  const { mock, device } = await connectMock(options, serviceAddresses)
  return { mock, device: device.use(recording) }
}

const requestsOf = (mock: MockCamera, action: string): XmlObject[] =>
  mock.requests.filter((request) => request.action === action).map(({ body }) => parseEnvelope(body).body)

const actionsOf = (mock: MockCamera, service: string): string[] =>
  mock.requests.filter((request) => request.service === service).map(({ action }) => action)

const services = { recording: Recording, search: Search, replay: Replay }

const methodName = (name: string): string => `${name.charAt(0).toLowerCase()}${name.slice(1)}`

// a page of the HappyTime recording search with the search still running
const searchingPage = simulator('search.GetRecordingSearchResults').replace(
  '<tt:SearchState>Completed</tt:SearchState>',
  '<tt:SearchState>Searching</tt:SearchState>'
)
const completedPage = simulator('search.GetRecordingSearchResults')
const searchToken = /<tse:SearchToken>([^<]+)</.exec(cam('search.FindRecordings'))?.[1] ?? ''
const queuedState = cam('search.GetSearchState').replace('>Completed<', '>Queued<')

describe('generated recording, search and replay operations', () => {
  const fixtures = Object.entries(services).flatMap(([service, module]) =>
    capturesOf(service, operationsOf(module)).map((capture) => ({ ...capture, service }))
  )

  it.each(Object.entries(services))('cover a capture for every %s operation', (service, module) => {
    const captured = new Set(
      fixtures.filter((entry) => entry.service === service).map(({ operation }) => operation.name)
    )
    expect(
      operationsOf(module)
        .map(({ name }) => name)
        .filter((name) => !captured.has(name))
    ).toEqual([])
  })

  it('cover a camera capture for every read but GetMediaAttributes', () => {
    const captured = new Set(
      fixtures
        .filter(({ name }) => name.startsWith('live/'))
        .map(({ service, operation }) => `${service}.${operation.name}`)
    )
    const reads = Object.entries(services).flatMap(([service, module]) =>
      operationsOf(module)
        .map(({ name }) => `${service}.${name}`)
        .filter((name) => /\.Get/.test(name))
    )
    expect(reads.filter((name) => !captured.has(name))).toEqual(['search.GetMediaAttributes'])
  })

  it.each(fixtures.map((entry) => [entry.name, entry] as const))('decode %s', (_name, capture) => {
    expect(() => decodeCapture(capture)).not.toThrow()
  })
})

describe('recording', () => {
  it('adds the recording, search and replay operations to the device', async () => {
    const { device } = await connect()
    const methods = (client: object) =>
      Object.getOwnPropertyNames(Object.getPrototypeOf(client)).filter((name) => name !== 'constructor')
    expect(methods(device.recording).toSorted()).toEqual(
      [...operationsOf(Recording).map(({ name }) => methodName(name)), 'forRecording'].toSorted()
    )
    expect(methods(device.search).toSorted()).toEqual(
      operationsOf(Search)
        .map(({ name }) => methodName(name))
        .toSorted()
    )
    expect(methods(device.replay).toSorted()).toEqual(
      operationsOf(Replay)
        .map(({ name }) => methodName(name))
        .toSorted()
    )
    expect(typeof device.search.recordings).toBe('function')
    expect(typeof device.search.events).toBe('function')
    expect(typeof device.replay.uri).toBe('function')
  })

  it('sends each operation from its method to its service', async () => {
    const { mock, device } = await connect()
    const time = new Date(0)
    const recordingConfiguration = {
      source: { sourceId: 's', name: 'n', location: '', description: '', address: '' },
      content: 'c',
      maximumRetentionTime: 'PT0S'
    }
    const jobConfiguration = { recordingToken: 'r', mode: 'Idle', priority: 0 }
    const trackConfiguration = { trackType: 'Video', description: 'd' }
    const calls: Record<string, () => Promise<unknown>> = {
      'recording.GetServiceCapabilities': () => device.recording.getServiceCapabilities(),
      'recording.GetRecordings': () => device.recording.getRecordings(),
      'recording.CreateRecording': () => device.recording.createRecording({ recordingConfiguration }),
      'recording.DeleteRecording': () => device.recording.deleteRecording({ recordingToken: 'r' }),
      'recording.GetRecordingConfiguration': () => device.recording.getRecordingConfiguration({ recordingToken: 'r' }),
      'recording.SetRecordingConfiguration': () =>
        device.recording.setRecordingConfiguration({ recordingToken: 'r', recordingConfiguration }),
      'recording.GetRecordingOptions': () => device.recording.getRecordingOptions({ recordingToken: 'r' }),
      'recording.CreateTrack': () => device.recording.createTrack({ recordingToken: 'r', trackConfiguration }),
      'recording.DeleteTrack': () => device.recording.deleteTrack({ recordingToken: 'r', trackToken: 't' }),
      'recording.GetTrackConfiguration': () =>
        device.recording.getTrackConfiguration({ recordingToken: 'r', trackToken: 't' }),
      'recording.SetTrackConfiguration': () =>
        device.recording.setTrackConfiguration({ recordingToken: 'r', trackToken: 't', trackConfiguration }),
      'recording.GetRecordingJobs': () => device.recording.getRecordingJobs(),
      'recording.CreateRecordingJob': () => device.recording.createRecordingJob({ jobConfiguration }),
      'recording.DeleteRecordingJob': () => device.recording.deleteRecordingJob({ jobToken: 'j' }),
      'recording.GetRecordingJobConfiguration': () => device.recording.getRecordingJobConfiguration({ jobToken: 'j' }),
      'recording.SetRecordingJobConfiguration': () =>
        device.recording.setRecordingJobConfiguration({ jobToken: 'j', jobConfiguration }),
      'recording.SetRecordingJobMode': () => device.recording.setRecordingJobMode({ jobToken: 'j', mode: 'Idle' }),
      'recording.GetRecordingJobState': () => device.recording.getRecordingJobState({ jobToken: 'j' }),
      'search.GetServiceCapabilities': () => device.search.getServiceCapabilities(),
      'search.GetRecordingSummary': () => device.search.getRecordingSummary(),
      'search.GetRecordingInformation': () => device.search.getRecordingInformation({ recordingToken: 'r' }),
      'search.GetMediaAttributes': () => device.search.getMediaAttributes({ recordingTokens: ['r'], time }),
      'search.FindRecordings': () => device.search.findRecordings({ scope: {}, keepAliveTime: 'PT10S' }),
      'search.GetRecordingSearchResults': () => device.search.getRecordingSearchResults({ searchToken: 's' }),
      'search.FindEvents': () =>
        device.search.findEvents({
          startPoint: time,
          scope: {},
          searchFilter: {},
          includeStartState: false,
          keepAliveTime: 'PT10S'
        }),
      'search.GetEventSearchResults': () => device.search.getEventSearchResults({ searchToken: 's' }),
      'search.GetSearchState': () => device.search.getSearchState({ searchToken: 's' }),
      'search.EndSearch': () => device.search.endSearch({ searchToken: 's' }),
      'replay.GetServiceCapabilities': () => device.replay.getServiceCapabilities(),
      'replay.GetReplayUri': () =>
        device.replay.getReplayUri({
          streamSetup: { stream: 'RTP-Unicast', transport: { protocol: 'RTSP' } },
          recordingToken: 'r'
        }),
      'replay.GetReplayConfiguration': () => device.replay.getReplayConfiguration(),
      'replay.SetReplayConfiguration': () =>
        device.replay.setReplayConfiguration({ configuration: { sessionTimeout: 'PT60S' } })
    }
    const every = Object.entries(services).flatMap(([service, module]) =>
      operationsOf(module).map(({ name }) => `${service}.${name}`)
    )
    expect(Object.keys(calls).toSorted()).toEqual(every.toSorted())
    for (const call of Object.values(calls)) await Promise.allSettled([call()])
    const sent = new Set(mock.requests.map(({ service, action }) => `${service}.${action}`))
    expect(every.filter((name) => !sent.has(name))).toEqual([])
  })

  it('sends the recording token with every forRecording() method', async () => {
    const { mock, device } = await connect({
      overrides: {
        'recording.DeleteRecording': answer(simulator('recording.DeleteRecording')),
        'recording.SetRecordingConfiguration': answer(simulator('recording.SetRecordingConfiguration')),
        'recording.CreateTrack': answer(simulator('recording.CreateTrack')),
        'recording.DeleteTrack': answer(simulator('recording.DeleteTrack')),
        'recording.SetTrackConfiguration': answer(simulator('recording.SetTrackConfiguration'))
      }
    })
    const scoped = device.recording.forRecording('0')
    const { recordingConfiguration } = await scoped.getRecordingConfiguration()
    await scoped.setRecordingConfiguration({ recordingConfiguration })
    await scoped.getRecordingOptions()
    const trackConfiguration = { trackType: 'Video', description: 'onviftest' }
    const { trackToken } = await scoped.createTrack({ trackConfiguration })
    await scoped.getTrackConfiguration({ trackToken })
    await scoped.setTrackConfiguration({ trackToken, trackConfiguration })
    await scoped.deleteTrack({ trackToken })
    await scoped.deleteRecording()
    const scopedActions = actionsOf(mock, 'recording').filter((action) => action !== 'GetServiceCapabilities')
    for (const action of scopedActions) {
      expect(requestsOf(mock, action)[0]?.[action]).toMatchObject({ RecordingToken: '0' })
    }
    expect(scopedActions).toHaveLength(8)
  })

  it('reads a recording job and its state with the mode the camera reports', async () => {
    const { device } = await connect()
    const { jobItem = [] } = await device.recording.getRecordingJobs()
    const [job] = jobItem
    expect(job?.jobConfiguration).toMatchObject({ recordingToken: 'tokenRecording1', mode: 'idle', priority: 0 })
    const { state } = await device.recording.getRecordingJobState({ jobToken: job?.jobToken ?? '' })
    expect(state.state).toBe('idle')
  })

  it('reports a recording that does not exist as a SOAP fault with its subcodes', async () => {
    const { device } = await connect({
      overrides: {
        'recording.GetRecordingConfiguration': answer(cam('recording.GetRecordingConfigurationMissingFault'), 400)
      }
    })
    const error = await rejection(() => device.recording.getRecordingConfiguration({ recordingToken: 'missing' }))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: ['InvalidArgVal', 'NoRecording'], service: 'trc' })
  })
})

describe('search.recordings()', () => {
  it('reads the results of a completed search and ends the search', async () => {
    const { mock, device } = await connect({
      overrides: { 'search.GetRecordingSearchResults': answer(completedPage) }
    })
    const found = await Array.fromAsync(device.search.recordings())
    expect(found.map(({ recordingToken }) => recordingToken)).toEqual(['RecordingToken_1'])
    expect(actionsOf(mock, 'search')).toEqual(['FindRecordings', 'GetRecordingSearchResults', 'EndSearch'])
    expect(requestsOf(mock, 'EndSearch')).toEqual([{ EndSearch: { SearchToken: searchToken } }])
  })

  it('reads the next page while the search runs', async () => {
    const { mock, device } = await connect({
      overrides: {
        'search.GetRecordingSearchResults': answer(searchingPage, 200, 1),
        'search.GetSearchState': answer(queuedState, 200, 1)
      }
    })
    const found = await Array.fromAsync(device.search.recordings())
    expect(found.map(({ recordingToken }) => recordingToken)).toEqual(['RecordingToken_1'])
    expect(actionsOf(mock, 'search')).toEqual([
      'FindRecordings',
      'GetRecordingSearchResults',
      'GetRecordingSearchResults',
      'GetSearchState',
      'GetRecordingSearchResults',
      'GetSearchState',
      'GetRecordingSearchResults',
      'EndSearch'
    ])
  })

  it('ends a search whose pages stay queued once GetSearchState reports it completed (DCN-BM2220LPR)', async () => {
    const { mock, device } = await connect()
    expect(await Array.fromAsync(device.search.recordings())).toEqual([])
    expect(actionsOf(mock, 'search')).toEqual([
      'FindRecordings',
      'GetRecordingSearchResults',
      'GetSearchState',
      'GetRecordingSearchResults',
      'EndSearch'
    ])
  })

  it('sends the scope, the most results and the keep alive time', async () => {
    const { mock, device } = await connect()
    const scope = { includedRecordings: ['0'], recordingInformationFilter: 'boolean(//Track[TrackType = "Video"])' }
    await Array.fromAsync(device.search.recordings({ scope, maxMatches: 5 }, { pageSize: 2, keepAliveTime: 'PT30S' }))
    expect(requestsOf(mock, 'FindRecordings')).toEqual([
      {
        FindRecordings: {
          Scope: { IncludedRecordings: '0', RecordingInformationFilter: 'boolean(//Track[TrackType = "Video"])' },
          MaxMatches: '5',
          KeepAliveTime: 'PT30S'
        }
      }
    ])
    expect(requestsOf(mock, 'GetRecordingSearchResults')[0]).toEqual({
      GetRecordingSearchResults: { SearchToken: searchToken, MinResults: '1', MaxResults: '2', WaitTime: 'PT1S' }
    })
    await Array.fromAsync(device.search.recordings())
    expect(requestsOf(mock, 'FindRecordings')[1]).toEqual({ FindRecordings: { Scope: '', KeepAliveTime: 'PT60S' } })
  })

  it.each([
    [1_200, 'PT10S'],
    [20_000, 'PT20S'],
    [90_500, 'PT91S']
  ])('keeps a search of %i ms open for %s by default', async (timeoutMs, keepAliveTime) => {
    const { mock, device } = await connect({
      overrides: { 'search.GetRecordingSearchResults': answer(completedPage) }
    })
    await Array.fromAsync(device.search.recordings({}, { timeoutMs }))
    expect(requestsOf(mock, 'FindRecordings')[0]).toMatchObject({ FindRecordings: { KeepAliveTime: keepAliveTime } })
  })

  it('reads empty recording and track times as absent (Hikvision)', async () => {
    const { device } = await connect({
      overrides: { 'search.GetRecordingSearchResults': answer(hik('search.GetRecordingSearchResults')) }
    })
    const [found] = await Array.fromAsync(device.search.recordings())
    expect(found).toMatchObject({ recordingToken: 'OnvifRecordingToken_1', content: 'RecordContent' })
    expect(found?.earliestRecording).toBeUndefined()
    expect(found?.latestRecording).toBeUndefined()
    expect(found?.track?.map(({ trackToken, dataFrom, dataTo }) => [trackToken, dataFrom, dataTo])[0]).toEqual([
      'videotracktoken_1',
      undefined,
      undefined
    ])
  })

  it('ends the search when the loop stops early', async () => {
    const { mock, device } = await connect({
      overrides: { 'search.GetRecordingSearchResults': answer(searchingPage) }
    })
    for await (const found of device.search.recordings()) {
      expect(found.recordingToken).toBe('RecordingToken_1')
      break
    }
    expect(actionsOf(mock, 'search')).toEqual(['FindRecordings', 'GetRecordingSearchResults', 'EndSearch'])
  })

  it('stops a search that never completes at the deadline and ends it', async () => {
    const { mock, device } = await connect({ overrides: { 'search.GetSearchState': answer(queuedState) } })
    const error = await rejection(() => Array.fromAsync(device.search.recordings({}, { timeoutMs: 1_200 })))
    expect(error).toBeInstanceOf(TimeoutError)
    expect(error).toMatchObject({ service: 'tse', message: 'The search did not complete within 1200 ms' })
    const pages = requestsOf(mock, 'GetRecordingSearchResults').length
    expect(pages).toBeGreaterThan(1)
    expect(pages).toBeLessThanOrEqual(4)
    expect(actionsOf(mock, 'search').at(-1)).toBe('EndSearch')
  })

  it('stops at the deadline when it passes during the pause between pages', async () => {
    const { mock, device } = await connect({ overrides: { 'search.GetSearchState': answer(queuedState) } })
    const error = await rejection(() => Array.fromAsync(device.search.recordings({}, { timeoutMs: 250 })))
    expect(error).toBeInstanceOf(TimeoutError)
    expect(error).toMatchObject({ action: 'GetRecordingSearchResults' })
    expect(actionsOf(mock, 'search').at(-1)).toBe('EndSearch')
  })

  it('ends the search when it is aborted', async () => {
    const { mock, device } = await connect({
      overrides: { 'search.GetRecordingSearchResults': answer(searchingPage) }
    })
    const controller = new AbortController()
    const error = await rejection(async () => {
      for await (const found of device.search.recordings({}, { signal: controller.signal })) {
        expect(found.recordingToken).toBe('RecordingToken_1')
        controller.abort()
      }
    })
    expect(error).toBeInstanceOf(Error)
    expect(actionsOf(mock, 'search').at(-1)).toBe('EndSearch')
  })

  it('reports a search token the device rejects and still ends the search', async () => {
    const { mock, device } = await connect({
      overrides: {
        'search.GetRecordingSearchResults': answer(hik('search.GetRecordingSearchResultsMissingFault'), 500),
        'search.EndSearch': answer(hik('search.GetRecordingSearchResultsMissingFault'), 500)
      }
    })
    const error = await rejection(() => Array.fromAsync(device.search.recordings()))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: ['InvalidArgVal', 'InavlidToken'], action: 'GetRecordingSearchResults' })
    expect(actionsOf(mock, 'search').at(-1)).toBe('EndSearch')
  })

  it('reports an EndSearch that fails after the search completed', async () => {
    const { device } = await connect({
      overrides: {
        'search.GetRecordingSearchResults': answer(completedPage),
        'search.EndSearch': answer(cam('search.GetRecordingSearchResultsMissingFault'), 400)
      }
    })
    const error = await rejection(() => Array.fromAsync(device.search.recordings()))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: ['InvalidArgVal', 'InvalidToken'], action: 'EndSearch' })
  })
})

describe('search.events()', () => {
  const happyTimeEvents = { 'search.GetEventSearchResults': answer(simulator('search.GetEventSearchResults')) }

  it('reads the recorded events with their topic, message and track', async () => {
    const { device } = await connect({ overrides: happyTimeEvents })
    const found = await Array.fromAsync(device.search.events({ startPoint: new Date('2026-10-19T00:00:00Z') }))
    const [first, second] = found
    expect(first).toMatchObject({
      recordingToken: 'RecordingToken_1',
      trackToken: '',
      time: new Date('2026-10-19T13:15:34Z'),
      startStateEvent: false
    })
    expect(first?.event.topic?.value).toBe('tns1:RecordingHistory/Recording/State')
    expect(first?.event.message.message).toMatchObject({
      propertyOperation: 'Changed',
      source: { simpleItem: [{ name: 'RecordingToken', value: 'RecordingToken_1' }] },
      data: { simpleItem: [{ name: 'IsRecording', value: 'true' }] }
    })
    expect(second).toMatchObject({ trackToken: 'TrackToken_1' })
  })

  it('sends the time range in UTC and the topic filter with its namespace declared', async () => {
    const { mock, device } = await connect({ overrides: happyTimeEvents })
    const topicExpression = [
      { dialect: 'http://www.onvif.org/ver10/tev/topicExpression/ConcreteSet', value: 'tns1:RecordingHistory//.' }
    ]
    await Array.fromAsync(
      device.search.events({
        startPoint: new Date('2026-10-20T12:00:00+02:00'),
        endPoint: new Date('2026-10-19T10:00:00Z'),
        scope: { includedRecordings: ['RecordingToken_1'] },
        searchFilter: { topicExpression },
        includeStartState: true,
        maxMatches: 50
      })
    )
    const raw = rawRequestOf(mock, 'FindEvents')
    expect(raw).toContain(
      '<tse:StartPoint>2026-10-20T10:00:00.000Z</tse:StartPoint><tse:EndPoint>2026-10-19T10:00:00.000Z</tse:EndPoint>'
    )
    expect(raw).toContain('>tns1:RecordingHistory//.</wsnt:TopicExpression>')
    expect(raw).toContain('xmlns:tns1="http://www.onvif.org/ver10/topics"')
    expect(requestsOf(mock, 'FindEvents')[0]).toMatchObject({
      FindEvents: { IncludeStartState: 'true', MaxMatches: '50', KeepAliveTime: 'PT60S' }
    })
  })

  it('leaves out the end point and an empty filter when not given', async () => {
    const { mock, device } = await connect({ overrides: happyTimeEvents })
    await Array.fromAsync(device.search.events({ startPoint: new Date('2026-10-19T00:00:00Z') }))
    expect(requestsOf(mock, 'FindEvents')).toEqual([
      {
        FindEvents: {
          StartPoint: '2026-10-19T00:00:00.000Z',
          Scope: '',
          SearchFilter: '',
          IncludeStartState: 'false',
          KeepAliveTime: 'PT60S'
        }
      }
    ])
  })

  it('reads an event search that completes without results', async () => {
    const { mock, device } = await connect()
    expect(await Array.fromAsync(device.search.events({ startPoint: new Date(0) }))).toEqual([])
    expect(actionsOf(mock, 'search')).toEqual(['FindEvents', 'GetEventSearchResults', 'EndSearch'])
  })

  it('stops an event search that stays queued at the deadline', async () => {
    const { mock, device } = await connect({
      overrides: {
        'search.GetEventSearchResults': answer(cam('search.GetEventSearchResults').replace('>Completed<', '>Queued<')),
        'search.GetSearchState': answer(queuedState)
      }
    })
    const error = await rejection(() =>
      Array.fromAsync(device.search.events({ startPoint: new Date(0) }, { timeoutMs: 1_200 }))
    )
    expect(error).toBeInstanceOf(TimeoutError)
    expect(actionsOf(mock, 'search').at(-1)).toBe('EndSearch')
  })
})

describe('search information', () => {
  it('reads the recording summary of a camera without a memory card', async () => {
    const { device } = await connect()
    expect(await device.search.getRecordingSummary()).toEqual({
      summary: { dataFrom: new Date(0), dataUntil: new Date(0), numberRecordings: 1 }
    })
  })

  it('reports the missing memory card of the DCN-BM2220LPR as a SOAP fault with trimmed subcodes', async () => {
    const { device } = await connect()
    const error = await rejection(() => device.search.getRecordingInformation({ recordingToken: 'tokenRecording1' }))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: ['InvalidArgVal', 'unMatchToken'], action: 'GetRecordingInformation' })
  })

  it('reads the media attributes of each track', async () => {
    const { device } = await connect({
      overrides: { 'search.GetMediaAttributes': answer(simulator('search.GetMediaAttributes')) }
    })
    const { mediaAttributes = [] } = await device.search.getMediaAttributes({
      recordingTokens: ['RecordingToken_1'],
      time: new Date('2026-07-09T09:00:00Z')
    })
    expect(mediaAttributes[0]?.trackAttributes?.map(({ trackInformation }) => trackInformation.trackType)).toContain(
      'Video'
    )
  })
})

describe('replay.uri()', () => {
  it('returns the replay address on the configured host and the address as reported', async () => {
    const { mock, device } = await connect()
    const { uri, reported } = await device.replay.uri('tokenRecording1')
    expect(reported).toBe('rtsp://192.0.2.14:554/Recording')
    expect(uri.href).toBe(`rtsp://${device.address.hostname}:554/Recording`)
    expect(requestsOf(mock, 'GetReplayUri')).toEqual([
      {
        GetReplayUri: {
          StreamSetup: { Stream: 'RTP-Unicast', Transport: { Protocol: 'RTSP' } },
          RecordingToken: 'tokenRecording1'
        }
      }
    ])
  })

  it('keeps the query of the address and sends the protocol it was given', async () => {
    const { mock, device } = await connect({
      overrides: { 'replay.GetReplayUri': answer(hik('replay.GetReplayUri')) }
    })
    const { uri } = await device.replay.uri('OnvifRecordingToken_1', { protocol: 'HTTP' })
    expect(uri.pathname).toBe('/Streaming/Tracks/101')
    expect(uri.search).toBe('?transportmode=unicast&replaymode=onvifreplay')
    expect(requestsOf(mock, 'GetReplayUri')[0]).toMatchObject({
      GetReplayUri: { StreamSetup: { Transport: { Protocol: 'HTTP' } } }
    })
  })

  it('refuses an address on another host under the reject policy', async () => {
    const { device } = await connect(
      { overrides: { 'replay.GetReplayUri': answer(cam('replay.GetReplayUri').replace('192.0.2.14', '10.0.0.9')) } },
      'reject'
    )
    await expect(device.replay.uri('tokenRecording1')).rejects.toThrow(
      'Stream address host 10.0.0.9 is not the configured host'
    )
  })

  it.each([
    ['an address that is not a URL', 'not a url', "Invalid stream address 'not a url'"],
    ['an address that is not RTSP or HTTP', 'file:///etc/passwd', 'Unsupported stream address protocol file:']
  ])('refuses %s', async (_name, address, message) => {
    const { device } = await connect({
      overrides: {
        'replay.GetReplayUri': answer(cam('replay.GetReplayUri').replace('rtsp://192.0.2.14:554/Recording', address))
      }
    })
    const error = await rejection(() => device.replay.uri('tokenRecording1'))
    expect(error).toBeInstanceOf(OnvifError)
    expect(error).toMatchObject({ message, service: 'trp', action: 'GetReplayUri' })
  })

  it('reads the replay session timeout', async () => {
    const { device } = await connect()
    expect(await device.replay.getReplayConfiguration()).toEqual({ configuration: { sessionTimeout: 'PT60S' } })
  })
})
