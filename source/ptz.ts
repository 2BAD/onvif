/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import type { Duration, MoveStatus, ReferenceToken, Vector1D, Vector2D } from './interfaces/common.ts'
import type { PTZConfiguration, PTZSpeed, Space1DDescription, Space2DDescription } from './interfaces/onvif.ts'
import type { GetConfigurationsResponse } from './interfaces/ptz.2.ts'
import type { Onvif } from './onvif.ts'
import { linerase } from './utils.ts'

/**
 * Represents the supported PTZ preset tour options.
 */
export type PTZPresetTourSupported = {
  /**
   * Indicates number of preset tours that can be created. Required preset tour operations shall be available for this
   * PTZ Node if one or more preset tour is supported
   */
  maximumNumberOfPresetTours: number
  /**
   * Indicates which preset tour operations are available for this PTZ Node.
   */
  ptzPresetTourOperation: 'Start' | 'Stop' | 'Pause' | 'Extended'
}

/**
 * Represents a PTZ Node with its properties and capabilities.
 */
export type PTZNode = {
  /** Unique identifier referencing the physical entity */
  token: ReferenceToken
  /** Indicates whether the HomePosition of a Node is fixed or can be changed via the SetHomePosition command */
  fixedHomePosition: boolean
  /** Indicates whether the Node supports the geo-referenced move command */
  geoMove: boolean
  /** A unique identifier that is used to reference PTZ Nodes */
  name?: string
  /**
   * A list of Coordinate Systems available for the PTZ Node. For each Coordinate System, the PTZ Node MUST specify
   * its allowed range
   */
  supportedPTZSpaces: PTZSpace[]
  /** All preset operations MUST be available for this PTZ Node if one preset is supported */
  maximumNumberOfPresets: number
  /**
   * A boolean operator specifying the availability of a home position. If set to true, the Home Position Operations
   * MUST be available for this PTZ Node
   */
  homeSupported: boolean
  /**
   * A list of supported Auxiliary commands. If the list is not empty, the Auxiliary Operations MUST be available for
   * this PTZ Node
   */
  auxiliaryCommands?: unknown
  extension?: {
    /** Detail of supported Preset Tour feature */
    supportedPresetTour?: PTZPresetTourSupported
    extension?: unknown
  }
}

/**
 * Represents the available PTZ spaces for a node.
 */
export type PTZSpace = {
  /**
   *  The Generic Pan/Tilt Position space is provided by every PTZ node that supports absolute Pan/Tilt, since it
   * does not relate to a specific physical range. Instead, the range should be defined as the full range of the PTZ
   * unit normalized to the range -1 to 1 resulting in the following space description
   */
  absolutePanTiltPositionSpace?: Space2DDescription
  /**
   *  The Generic Zoom Position Space is provided by every PTZ node that supports absolute Zoom, since it does not
   * relate to a specific physical range. Instead, the range should be defined as the full range of the Zoom normalized
   * to the range 0 (wide) to 1 (tele). There is no assumption about how the generic zoom range is mapped
   * to magnification, FOV or other physical zoom dimension
   */
  absoluteZoomPositionSpace?: Space1DDescription
  /**
   * The Generic Pan/Tilt translation space is provided by every PTZ node that supports relative Pan/Tilt, since it
   * does not relate to a specific physical range. Instead, the range should be defined as the full positive and
   * negative translation range of the PTZ unit normalized to the range -1 to 1, where positive translation would mean
   * clockwise rotation or movement in right/up direction resulting in the following space description
   */
  relativePanTiltTranslationSpace?: Space2DDescription
  /**
   * The Generic Zoom Translation Space is provided by every PTZ node that supports relative Zoom, since it does not
   * relate to a specific physical range. Instead, the corresponding absolute range should be defined as the full
   * positive and negative translation range of the Zoom normalized to the range -1 to1, where a positive translation
   * maps to a movement in TELE direction. The translation is signed to indicate direction (negative is to wide,
   * positive is to tele). There is no assumption about how the generic zoom range is mapped to magnification, FOV or
   * other physical zoom dimension. This results in the following space description
   */
  relativeZoomTranslationSpace?: Space1DDescription
  /**
   * The generic Pan/Tilt velocity space shall be provided by every PTZ node, since it does not relate to a specific
   * physical range. Instead, the range should be defined as a range of the PTZ unit’s speed normalized to the range
   * -1 to 1, where a positive velocity would map to clockwise rotation or movement in the right/up direction. A signed
   * speed can be independently specified for the pan and tilt component resulting in the following space description
   */
  continuousPanTiltVelocitySpace?: Space2DDescription
  /**
   * The generic zoom velocity space specifies a zoom factor velocity without knowing the underlying physical model.
   * The range should be normalized from -1 to 1, where a positive velocity would map to TELE direction. A generic zoom
   * velocity space description resembles the following
   */
  continuousZoomVelocitySpace?: Space1DDescription
  /**
   * The speed space specifies the speed for a Pan/Tilt movement when moving to an absolute position or to a relative
   * translation. In contrast to the velocity spaces, speed spaces do not contain any directional information. The speed
   * of a combined Pan/Tilt movement is represented by a single non-negative scalar value
   */
  panTiltSpeedSpace?: Space1DDescription
  /**
   * The speed space specifies the speed for a Zoom movement when moving to an absolute position or to a relative
   * translation. In contrast to the velocity spaces, speed spaces do not contain any directional information
   */
  zoomSpeedSpace?: Space1DDescription
  extension?: unknown
}

