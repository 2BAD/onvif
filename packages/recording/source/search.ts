import { setTimeout as pause } from 'node:timers/promises'
import { type CallOptions, type Device, TimeoutError } from '@2bad/onvif'
import {
  EndSearch,
  type EventFilter,
  FindEvents,
  type FindEventResult,
  FindRecordings,
  GetEventSearchResults,
  GetRecordingSearchResults,
  GetSearchState,
  type RecordingInformation,
  type SearchScope,
  type SearchState
} from '#generated/search.ts'

export type SearchOptions = Pick<CallOptions, 'signal'> & {
  /** Time for the whole search, 60 s by default. The search ends with a `TimeoutError` after it. */
  timeoutMs?: number | undefined
  /** Results asked for per request, 100 by default. */
  pageSize?: number | undefined
  /** How long the device keeps the search open, as an `xs:duration`. The time of the whole search by default. */
  keepAliveTime?: string | undefined
}

export type RecordingSearch = {
  scope?: SearchScope | undefined
  /** The most results the device returns. */
  maxMatches?: number | undefined
}

export type EventSearch = RecordingSearch & {
  startPoint: Date
  /** Searches backwards in time when before `startPoint`. */
  endPoint?: Date | undefined
  searchFilter?: EventFilter | undefined
  /** Also return the state of each property event at `startPoint`. */
  includeStartState?: boolean | undefined
}

type Page<Item> = { searchState: SearchState; items: Item[] }

type StepOptions = { signal: AbortSignal | undefined; timeoutMs: number }

const EMPTY_PAGE_PAUSE_MS = 500

// some devices end a search the keep alive time after it started, however often it is read
const keepAliveOf = ({ timeoutMs = 60_000 }: SearchOptions): string => `PT${Math.max(10, Math.ceil(timeoutMs / 1000))}S`

const endAfterFailure = async (device: Device, searchToken: string): Promise<void> => {
  try {
    await device.call(EndSearch, { searchToken })
  } catch {
    // the error that stopped the search is the one reported
  }
}

// gets pages until the device reports the search completed, then ends the search whatever happened
async function* results<Item>(
  device: Device,
  actions: { find: string; page: string },
  start: (options: CallOptions) => Promise<string>,
  page: (searchToken: string, options: CallOptions) => Promise<Page<Item>>,
  options: SearchOptions
): AsyncGenerator<Item, void, undefined> {
  const { signal, timeoutMs = 60_000 } = options
  const deadline = performance.now() + timeoutMs
  // runs one step of the search in the time left, and reports the deadline as the search timing out
  const step = async <Result>(action: string, run: (callOptions: StepOptions) => Promise<Result>): Promise<Result> => {
    const timeout = (cause?: unknown) =>
      new TimeoutError(
        `The search did not complete within ${timeoutMs} ms`,
        { host: device.address.host, service: 'tse', action },
        { cause }
      )
    const remainingMs = deadline - performance.now()
    if (remainingMs <= 0) throw timeout()
    try {
      return await run({ signal, timeoutMs: remainingMs })
    } catch (error) {
      throw error instanceof TimeoutError ? timeout(error) : error
    }
  }
  const searchToken = await step(actions.find, start)
  let ended = false
  let failed = false
  try {
    for (;;) {
      const { searchState, items } = await step(actions.page, (callOptions) => page(searchToken, callOptions))
      yield* items
      if (searchState === 'Completed') break
      if (items.length === 0) {
        // some devices report Queued on every page of a search that GetSearchState reports completed
        const { state } = await step('GetSearchState', (callOptions) =>
          device.call(GetSearchState, { searchToken }, callOptions)
        )
        if (state === 'Completed') {
          yield* (await step(actions.page, (callOptions) => page(searchToken, callOptions))).items
          break
        }
        await step(actions.page, async ({ timeoutMs: leftMs }) =>
          pause(Math.min(EMPTY_PAGE_PAUSE_MS, leftMs), undefined, { signal })
        )
      }
    }
    ended = true
    await device.call(EndSearch, { searchToken })
  } catch (error) {
    failed = true
    throw error
  } finally {
    if (!ended) await (failed ? endAfterFailure(device, searchToken) : device.call(EndSearch, { searchToken }))
  }
}

/**
 * Search the recordings of a device. The search ends on the device when the results are read, on an error and when
 * the loop stops early.
 *
 * @param device - A connected device
 * @param request - Scope and the most results to return
 * @param options - Abort signal, time for the whole search, page size and keep alive time
 * @returns The information of each recording found
 * @throws {TimeoutError} If the search does not complete within `timeoutMs`
 * @throws {SoapFaultError} If the device rejects the search or its token expires between pages
 * @example
 * for await (const found of camera.search.recordings()) console.log(found.recordingToken)
 */
export function searchRecordings(
  device: Device,
  request: RecordingSearch = {},
  options: SearchOptions = {}
): AsyncGenerator<RecordingInformation, void, undefined> {
  const { scope = {}, maxMatches } = request
  const { pageSize = 100, keepAliveTime = keepAliveOf(options) } = options
  const find = { scope, ...(maxMatches === undefined ? {} : { maxMatches }), keepAliveTime }
  return results(
    device,
    { find: 'FindRecordings', page: 'GetRecordingSearchResults' },
    async (callOptions) => (await device.call(FindRecordings, find, callOptions)).searchToken,
    async (searchToken, callOptions) => {
      const { resultList } = await device.call(
        GetRecordingSearchResults,
        { searchToken, minResults: 1, maxResults: pageSize, waitTime: 'PT1S' },
        callOptions
      )
      return { searchState: resultList.searchState, items: resultList.recordingInformation ?? [] }
    },
    options
  )
}

/**
 * Search the recorded events of a device between two points in time. The search ends on the device when the results
 * are read, on an error and when the loop stops early.
 *
 * @param device - A connected device
 * @param request - Time range, scope, topic filter and the most results to return
 * @param options - Abort signal, time for the whole search, page size and keep alive time
 * @returns Each event found, with its recording, track and time
 * @throws {TimeoutError} If the search does not complete within `timeoutMs`
 * @throws {SoapFaultError} If the device rejects the search or its token expires between pages
 * @example
 * const startPoint = new Date(Date.now() - 86_400_000)
 * for await (const found of camera.search.events({ startPoint })) console.log(found.time, found.event.topic?.value)
 */
export function searchEvents(
  device: Device,
  request: EventSearch,
  options: SearchOptions = {}
): AsyncGenerator<FindEventResult, void, undefined> {
  const { startPoint, endPoint, scope = {}, searchFilter = {}, includeStartState = false, maxMatches } = request
  const { pageSize = 100, keepAliveTime = keepAliveOf(options) } = options
  const find = {
    startPoint,
    ...(endPoint === undefined ? {} : { endPoint }),
    scope,
    searchFilter,
    includeStartState,
    ...(maxMatches === undefined ? {} : { maxMatches }),
    keepAliveTime
  }
  return results(
    device,
    { find: 'FindEvents', page: 'GetEventSearchResults' },
    async (callOptions) => (await device.call(FindEvents, find, callOptions)).searchToken,
    async (searchToken, callOptions) => {
      const { resultList } = await device.call(
        GetEventSearchResults,
        { searchToken, minResults: 1, maxResults: pageSize, waitTime: 'PT1S' },
        callOptions
      )
      return { searchState: resultList.searchState, items: resultList.result ?? [] }
    },
    options
  )
}
