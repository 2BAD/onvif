import type { AnyURI } from './basics.ts'
import type { ReferenceToken } from './common.ts'
import type {
  AnalyticsEngine,
  AnalyticsEngineControl,
  AnalyticsEngineInput,
  AnalyticsStateInformation,
  Capabilities,
  StreamSetup,
  VideoAnalyticsConfiguration
} from './onvif.ts'

export type GetServiceCapabilities = {}
export type GetServiceCapabilitiesResponse = {
  /** The capabilities for the analytics device service is returned in the Capabilities element. */
  capabilities?: Capabilities
}
export type DeleteAnalyticsEngineControl = {
  /** Token of the Analytics Engine Control configuration to be deleted. */
  configurationToken?: ReferenceToken
}
export type DeleteAnalyticsEngineControlResponse = {}
export type CreateAnalyticsEngineInputs = {
  /** Settings of the configurations to be created. */
  configuration?: AnalyticsEngineInput[]
  forcePersistence?: boolean[]
}
export type CreateAnalyticsEngineInputsResponse = {
  /** Configurations containing token generated. */
  configuration?: AnalyticsEngineInput[]
}
export type CreateAnalyticsEngineControl = {
  /** Settings of the Analytics Engine Control configuration to be created. Mode shall be set to "idle". */
  configuration?: AnalyticsEngineControl
}
export type CreateAnalyticsEngineControlResponse = {
  /** Configuration containing token generated. */
  configuration?: AnalyticsEngineInput[]
}
export type SetAnalyticsEngineControl = {
  /** Contains the modified Analytics Engine Control configuration. */
  configuration?: AnalyticsEngineControl
  forcePersistence?: boolean
}
export type SetAnalyticsEngineControlResponse = {}
export type GetAnalyticsEngineControl = {
  /** Token of the requested AnalyticsEngineControl configuration. */
  configurationToken?: ReferenceToken
}
export type GetAnalyticsEngineControlResponse = {
  /** Configuration of the AnalyticsEngineControl. */
  configuration?: AnalyticsEngineControl
}
export type GetAnalyticsEngineControls = {}
export type GetAnalyticsEngineControlsResponse = {
  /** List of available AnalyticsEngineControl configurations. */
  analyticsEngineControls?: AnalyticsEngineControl[]
}
export type GetAnalyticsEngine = {
  /** Token of the requested AnalyticsEngine configuration. */
  configurationToken?: ReferenceToken
}
export type GetAnalyticsEngineResponse = {
  /** Configuration of the AnalyticsEngine. */
  configuration?: AnalyticsEngine
}
export type GetAnalyticsEngines = {}
export type GetAnalyticsEnginesResponse = {
  /** List of available AnalyticsEngine configurations. */
  configuration?: AnalyticsEngine[]
}
export type SetVideoAnalyticsConfiguration = {
  /** Contains the modified video analytics configuration. The configuration shall exist in the device. */
  configuration?: VideoAnalyticsConfiguration
  forcePersistence?: boolean
}
export type SetVideoAnalyticsConfigurationResponse = {}
export type SetAnalyticsEngineInput = {
  /** Contains the modified Analytics Engine Input configuration. The configuration shall exist in the device. */
  configuration?: AnalyticsEngineInput
  forcePersistence?: boolean
}
export type SetAnalyticsEngineInputResponse = {}
export type GetAnalyticsEngineInput = {
  /** Token of the requested AnalyticsEngineInput configuration. */
  configurationToken?: ReferenceToken
}
export type GetAnalyticsEngineInputResponse = {
  /** Configuration of the AnalyticsEngineInput. */
  configuration?: AnalyticsEngineInput
}
export type GetAnalyticsEngineInputs = {}
export type GetAnalyticsEngineInputsResponse = {
  /** List of available AnalyticsEngineInput configurations. */
  configuration?: AnalyticsEngineInput[]
}
export type GetAnalyticsDeviceStreamUri = {
  /** Configuration of the URI requested. */
  streamSetup?: StreamSetup
  /** Token of the AnalyticsEngineControl whose URI is requested. */
  analyticsEngineControlToken?: ReferenceToken
}
export type GetAnalyticsDeviceStreamUriResponse = {
  /** Streaming URI. */
  uri?: AnyURI
}
export type GetVideoAnalyticsConfiguration = {
  /** Token of the VideoAnalyticsConfiguration requested. */
  configurationToken?: ReferenceToken
}
export type GetVideoAnalyticsConfigurationResponse = {
  /** Settings of the VideoAnalyticsConfiguration. */
  configuration?: VideoAnalyticsConfiguration
}
export type DeleteAnalyticsEngineInputs = {
  /** LIst of tokens of Analytics Engine Input configurations to be deleted. */
  configurationToken?: ReferenceToken[]
}
export type DeleteAnalyticsEngineInputsResponse = {}
export type GetAnalyticsState = {
  /** Token of the AnalyticsEngineControl whose state information is requested. */
  analyticsEngineControlToken?: ReferenceToken
}
export type GetAnalyticsStateResponse = {
  /** Current status information. */
  state?: AnalyticsStateInformation
}