/**
 * Represents a range of durations.
 */
export type DurationRange = {
  min: Duration
  max: Duration
}

/**
 * Represents the options for PT Direction Control.
 */
export type PTControlDirectionOptions = {
  /** Supported options for EFlip feature */
  EFlip?: {
    /** Options of EFlip mode parameter */
    mode?: 'OFF' | 'ON' | 'Extended'
    extension?: unknown
  }
  /** Supported options for Reverse feature */
  reverse?: {
    /** Options of Reverse mode parameter */
    mode?: 'OFF' | 'ON' | 'AUTO' | 'Extended'
    extension?: unknown
  }
}

/**
 * Represents the requested PTZ configuration options.
 */
export type PTZConfigurationOptions = {
  /**
   * The list of acceleration ramps supported by the device. The smallest acceleration value corresponds to the minimal
   * index, the highest acceleration corresponds to the maximum index
   */
  PTZRamps: number[]
  /** A list of supported coordinate systems including their range limitations */
  spaces: PTZSpace[]
  /** A timeout Range within which Timeouts are accepted by the PTZ Node */
  PTZTimeout: DurationRange
  /** Supported options for PT Direction Control */
  PTControlDirection?: PTControlDirectionOptions
  extension: unknown
}

/**
 * Options for getting presets.
 */
export type GetPresetsOptions = {
  profileToken?: ReferenceToken
}

/** A list of presets which are available for the requested MediaProfile. */
export type PTZPreset = {
  token: ReferenceToken
  /** The name of the preset position */
  name?: string
  /** The preset position */
  PTZPosition?: PTZVector
}

/**
 * Represents a PTZ vector with pan, tilt, and zoom components.
 */
export type PTZVector = {
  panTilt?: Vector2D
  zoom?: Vector1D
}

/**
 * Simplified structure of PTZ vector to use as an input argument for position and speed in movement commands.
 */
export type PTZInputVector = {
  /** Pan value */
  pan?: number
  /** Synonym for pan value */
  x?: number
  /** Tilt value */
  tilt?: number
  /** Synonym for tilt value */
  y?: number
  /** Zoom value */
  zoom?: number
}

/**
 * Options for the gotoPreset operation.
 */
export type GotoPresetOptions = {
  /** A reference to the MediaProfile where the operation should take place */
  profileToken?: ReferenceToken
  /** A requested preset token. From {@link PTZ.presets} property */
  presetToken: ReferenceToken
  /** A requested speed.The speed parameter can only be specified when Speed Spaces are available for the PTZ Node. */
  speed?: PTZVector | PTZInputVector
}

/**
 * Options for the setPreset operation.
 */
export type SetPresetOptions = {
  /** A reference to the MediaProfile where the operation should take place */
  profileToken?: ReferenceToken
  /** A requested preset name */
  presetName: string
  /** A requested preset token */
  presetToken?: ReferenceToken
}

/**
 * Response from the setPreset operation.
 */
