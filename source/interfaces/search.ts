import type {
  Capabilities,
  EventFilter,
  FindEventResultList,
  FindMetadataResultList,
  FindPTZPositionResultList,
  FindRecordingResultList,
  JobToken,
  MediaAttributes,
  MetadataFilter,
  OnvifDate,
  PTZPositionFilter,
  RecordingInformation,
  RecordingReference,
  RecordingSummary,
  SearchScope,
  SearchState
} from './onvif.ts'

export type GetServiceCapabilities = {}
export type GetServiceCapabilitiesResponse = {
  /** The capabilities for the search service is returned in the Capabilities element. */
  capabilities?: Capabilities
}
export type GetRecordingSummary = {}
export type GetRecordingSummaryResponse = {
  summary?: RecordingSummary
}
export type GetRecordingInformation = {
  recordingToken?: RecordingReference
}
export type GetRecordingInformationResponse = {
  recordingInformation?: RecordingInformation
}
export type GetMediaAttributes = {
  recordingTokens?: RecordingReference[]
  time?: OnvifDate
}
export type GetMediaAttributesResponse = {
  mediaAttributes?: MediaAttributes[]
}
export type FindRecordings = {
  /** Scope defines the dataset to consider for this search. */
  scope?: SearchScope
  /** The search will be completed after this many matches. If not specified, the search will continue until reaching the endpoint or until the session expires. */
  maxMatches?: number
  /** The time the search session will be kept alive after responding to this and subsequent requests. A device shall support at least values up to ten seconds. */
  keepAliveTime?: unknown
}
export type FindRecordingsResponse = {
  searchToken?: JobToken
}
export type GetRecordingSearchResults = {
  /** The search session to get results from. */
  searchToken?: JobToken
  /** The minimum number of results to return in one response. */
  minResults?: number
  /** The maximum number of results to return in one response. */
  maxResults?: number
  /** The maximum time before responding to the request, even if the MinResults parameter is not fulfilled. */
  waitTime?: unknown
}
export type GetRecordingSearchResultsResponse = {
  resultList?: FindRecordingResultList
}
export type FindEvents = {
  /** The point of time where the search will start. */
  startPoint?: OnvifDate
  /** The point of time where the search will stop. This can be a time before the StartPoint, in which case the search is performed backwards in time. */
  endPoint?: OnvifDate
  scope?: SearchScope
  searchFilter?: EventFilter
  /** Setting IncludeStartState to true means that the server should return virtual events representing the start state for any recording included in the scope. Start state events are limited to the topics defined in the SearchFilter that have the IsProperty flag set to true. */
  includeStartState?: boolean
  /** The search will be completed after this many matches. If not specified, the search will continue until reaching the endpoint or until the session expires. */
  maxMatches?: number
  /** The time the search session will be kept alive after responding to this and subsequent requests. A device shall support at least values up to ten seconds. */
  keepAliveTime?: unknown
}
export type FindEventsResponse = {
  /** A unique reference to the search session created by this request. */
  searchToken?: JobToken
}
export type GetEventSearchResults = {
  /** The search session to get results from. */
  searchToken?: JobToken
  /** The minimum number of results to return in one response. */
  minResults?: number
  /** The maximum number of results to return in one response. */
  maxResults?: number
  /** The maximum time before responding to the request, even if the MinResults parameter is not fulfilled. */
  waitTime?: unknown
}
export type GetEventSearchResultsResponse = {
  resultList?: FindEventResultList
}
export type FindPTZPosition = {
  /** The point of time where the search will start. */
  startPoint?: OnvifDate
  /** The point of time where the search will stop. This can be a time before the StartPoint, in which case the search is performed backwards in time. */
  endPoint?: OnvifDate
  scope?: SearchScope
  searchFilter?: PTZPositionFilter
  /** The search will be completed after this many matches. If not specified, the search will continue until reaching the endpoint or until the session expires. */
  maxMatches?: number
  /** The time the search session will be kept alive after responding to this and subsequent requests. A device shall support at least values up to ten seconds. */
  keepAliveTime?: unknown
}
export type FindPTZPositionResponse = {
  /** A unique reference to the search session created by this request. */
  searchToken?: JobToken
}
export type GetPTZPositionSearchResults = {
  /** The search session to get results from. */
  searchToken?: JobToken
  /** The minimum number of results to return in one response. */
  minResults?: number
  /** The maximum number of results to return in one response. */
  maxResults?: number
  /** The maximum time before responding to the request, even if the MinResults parameter is not fulfilled. */
  waitTime?: unknown
}
export type GetPTZPositionSearchResultsResponse = {
  resultList?: FindPTZPositionResultList
}
export type FindMetadata = {
  /** The point of time where the search will start. */
  startPoint?: OnvifDate
  /** The point of time where the search will stop. This can be a time before the StartPoint, in which case the search is performed backwards in time. */
  endPoint?: OnvifDate
  scope?: SearchScope
  metadataFilter?: MetadataFilter
  /** The search will be completed after this many matches. If not specified, the search will continue until reaching the endpoint or until the session expires. */
  maxMatches?: number
  /** The time the search session will be kept alive after responding to this and subsequent requests. A device shall support at least values up to ten seconds. */
  keepAliveTime?: unknown
}
export type FindMetadataResponse = {
  /** A unique reference to the search session created by this request. */
  searchToken?: JobToken
}
export type GetMetadataSearchResults = {
  /** The search session to get results from. */
  searchToken?: JobToken
  /** The minimum number of results to return in one response. */
  minResults?: number
  /** The maximum number of results to return in one response. */
  maxResults?: number
  /** The maximum time before responding to the request, even if the MinResults parameter is not fulfilled. */
  waitTime?: unknown
}
export type GetMetadataSearchResultsResponse = {
  resultList?: FindMetadataResultList
}
export type GetSearchState = {
  /** The search session to get the state from. */
  searchToken?: JobToken
}
export type GetSearchStateResponse = {
  state?: SearchState
}
export type EndSearch = {
  /** The search session to end. */
  searchToken?: JobToken
}
export type EndSearchResponse = {
  /** The point of time the search had reached when it was ended. It is equal to the EndPoint specified in Find-operation if the search was completed. */
  endpoint?: OnvifDate
}
