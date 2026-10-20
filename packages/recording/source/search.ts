import { setTimeout as pause } from 'node:timers/promises'
import { type CallOptions, type Device, type Operation, TimeoutError } from '@2bad/onvif'
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

type PageRequest = { searchToken: string; minResults?: number; maxResults?: number; waitTime?: string }

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
async function* results<Request, List extends { searchState: SearchState }, Item>(
  device: Device,
  find: Operation<Request, { searchToken: string }>,
  request: Request,
  page: Operation<PageRequest, { resultList: List }>,
  itemsOf: (resultList: List) => Item[] | undefined,
  options: SearchOptions
): AsyncGenerator<Item, void, undefined> {
  const { signal, timeoutMs = 60_000, pageSize = 100 } = options
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
  const { searchToken } = await step(find.name, (callOptions) => device.call(find, request, callOptions))
  const pageRequest = { searchToken, minResults: 1, maxResults: pageSize, waitTime: 'PT1S' }
  const next = async () => {
    const { resultList } = await step(page.name, (callOptions) => device.call(page, pageRequest, callOptions))
    return { searchState: resultList.searchState, items: itemsOf(resultList) ?? [] }
  }
  let failed = false
  try {
    for (;;) {
      const { searchState, items } = await next()
      yield* items
      if (searchState === 'Completed') break
      if (items.length === 0) {
        // some devices report Queued on every page of a search that GetSearchState reports completed
        const { state } = await step('GetSearchState', (callOptions) =>
          device.call(GetSearchState, { searchToken }, callOptions)
        )
        if (state === 'Completed') {
          yield* (await next()).items
          break
        }
        await step(page.name, async ({ timeoutMs: leftMs }) =>
          pause(Math.min(EMPTY_PAGE_PAUSE_MS, leftMs), undefined, { signal })
        )
      }
    }
  } catch (error) {
    failed = true
    throw error
  } finally {
    await (failed ? endAfterFailure(device, searchToken) : device.call(EndSearch, { searchToken }))
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
  const { keepAliveTime = keepAliveOf(options) } = options
  const find = { scope, ...(maxMatches === undefined ? {} : { maxMatches }), keepAliveTime }
  return results(device, FindRecordings, find, GetRecordingSearchResults, (list) => list.recordingInformation, options)
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
  const { keepAliveTime = keepAliveOf(options) } = options
  const find = {
    startPoint,
    ...(endPoint === undefined ? {} : { endPoint }),
    scope,
    searchFilter,
    includeStartState,
    ...(maxMatches === undefined ? {} : { maxMatches }),
    keepAliveTime
  }
  return results(device, FindEvents, find, GetEventSearchResults, (list) => list.result, options)
}