export type SetPresetResponse = {
  /** A token to the Preset which has been set */
  presetToken: ReferenceToken
}

/**
 * Options for the removePreset operation.
 */
export type RemovePresetOptions = {
  /** A reference to the MediaProfile where the operation should take place */
  profileToken?: ReferenceToken
  /** A requested preset token */
  presetToken: ReferenceToken
}

/**
 * Options for the gotoHomePosition operation.
 */
export type GotoHomePositionOptions = {
  /** A reference to the MediaProfile where the operation should take place */
  profileToken?: ReferenceToken
  /** A requested speed.The speed parameter can only be specified when Speed Spaces are available for the PTZ Node. */
  speed?: PTZVector | PTZInputVector
}

/**
 * Options for the setHomePosition operation.
 */
export type SetHomePositionOptions = {
  /** A reference to the MediaProfile where the home position should be set */
  profileToken?: ReferenceToken
}

/**
 * Options for the getStatus operation.
 */
export type GetStatusOptions = {
  profileToken?: ReferenceToken
}

/**
 * Represents the move status of PTZ.
 */
export type PTZMoveStatus = {
  panTilt: MoveStatus
  zoom: MoveStatus
}

/**
 * Represents the current status of PTZ.
 */
export type PTZStatus = {
  /**
   * Specifies the absolute position of the PTZ unit together with the Space references. The default absolute spaces
   * of the corresponding PTZ configuration MUST be referenced within the Position element.
   */
  position?: PTZVector
  /** Indicates if the Pan/Tilt/Zoom device unit is currently moving, idle or in an unknown state */
  moveStatus?: PTZMoveStatus
  /** States a current PTZ error */
  error?: string
  /** Specifies the UTC time when this status was generated */
  utcTime?: Date
}

/**
 * Options for the absoluteMove operation.
 */
export type AbsoluteMoveOptions = {
  /** A reference to the MediaProfile */
  profileToken?: ReferenceToken
  /** A Position vector specifying the absolute target position */
  position: PTZVector | PTZInputVector
  /** An optional Speed */
  speed?: PTZSpeed | PTZInputVector
}

/**
 * Options for the relativeMove operation.
 */
export type RelativeMoveOptions = {
  /** A reference to the MediaProfile */
  profileToken?: ReferenceToken
  /** A positional Translation relative to the current position */
  translation: PTZVector | PTZInputVector
  /** An optional Speed */
  speed?: PTZSpeed | PTZInputVector
}

/**
 * Options for the continuousMove operation.
 */
export type ContinuousMoveOptions = {
  /** A reference to the MediaProfile */
  profileToken?: ReferenceToken
  /** A Velocity vector specifying the velocity of pan, tilt and zoom */
  velocity: PTZSpeed | PTZInputVector
  /** An optional Timeout parameter */
  timeout?: Duration | number
}

/**
 * Options for the stop operation.
 */
export type StopOptions = {
  /** A reference to the MediaProfile that indicates what should be stopped */
  profileToken?: ReferenceToken
  /**
   * Set true when we want to stop ongoing pan and tilt movements.If PanTilt arguments are not present, this command
   * stops these movements.
   */
  panTilt?: boolean
  /**
   * Set true when we want to stop ongoing zoom movement.If Zoom arguments are not present, this command stops ongoing
   * zoom movement.
   */
  zoom?: boolean
}

/**
 * PTZ class containing methods for PTZ operations
 */
export class PTZ {
  private readonly onvif: Onvif
  #nodes: Record<ReferenceToken, PTZNode> = {}
  get nodes() {
    return this.#nodes
  }
  #configurations: Record<ReferenceToken, PTZConfiguration> = {}
  get configurations() {
    return this.#configurations
  }
  #presets: Record<ReferenceToken, PTZPreset> = {}
  get presets() {
    return this.#presets
  }

  constructor(onvif: Onvif) {
    this.onvif = onvif
  }

