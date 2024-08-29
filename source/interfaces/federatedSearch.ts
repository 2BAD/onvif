import type { AnyURI } from './basics.ts'
import type { Capabilities } from './onvif.ts'

/** Corresponds to SimpleTermType definition in ISO/IEC 15938-12 */
export type SimpleTermType = AnyURI
/** Corresponds to mimeType definition in ISO/IEC 15938-12 */
export type mimeType = string
/**
 * Contains features provided by a database, formatted according to
 * presets defined in ISO/IEC 15938-12
 */
export type RegisterDatabase = {
  extension?: RegisterDatabaseExtension
} & CapabilityType
export type RegisterDatabaseExtension = {}
export type CapabilityType = {
  supportedQFProfile?: TermType
  supportedMetadata?: AnyURI[]
  supportedExampleMediaTypes?: unknown
  supportedResultMediaTypes?: unknown
  supportedQueryTypes?: TermType[]
  supportedExpressions?: TermType[]
}
/** Corresponds to TermType definition in ISO/IEC 15938-12 */
export type TermType = {
  href: SimpleTermType
  name?: string
  description?: string
  term?: TermType[]
}
export type GetServiceCapabilitiesResponse = {
  capabilities?: Capabilities
}
export type GetServiceFeatures = {
  /**
   * Contains descriptions of desired services
   * capabilities and may contain the ID for a particular service to
   * be addressed.
   */
  inputCapabilities?: unknown
}
export type GetServiceFeaturesResponse = {
  /**
   * Contains a list of available service capability
   * descriptions or a system message in case of an error. If no
   * service is available or matches the given capabilities, then an
   * empty Output element is returned.
   */
  outputCapabilities?: unknown
}
export type Search = {
  /**
   * Container for describing a query request
   * containing a set of conditions and/or the specification of the
   * structure and content of the output query format and a
   * declaration part.
   */
  inputQuery?: unknown
}
export type SearchResponse = {
  /**
   * Container for all the results from a responder to
   * a requester. It may contain in addition messages such as error
   * and exception.
   */
  outputQuery?: unknown
}
export type GetSearchResults = {
  /**
   * Allows to request the results of a previous query
   * issued.
   */
  results?: unknown
}
export type GetSearchResultsResponse = {
  /**
   * Describes a single result returned from a
   * responder.
   */
  resultItem?: unknown[]
}
export type RegisterDatabaseResponse = {}
