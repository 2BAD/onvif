import type { GeoLocation, PTZStatus, PTZVector, ReferenceToken } from './common.ts'
import type {
  AuxiliaryData,
  Capabilities,
  PresetTour,
  PTZConfiguration,
  PTZConfigurationOptions,
  PTZNode,
  PTZPreset,
  PTZPresetTourOperation,
  PTZPresetTourOptions,
  PTZSpeed
} from './onvif.ts'

export type GetServiceCapabilities = Record<string, unknown>
export type GetServiceCapabilitiesResponse = {
  /** The capabilities for the PTZ service is returned in the Capabilities element. */
  capabilities?: Capabilities
}
export type GetNodesResponse = {
  /** A list of the existing PTZ Nodes on the device. */
  PTZNode?: PTZNode[]
}
export type GetNode = {
  /** Token of the requested PTZNode. */
  nodeToken?: ReferenceToken
}
export type GetNodeResponse = {
  /** A requested PTZNode. */
  PTZNode?: PTZNode
}
export type GetConfigurationsResponse = {
  /** A list of all existing PTZConfigurations on the device. */
  PTZConfiguration?: PTZConfiguration[]
}
export type GetConfiguration = {
  /** Token of the requested PTZConfiguration. */
  PTZConfigurationToken?: ReferenceToken
}
export type GetConfigurationResponse = {
  /** A requested PTZConfiguration. */
  PTZConfiguration?: PTZConfiguration
}
export type SetConfiguration = {
  /**/
  PTZConfiguration?: PTZConfiguration
  /** Flag that makes configuration persistent. Example: User wants the configuration to exist after reboot. */
  forcePersistence?: boolean
}
export type SetConfigurationResponse = Record<string, unknown>
export type GetConfigurationOptions = {
  /** Token of an existing configuration that the options are intended for. */
  configurationToken?: ReferenceToken
}
export type GetConfigurationOptionsResponse = {
  /** The requested PTZ configuration options. */
  PTZConfigurationOptions?: PTZConfigurationOptions
}
export type SendAuxiliaryCommand = {
  /** A reference to the MediaProfile where the operation should take place. */
  profileToken?: ReferenceToken
  /** The Auxiliary request data. */
  auxiliaryData?: AuxiliaryData
}
export type SendAuxiliaryCommandResponse = {
  /** The response contains the auxiliary response. */
  auxiliaryResponse?: AuxiliaryData
}
export type GetPresets = {
  /** A reference to the MediaProfile where the operation should take place. */
  profileToken?: ReferenceToken
}
export type GetPresetsResponse = {
  /** A list of presets which are available for the requested MediaProfile. */
  preset?: PTZPreset[]
}
export type SetPreset = {
  /** A reference to the MediaProfile where the operation should take place. */
  profileToken?: ReferenceToken
  /** A requested preset name. */
  presetName?: string
  /** A requested preset token. */
  presetToken?: ReferenceToken
}
export type SetPresetResponse = {
  /** A token to the Preset which has been set. */
  presetToken?: ReferenceToken
}
export type RemovePreset = {
  /** A reference to the MediaProfile where the operation should take place. */
  profileToken?: ReferenceToken
  /** A requested preset token. */
  presetToken?: ReferenceToken
}
export type GotoPreset = {
  /** A reference to the MediaProfile where the operation should take place. */
  profileToken?: ReferenceToken
  /** A requested preset token. */
  presetToken?: ReferenceToken
  /** A requested speed.The speed parameter can only be specified when Speed Spaces are available for the PTZ Node. */
  speed?: PTZSpeed
}
export type GetStatus = {
  /** A reference to the MediaProfile where the PTZStatus should be requested. */
  profileToken?: ReferenceToken
}
export type GetStatusResponse = {
  /** The PTZStatus for the requested MediaProfile. */
  PTZStatus?: PTZStatus
}
export type GotoHomePosition = {
  /** A reference to the MediaProfile where the operation should take place. */
  profileToken?: ReferenceToken
  /** A requested speed.The speed parameter can only be specified when Speed Spaces are available for the PTZ Node. */
  speed?: PTZSpeed
}
export type GotoHomePositionResponse = Record<string, unknown>
export type SetHomePosition = {
  /** A reference to the MediaProfile where the home position should be set. */
  profileToken?: ReferenceToken
}
export type SetHomePositionResponse = Record<string, unknown>
export type ContinuousMove = {
  /** A reference to the MediaProfile. */
  profileToken?: ReferenceToken
  /** A Velocity vector specifying the velocity of pan, tilt and zoom. */
  velocity?: PTZSpeed
  /** An optional Timeout parameter. */
  timeout?: unknown
}
export type ContinuousMoveResponse = Record<string, unknown>
export type RelativeMove = {
  /** A reference to the MediaProfile. */
  profileToken?: ReferenceToken
  /** A positional Translation relative to the current position */
  translation?: PTZVector
  /** An optional Speed parameter. */
  speed?: PTZSpeed
}
export type RelativeMoveResponse = Record<string, unknown>
export type AbsoluteMove = {
  /** A reference to the MediaProfile. */
  profileToken?: ReferenceToken
  /** A Position vector specifying the absolute target position. */
  position?: PTZVector
  /** An optional Speed. */
  speed?: PTZSpeed
}
export type AbsoluteMoveResponse = Record<string, unknown>
export type GeoMove = {
  /** A reference to the MediaProfile. */
  profileToken?: ReferenceToken
  /** The geolocation of the target position. */
  target?: GeoLocation
  /** An optional Speed. */
  speed?: PTZSpeed
  /** An optional indication of the height of the target/area. */
  areaHeight?: number
  /** An optional indication of the width of the target/area. */
  areaWidth?: number
}
export type GeoMoveResponse = Record<string, unknown>
export type Stop = {
  /** A reference to the MediaProfile that indicate what should be stopped. */
  profileToken?: ReferenceToken
  /** Set true when we want to stop ongoing pan and tilt movements.If PanTilt arguments are not present, this command stops these movements. */
  panTilt?: boolean
  /** Set true when we want to stop ongoing zoom movement.If Zoom arguments are not present, this command stops ongoing zoom movement. */
  zoom?: boolean
}
export type StopResponse = Record<string, unknown>
export type GetPresetTours = {
  profileToken?: ReferenceToken
}
export type GetPresetToursResponse = {
  presetTour?: PresetTour[]
}
export type GetPresetTour = {
  profileToken?: ReferenceToken
  presetTourToken?: ReferenceToken
}
export type GetPresetTourResponse = {
  presetTour?: PresetTour
}
export type GetPresetTourOptions = {
  profileToken?: ReferenceToken
  presetTourToken?: ReferenceToken
}
export type GetPresetTourOptionsResponse = {
  options?: PTZPresetTourOptions
}
export type CreatePresetTour = {
  profileToken?: ReferenceToken
}
export type CreatePresetTourResponse = {
  presetTourToken?: ReferenceToken
}
export type ModifyPresetTour = {
  profileToken?: ReferenceToken
  presetTour?: PresetTour
}
export type ModifyPresetTourResponse = Record<string, unknown>
export type OperatePresetTour = {
  profileToken?: ReferenceToken
  presetTourToken?: ReferenceToken
  operation?: PTZPresetTourOperation
}
export type OperatePresetTourResponse = Record<string, unknown>
export type RemovePresetTour = {
  profileToken?: ReferenceToken
  presetTourToken?: ReferenceToken
}
export type RemovePresetTourResponse = Record<string, unknown>
export type GetCompatibleConfigurations = {
  /** Contains the token of an existing media profile the configurations shall be compatible with. */
  profileToken?: ReferenceToken
}
export type GetCompatibleConfigurationsResponse = {
  /** A list of all existing PTZConfigurations on the NVT that is suitable to be added to the addressed media profile. */
  PTZConfiguration?: PTZConfiguration[]
}
export type MoveAndStartTracking = {
  /** A reference to the MediaProfile where the operation should take place. */
  profileToken?: ReferenceToken
  /** A preset token. */
  presetToken?: ReferenceToken
  /** The geolocation of the target position. */
  geoLocation?: GeoLocation
  /** A Position vector specifying the absolute target position. */
  targetPosition?: PTZVector
  /** Speed vector specifying the velocity of pan, tilt and zoom. */
  speed?: PTZSpeed
  /** Object ID of the object to track. */
  objectID?: number
}
export type MoveAndStartTrackingResponse = Record<string, unknown>