  /**
   * Returns the properties of the requested PTZ node, if it exists.
   * Use this function to get maximum number of presets, ranges of admitted values for x, y, zoom, iris, focus
   */
  async getNodes(): Promise<Record<ReferenceToken, PTZNode>> {
    const [data] = await this.onvif.request({
      service: 'PTZ',
      body: '<GetNodes xmlns="http://www.onvif.org/ver20/ptz/wsdl" />'
    })
    this.#nodes = {}
    data[0].getNodesResponse.forEach((ptzNode: unknown) => {
      const node: PTZNode = linerase(ptzNode.PTZNode[0])
      this.#nodes[node.token] = node
    })
    return this.#nodes
  }

  /**
   * Get an array with all the existing PTZConfigurations from the device.
   */
  async getConfigurations(): Promise<Record<ReferenceToken, PTZConfiguration>> {
    const [data] = await this.onvif.request<GetConfigurationsResponse>({
      service: 'PTZ',
      body: '<GetConfigurations xmlns="http://www.onvif.org/ver20/ptz/wsdl"></GetConfigurations>'
    })
    this.#configurations = {}
    if (Array.isArray(data.PTZConfiguration)) {
      data.PTZConfiguration.forEach((configuration) => {
        const result = linerase(configuration) as PTZConfiguration
        this.#configurations[result.token] = result
      })
    }
    return this.#configurations
  }

  /**
   * List supported coordinate systems including their range limitations.
   * Therefore, the options MAY differ depending on whether the PTZ Configuration is assigned to a Profile containing
   * a Video Source Configuration. In that case, the options may additionally contain coordinate systems referring to
   * the image coordinate system described by the Video Source Configuration. If the PTZ Node supports continuous
   * movements, it shall return a Timeout Range within which Timeouts are accepted by the PTZ Node
   *
   * @param options - The options for getting configuration options.
   * @param options.configurationToken - Token of an existing configuration that the options are intended for
   */
  async getConfigurationOptions({
    configurationToken
  }: { configurationToken: ReferenceToken }): Promise<PTZConfigurationOptions> {
    const [data] = await this.onvif.request({
      service: 'PTZ',
      body: `
        <GetConfigurationOptions xmlns="http://www.onvif.org/ver20/ptz/wsdl">
          <ConfigurationToken>${configurationToken}</ConfigurationToken>
        </GetConfigurationOptions>
      `
    })
    return linerase(data) as PTZConfigurationOptions
  }

  /**
   * Operation to request all PTZ presets for the PTZNode in the selected profile. The operation is supported if there
   * is support for at least on PTZ preset by the PTZNode.
   *
   * @param options - The options for getting presets.
   */
  async getPresets({ profileToken }: GetPresetsOptions = {}): Promise<Record<ReferenceToken, PTZPreset>> {
    const [data] = await this.onvif.request({
      service: 'PTZ',
      body: `
        <GetPresets xmlns="http://www.onvif.org/ver20/ptz/wsdl">
          <ProfileToken>${profileToken || this.onvif.activeSource!.profileToken}</ProfileToken>
        </GetPresets>
      `
    })
    this.#presets = {}
    const result = linerase(data[0].getPresetsResponse[0].preset) as PTZPreset[] | PTZPreset
    if (Array.isArray(result)) {
      result.forEach((preset: PTZPreset) => {
        this.#presets[preset.token] = preset
      })
    } else if (result) {
      this.#presets[result.token] = result
    }
    return this.#presets
  }

  private static formatPTZSimpleVector(vector: PTZInputVector = { x: 0, y: 0, zoom: 0 }): PTZVector {
    return {
      panTilt: {
        x: vector.pan ?? vector.x ?? 0,
        y: vector.tilt ?? vector.y ?? 0
      },
      zoom: {
        x: vector.zoom ?? 0
      }
    }
  }

  private static PTZVectorToXML(input: PTZVector | PTZInputVector): string {
    const vector: PTZVector = 'x' in input || 'pan' in input ? PTZ.formatPTZSimpleVector(input) : input
    return `
      ${vector.panTilt ? `<PanTilt x="${vector.panTilt.x}" y="${vector.panTilt.y}" xmlns="http://www.onvif.org/ver10/schema"/>` : ''}
      ${vector.zoom ? `<Zoom x="${vector.zoom.x}" xmlns="http://www.onvif.org/ver10/schema"/>` : ''}
    `
  }

