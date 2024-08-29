import type { ReferenceToken } from './common.ts'
import type {
  AudioOutputConfiguration,
  AudioOutputConfigurationOptions,
  AudioSourceConfiguration,
  AudioSourceConfigurationOptions,
  Capabilities,
  DeviceEntity,
  DigitalIdleState,
  DigitalInput,
  FloatItems,
  FloatList,
  IntItems,
  RelayMode,
  RelayOutput,
  VideoOutput,
  VideoOutputConfiguration,
  VideoOutputConfigurationOptions,
  VideoSourceConfiguration,
  VideoSourceConfigurationOptions
} from './onvif.ts'

/** The type of serial port.Generic can be signaled as a vendor specific serial port type. */
export type SerialPortType =
  | 'RS232'
  | 'RS422HalfDuplex'
  | 'RS422FullDuplex'
  | 'RS485HalfDuplex'
  | 'RS485FullDuplex'
  | 'Generic'
/** The parity for the data error detection. */
export type ParityBit = 'None' | 'Even' | 'Odd' | 'Mark' | 'Space' | 'Extended'
export type RelayOutputOptions = {
  /** Token of the relay output. */
  token: ReferenceToken
  /** Supported Modes. */
  mode?: RelayMode[]
  /** Supported delay time range or discrete values in seconds. This element must be present if MonoStable mode is supported. */
  delayTimes?: FloatList
  /** True if the relay only supports the exact values for the DelayTimes listed. Default is false. */
  discrete?: boolean
  extension?: RelayOutputOptionsExtension
}
export type RelayOutputOptionsExtension = Record<string, unknown>
export type Get = Record<string, unknown>
export type GetResponse = {
  /** List tokens of a physical IO of a device. */
  token?: ReferenceToken[]
}
export type DigitalInputConfigurationOptions = {
  /** Configuration Options for a digital input. */
  idleState?: DigitalIdleState[]
}
/** The serial port data. */
export type SerialData = Record<string, unknown>
/** Lists all available serial ports of a device */
export type SerialPort = Record<string, unknown> & DeviceEntity
/** The parameters for configuring the serial port. */
export type SerialPortConfiguration = {
  token: ReferenceToken
  type: SerialPortType
  /** The transfer bitrate. */
  baudRate?: number
  /** The parity for the data error detection. */
  parityBit?: ParityBit
  /** The bit length for each character. */
  characterLength?: number
  /** The number of stop bits used to terminate each character. */
  stopBit?: number
}
/** The configuration options that relates to serial port. */
export type SerialPortConfigurationOptions = {
  token: ReferenceToken
  /** The list of configurable transfer bitrate. */
  baudRateList?: IntItems
  /** The list of configurable parity for the data error detection. */
  parityBitList?: ParityBitList
  /** The list of configurable bit length for each character. */
  characterLengthList?: IntItems
  /** The list of configurable number of stop bits used to terminate each character. */
  stopBitList?: FloatItems
}
/** The list of configurable parity for the data error detection. */
export type ParityBitList = {
  items?: ParityBit[]
}
export type GetServiceCapabilities = Record<string, unknown>
export type GetServiceCapabilitiesResponse = {
  /** The capabilities for the device IO service is returned in the Capabilities element. */
  capabilities?: Capabilities
}
export type GetRelayOutputOptions = {
  /** Optional reference token to the relay for which the options are requested. */
  relayOutputToken?: ReferenceToken
}
export type GetRelayOutputOptionsResponse = {
  /** Valid values and ranges for the configuration of a relay output. */
  relayOutputOptions?: RelayOutputOptions[]
}
export type GetVideoOutputs = Record<string, unknown>
export type GetVideoOutputsResponse = {
  /** List containing all physical Video output connections of a device. */
  videoOutputs?: VideoOutput[]
}
export type GetAudioSourceConfiguration = {
  /** Token of the requested AudioSource. */
  audioSourceToken?: ReferenceToken
}
export type GetAudioSourceConfigurationResponse = {
  /** Current configuration of the Audio input. */
  audioSourceConfiguration?: AudioSourceConfiguration
}
export type GetAudioOutputConfiguration = {
  /** Token of the physical Audio output. */
  audioOutputToken?: ReferenceToken
}
export type GetAudioOutputConfigurationResponse = {
  /** Current configuration of the Audio output. */
  audioOutputConfiguration?: AudioOutputConfiguration
}
export type GetVideoSourceConfiguration = {
  /** Token of the requested VideoSource. */
  videoSourceToken?: ReferenceToken
}
export type GetVideoSourceConfigurationResponse = {
  /** Current configuration of the Video input. */
  videoSourceConfiguration?: VideoSourceConfiguration
}
export type GetVideoOutputConfiguration = {
  /** Token of the requested VideoOutput. */
  videoOutputToken?: ReferenceToken
}
export type GetVideoOutputConfigurationResponse = {
  /** Current configuration of the Video output. */
  videoOutputConfiguration?: VideoOutputConfiguration
}
export type SetAudioSourceConfiguration = {
  configuration?: AudioSourceConfiguration
  /**
   * The ForcePersistence element determines how configuration
   * changes shall be stored. If true, changes shall be persistent. If false, changes MAY revert to previous values
   * after reboot.
   */
  forcePersistence?: boolean
}
export type SetAudioSourceConfigurationResponse = Record<string, unknown>
export type SetAudioOutputConfiguration = {
  configuration?: AudioOutputConfiguration
  /**
   * The ForcePersistence element determines how configuration
   * changes shall be stored. If true, changes shall be persistent. If false, changes MAY revert to previous values
   * after reboot.
   */
  forcePersistence?: boolean
}
export type SetAudioOutputConfigurationResponse = Record<string, unknown>
export type SetVideoSourceConfiguration = {
  configuration?: VideoSourceConfiguration
  /**
   * The ForcePersistence element determines how configuration
   * changes shall be stored. If true, changes shall be persistent. If false, changes MAY revert to previous values
   * after reboot.
   */
  forcePersistence?: boolean
}
export type SetVideoSourceConfigurationResponse = Record<string, unknown>
export type SetVideoOutputConfiguration = {
  configuration?: VideoOutputConfiguration
  /**
   * The ForcePersistence element determines how configuration
   * changes shall be stored. If true, changes shall be persistent. If false, changes MAY revert to previous values
   * after reboot.
   */
  forcePersistence?: boolean
}
export type SetVideoOutputConfigurationResponse = Record<string, unknown>
export type GetVideoSourceConfigurationOptions = {
  /** Token of the Video input whose options are requested.. */
  videoSourceToken?: ReferenceToken
}
export type GetVideoSourceConfigurationOptionsResponse = {
  videoSourceConfigurationOptions?: VideoSourceConfigurationOptions
}
export type GetVideoOutputConfigurationOptions = {
  /** Token of the Video Output whose options are requested.. */
  videoOutputToken?: ReferenceToken
}
export type GetVideoOutputConfigurationOptionsResponse = {
  videoOutputConfigurationOptions?: VideoOutputConfigurationOptions
}
export type GetAudioSourceConfigurationOptions = {
  /** Token of the physical Audio input whose options are requested.. */
  audioSourceToken?: ReferenceToken
}
export type GetAudioSourceConfigurationOptionsResponse = {
  /** Returns the AudioSourceToken available. */
  audioSourceOptions?: AudioSourceConfigurationOptions
}
export type GetAudioOutputConfigurationOptions = {
  /** Token of the physical Audio Output whose options are requested.. */
  audioOutputToken?: ReferenceToken
}
export type GetAudioOutputConfigurationOptionsResponse = {
  /** Available settings and ranges for the requested Audio output. */
  audioOutputOptions?: AudioOutputConfigurationOptions
}
export type SetRelayOutputSettings = {
  relayOutput?: RelayOutput
}
export type SetRelayOutputSettingsResponse = Record<string, unknown>
export type GetDigitalInputs = Record<string, unknown>
export type GetDigitalInputsResponse = {
  digitalInputs?: DigitalInput[]
}
export type GetDigitalInputConfigurationOptions = {
  token?: ReferenceToken
}
export type GetDigitalInputConfigurationOptionsResponse = {
  digitalInputOptions?: DigitalInputConfigurationOptions
}
export type SetDigitalInputConfigurations = {
  digitalInputs?: DigitalInput[]
}
export type SetDigitalInputConfigurationsResponse = Record<string, unknown>
export type GetSerialPorts = Record<string, unknown>
export type GetSerialPortsResponse = {
  serialPort?: SerialPort[]
}
export type GetSerialPortConfiguration = {
  serialPortToken?: ReferenceToken
}
export type GetSerialPortConfigurationResponse = {
  serialPortConfiguration?: SerialPortConfiguration
}
export type SetSerialPortConfiguration = {
  serialPortConfiguration?: SerialPortConfiguration
  forcePersistance?: boolean
}
export type SetSerialPortConfigurationResponse = Record<string, unknown>
export type GetSerialPortConfigurationOptions = {
  serialPortToken?: ReferenceToken
}
export type GetSerialPortConfigurationOptionsResponse = {
  serialPortOptions?: SerialPortConfigurationOptions
}
export type SendReceiveSerialCommand = {
  /** The physical serial port reference to be used when this request is invoked. */
  token?: ReferenceToken
  /** The serial port data. */
  serialData?: SerialData
  /** Indicates that the command should be responded back within the specified period of time. */
  timeOut?: unknown
  /** This element may be put in the case that data length returned from the connected serial device is already determined as some fixed bytes length. It indicates the length of received data which can be regarded as available. */
  dataLength?: number
  /** This element may be put in the case that the delimiter codes returned from the connected serial device is already known. It indicates the termination data sequence of the responded data. In case the string has more than one character a device shall interpret the whole string as a single delimiter. Furthermore a device shall return the delimiter character(s) to the client. */
  delimiter?: string
}
export type SendReceiveSerialCommandResponse = {
  serialData?: SerialData
}
