import type { AnyURI } from './basics.ts'
import type { ReferenceToken } from './common.ts'
import type { Capabilities, ReplayConfiguration, StreamSetup } from './onvif.ts'

export type GetServiceCapabilities = Record<string, unknown>
export type GetServiceCapabilitiesResponse = {
  /** The capabilities for the replay service is returned in the Capabilities element. */
  capabilities?: Capabilities
}
export type GetReplayUri = {
  /** Specifies the connection parameters to be used for the stream. The URI that is returned may depend on these parameters. */
  streamSetup?: StreamSetup
  /** The identifier of the recording to be streamed. */
  recordingToken?: ReferenceToken
}
export type GetReplayUriResponse = {
  /** The URI to which the client should connect in order to stream the recording. */
  uri?: AnyURI
}
export type SetReplayConfiguration = {
  /** Description of the new replay configuration parameters. */
  configuration?: ReplayConfiguration
}
export type SetReplayConfigurationResponse = Record<string, unknown>
export type GetReplayConfiguration = Record<string, unknown>
export type GetReplayConfigurationResponse = {
  /** The current replay configuration parameters. */
  configuration?: ReplayConfiguration
}