  /**
   * Operation to go to a saved preset position for the PTZNode in the selected profile. The operation is supported if
   * there is support for at least on PTZ preset by the PTZNode.
   *
   * @param options
   */
  async gotoPreset({ profileToken, presetToken, speed }: GotoPresetOptions): Promise<void> {
    await this.onvif.request({
      service: 'PTZ',
      body: `
        <GotoPreset xmlns="http://www.onvif.org/ver20/ptz/wsdl">
          <ProfileToken>${profileToken || this.onvif.activeSource!.profileToken}</ProfileToken>
          <PresetToken>${presetToken}</PresetToken>
          ${speed ? `<Speed>${PTZ.PTZVectorToXML(speed)}</Speed>` : ''}
        </GotoPreset>
      `
    })
  }
  /**
   * The SetPreset command saves the current device position parameters so that the device can move to the saved preset
   * position through the GotoPreset operation. In order to create a new preset, the SetPresetRequest contains no
   * PresetToken. If creation is successful, the Response contains the PresetToken which uniquely identifies the Preset.
   * An existing Preset can be overwritten by specifying the PresetToken of the corresponding Preset. In both cases
   * (overwriting or creation) an optional PresetName can be specified. The operation fails if the PTZ device is moving
   * during the SetPreset operation. The device MAY internally save additional states such as imaging properties in the
   * PTZ Preset which then should be recalled in the GotoPreset operation.
   *
   * @param options
   */
  async setPreset({ profileToken, presetName, presetToken }: SetPresetOptions): Promise<SetPresetResponse> {
    const [data] = await this.onvif.request({
      service: 'PTZ',
      body: `
        <SetPreset xmlns="http://www.onvif.org/ver20/ptz/wsdl">
          <ProfileToken>${profileToken ?? this.onvif.activeSource!.profileToken}</ProfileToken>
          <PresetName>${presetName}</PresetName>
          ${presetToken ? `<PresetToken>${presetToken}</PresetToken>` : ''}
        </SetPreset>
      `
    })
    return linerase(data[0].setPresetResponse)
  }

  /**
   * Operation to remove a PTZ preset for the Node in the selected profile. The operation is supported if the
   * PresetPosition capability exists for teh Node in the selected profile.
   *
   * @param options - The options for removing a preset.
   */
  async removePreset({ profileToken, presetToken }: RemovePresetOptions): Promise<void> {
    await this.onvif.request({
      service: 'PTZ',
      body: `
        <RemovePreset xmlns="http://www.onvif.org/ver20/ptz/wsdl">
          <ProfileToken>${profileToken ?? this.onvif.activeSource?.profileToken}</ProfileToken>
          <PresetToken>${presetToken}</PresetToken>
        </RemovePreset>
      `
    })
  }

  /**
   * Operation to move the PTZ device to it's "home" position. The operation is supported if the HomeSupported element
   * in the PTZNode is true.
   *
   * @param options
   */
  async gotoHomePosition({ profileToken, speed }: GotoHomePositionOptions): Promise<void> {
    await this.onvif.request({
      service: 'PTZ',
      body: `
        <GotoHomePosition xmlns="http://www.onvif.org/ver20/ptz/wsdl">
          <ProfileToken>${profileToken ?? this.onvif.activeSource?.profileToken}</ProfileToken>
          ${speed ? `<Speed>${PTZ.PTZVectorToXML(speed)}</Speed>` : ''}
        </GotoHomePosition>
      `
    })
  }

  /**
   * Operation to save current position as the home position. The SetHomePosition command returns with a failure if
   * the “home” position is fixed and cannot be overwritten. If the SetHomePosition is successful, it is possible
   * to recall the Home Position with the GotoHomePosition command.
   *
   * @param options
   */
  async setHomePosition({ profileToken }: SetHomePositionOptions): Promise<void> {
    await this.onvif.request({
      service: 'PTZ',
      body: `
        <SetHomePosition xmlns="http://www.onvif.org/ver20/ptz/wsdl">
          <ProfileToken>${profileToken ?? this.onvif.activeSource?.profileToken}</ProfileToken>
        </SetHomePosition>
      `
    })
  }

  /**
   * Operation to request PTZ status for the Node in the selected profile.
   *
   * @param options - The options for getting the PTZ status.
   */
  async getStatus({ profileToken }: GetStatusOptions = {}): Promise<PTZStatus> {
    const [data] = await this.onvif.request({
      service: 'PTZ',
      body: `
        <GetStatus xmlns="http://www.onvif.org/ver20/ptz/wsdl">
          <ProfileToken>${profileToken ?? this.onvif.activeSource?.profileToken}</ProfileToken>
        </GetStatus>
      `
    })
    return linerase(data).getStatusResponse.PTZStatus
  }

  /**
   * Operation to move pan, tilt or zoom to an absolute destination.
   *
   * The speed argument is optional. If an x/y speed value is given it is up to the device to either use the x value as
   * absolute resoluting speed vector or to map x and y to the component speed. If the speed argument is omitted, the
   * default speed set by the PTZConfiguration will be used.
   *
   * @param options
   */
  async absoluteMove({ profileToken, position, speed }: AbsoluteMoveOptions): Promise<void> {
    await this.onvif.request({
      service: 'PTZ',
      body: `
        <AbsoluteMove xmlns="http://www.onvif.org/ver20/ptz/wsdl">
          <ProfileToken>${profileToken ?? this.onvif.activeSource?.profileToken}</ProfileToken>
          <Position>${PTZ.PTZVectorToXML(position)}</Position>
          ${speed ? `<Speed>${PTZ.PTZVectorToXML(speed)}</Speed>` : ''}
        </AbsoluteMove>
      `
    })
  }

  /**
   * Operation for Relative Pan/Tilt and Zoom Move. The operation is supported if the PTZNode supports at least one
   * relative Pan/Tilt or Zoom space.
   *
   * The speed argument is optional. If an x/y speed value is given it is up to the device to either use the x value as
   * absolute resoluting speed vector or to map x and y to the component speed. If the speed argument is omitted,
   * the default speed set by the PTZConfiguration will be used.
   *
   * @param options
   */
  async relativeMove({ profileToken, translation, speed }: RelativeMoveOptions): Promise<void> {
    await this.onvif.request({
      service: 'PTZ',
      body: `
        <RelativeMove xmlns="http://www.onvif.org/ver20/ptz/wsdl">
          <ProfileToken>${profileToken ?? this.onvif.activeSource?.profileToken}</ProfileToken>
          <Translation>${PTZ.PTZVectorToXML(translation)}</Translation>
          ${speed ? `<Speed>${PTZ.PTZVectorToXML(speed)}</Speed>` : ''}
        </RelativeMove>
      `
    })
  }

  /**
   * Operation for continuous Pan/Tilt and Zoom movements. The operation is supported if the PTZNode supports at least
   * one continuous Pan/Tilt or Zoom space. If the space argument is omitted, the default space set by the
   * PTZConfiguration will be used.
   *
   * @param options - The options for continuous move.
   */
  async continuousMove({ profileToken, velocity, timeout }: ContinuousMoveOptions): Promise<void> {
    await this.onvif.request({
      service: 'PTZ',
      body: `
        <ContinuousMove xmlns="http://www.onvif.org/ver20/ptz/wsdl">
          <ProfileToken>${profileToken ?? this.onvif.activeSource?.profileToken}</ProfileToken>
          <Velocity>${PTZ.PTZVectorToXML(velocity)}</Velocity>
          ${timeout ? `<Timeout>${typeof timeout === 'number' ? `PT${timeout / 1000}S` : timeout}</Timeout>` : ''}
        </ContinuousMove>
      `
    })
  }

  /**
   * Operation to stop ongoing pan, tilt and zoom movements of absolute relative and continuous type. If no stop
   * argument for pan, tilt or zoom is set, the device will stop all ongoing pan, tilt and zoom movements.
   *
   * @param options - The options for stopping PTZ movements.
   */
  async stop({ profileToken, panTilt = true, zoom = true }: StopOptions = {}): Promise<void> {
    await this.onvif.request({
      service: 'PTZ',
      body: `
        <Stop xmlns="http://www.onvif.org/ver20/ptz/wsdl">
          <ProfileToken>${profileToken ?? this.onvif.activeSource?.profileToken}</ProfileToken>
          <PanTilt>${panTilt}</PanTilt>
          <Zoom>${zoom}</Zoom>
        </Stop>
      `
    })
  }
}
