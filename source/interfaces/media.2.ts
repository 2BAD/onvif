import type { AnyURI } from './basics.ts'
import type { Color, Polygon, ReferenceToken } from './common.ts'
import type {
  AudioDecoderConfiguration,
  AudioEncoder2Configuration,
  AudioEncoder2ConfigurationOptions,
  AudioOutputConfiguration,
  AudioOutputConfigurationOptions,
  AudioSourceConfiguration,
  AudioSourceConfigurationOptions,
  ColorOptions,
  Description,
  MetadataConfiguration,
  MetadataConfigurationOptions,
  Name,
  OSDConfiguration,
  OSDConfigurationOptions,
  PTZConfiguration,
  ReceiverConfiguration,
  StringAttrList,
  StringList,
  VideoAnalyticsConfiguration,
  VideoEncoder2Configuration,
  VideoEncoder2ConfigurationOptions,
  VideoResolution,
  VideoSourceConfiguration,
  VideoSourceConfigurationOptions
} from './onvif.ts'

export type ConfigurationEnumeration =
  | 'All'
  | 'VideoSource'
  | 'VideoEncoder'
  | 'AudioSource'
  | 'AudioEncoder'
  | 'AudioOutput'
  | 'AudioDecoder'
  | 'Metadata'
  | 'Analytics'
  | 'PTZ'
  | 'Receiver'
export type TransportProtocol =
  | 'RtspUnicast'
  | 'RtspMulticast'
  | 'RtspsUnicast'
  | 'RtspsMulticast'
  | 'RTSP'
  | 'RtspOverHttp'
export type MaskType = 'Color' | 'Pixelated' | 'Blurred'
export type Capabilities2 = {
  /** Indicates if GetSnapshotUri is supported. */
  snapshotUri?: boolean
  /** Indicates whether or not Rotation feature is supported. */
  rotation?: boolean
  /** Indicates the support for changing video source mode. */
  videoSourceMode?: boolean
  /** Indicates if OSD is supported. */
  OSD?: boolean
  /** Indicates the support for temporary osd text configuration. */
  temporaryOSDText?: boolean
  /** Indicates if Masking is supported. */
  mask?: boolean
  /**
   * Indicates that privacy masks are only supported at the video source level and not the video source configuration level.
   * If this is true any addition, deletion or change of a privacy mask done for one video source configuration will automatically be
   * applied by the device to a corresponding privacy mask for all other video source configuration associated with the same video source.
   */
  sourceMask?: boolean
  /** Indicates number of supported WebRTC configurations. */
  webRTC?: number
  /** Media profile capabilities. */
  profileCapabilities?: ProfileCapabilities
  /** Streaming capabilities. */
  streamingCapabilities?: StreamingCapabilities
}
export type ProfileCapabilities = {
  /** Maximum number of profiles supported. */
  maximumNumberOfProfiles?: number
  /** The configurations supported by the device as defined by tr2:ConfigurationEnumeration. The enumeration value "All" shall not be included in this list. */
  configurationsSupported?: StringAttrList
}
export type StreamingCapabilities = {
  /** Indicates support for live media streaming via RTSP. */
  RTSPStreaming?: boolean
  /** Indicates support for RTP multicast. */
  RTPMulticast?: boolean
  /** Indicates support for RTP/RTSP/TCP. */
  RTP_RTSP_TCP?: boolean
  /** Indicates support for non aggregate RTSP control. */
  nonAggregateControl?: boolean
  /** If streaming over WebSocket is supported, this shall return the RTSP WebSocket URI as described in Streaming Specification Section 5.1.1.5. */
  RTSPWebSocketUri?: AnyURI
  /** Indicates support for non-RTSP controlled multicast streaming. */
  autoStartMulticast?: boolean
  /** Indicates support for live media streaming via RTSPS and SRTP. */
  secureRTSPStreaming?: boolean
}
export type ConfigurationRef = {
  /** Type of the configuration as defined by tr2:ConfigurationEnumeration. */
  type?: string
  /**
   * Reference token of an existing configuration.
   * Token shall be included in the AddConfiguration request along with the type.
   * Token shall be included in the CreateProfile request when Configuration elements are included and type is selected.
   * Token is optional for RemoveConfiguration request. If no token is provided in RemoveConfiguration request, device shall
   * remove the configuration of the type included in the profile.
   */
  token?: ReferenceToken
}
/** A set of media configurations. */
export type ConfigurationSet = {
  /** Optional configuration of the Video input. */
  videoSource?: VideoSourceConfiguration
  /** Optional configuration of the Audio input. */
  audioSource?: AudioSourceConfiguration
  /** Optional configuration of the Video encoder. */
  videoEncoder?: VideoEncoder2Configuration
  /** Optional configuration of the Audio encoder. */
  audioEncoder?: AudioEncoder2Configuration
  /** Optional configuration of the analytics module and rule engine. */
  analytics?: VideoAnalyticsConfiguration
  /** Optional configuration of the pan tilt zoom unit. */
  PTZ?: PTZConfiguration
  /** Optional configuration of the metadata stream. */
  metadata?: MetadataConfiguration
  /** Optional configuration of the Audio output. */
  audioOutput?: AudioOutputConfiguration
  /** Optional configuration of the Audio decoder. */
  audioDecoder?: AudioDecoderConfiguration
  /** Optional configuration of the Receiver. */
  receiver?: ReceiverConfiguration
}
/** A media profile consists of a set of media configurations. */
export type MediaProfile = {
  /** Unique identifier of the profile. */
  token: ReferenceToken
  /** A value of true signals that the profile cannot be deleted. Default is false. */
  fixed?: boolean
  /** User readable name of the profile. */
  name?: Name
  /** The configurations assigned to the profile. */
  configurations?: ConfigurationSet
}
export type GetConfiguration = {
  /** Token of the requested configuration. */
  configurationToken?: ReferenceToken
  /** Contains the token of an existing media profile the configurations shall be compatible with. */
  profileToken?: ReferenceToken
}
export type SetConfigurationResponse = Record<string, unknown>
export type EncoderInstance = {
  /** Video Media Subtype for the video format. For definitions see tt:VideoEncodingMimeNames and  IANA Media Types. */
  encoding?: string
  /** The minimum guaranteed number of encoder instances (applications) for the VideoSourceConfiguration. */
  number?: number
}
export type EncoderInstanceInfo = {
  /** If a device limits the number of instances for respective Video Codecs the response contains the information how many streams can be set up at the same time per VideoSource. */
  codec?: EncoderInstance[]
  /** The minimum guaranteed total number of encoder instances (applications) per VideoSourceConfiguration. The device is able to deliver the Total number of streams */
  total?: number
}
export type StartStopMulticastStreaming = {
  /** Contains the token of the Profile that is used to define the multicast stream. */
  profileToken?: ReferenceToken
}
export type VideoSourceMode = {
  /** Indicate token for video source mode. */
  token: ReferenceToken
  /** Indication of whether this mode is active. If active this value is true. In case of non-indication, it means as false. The value of true shall be had by only one video source mode. */
  enabled?: boolean
  /** Max frame rate in frames per second for this video source mode. */
  maxFramerate?: number
  /** Max horizontal and vertical resolution for this video source mode. */
  maxResolution?: VideoResolution
  /** List of one or more encodings supported for this video source.  For name definitions see tt:VideoEncodingMimeNames, and see IANA Media Types. */
  encodings?: StringList
  /** After setting the mode if a device starts to reboot this value is true. If a device change the mode without rebooting this value is false. If true, configured parameters may not be guaranteed by the device after rebooting. */
  reboot?: boolean
  /** Informative description of this video source mode. This field should be described in English. */
  description?: Description
}
export type Mask = {
  /** Token of the mask. */
  token?: ReferenceToken
  /** Token of the VideoSourceConfiguration the Mask is associated with. */
  configurationToken?: ReferenceToken
  /** Geometric representation of the mask area. */
  polygon?: Polygon
  /**
   * Type of masking as defined by tr2:MaskType:
   *
   * Color - The masked area is colored with color defined by the Color field.
   * Pixelated - The masked area is filled in mosaic style to hide details.
   * Blurred - The masked area is low pass filtered to hide details.
   *
   */
  type?: string
  /** Color of the masked area. */
  color?: Color
  /** If set the mask will cover the image, otherwise it will be fully transparent. */
  enabled?: boolean
}
export type MaskOptions = {
  /** Information whether the polygon must have four points and a rectangular shape. */
  rectangleOnly?: boolean
  /** Indicates the device capability of change in color of privacy mask for one video source configuration will automatically be applied to all the privacy masks associated with the same video source configuration. */
  singleColorOnly?: boolean
  /** Maximum supported number of masks per VideoSourceConfiguration. */
  maxMasks?: number
  /** Maximum supported number of points per mask. */
  maxPoints?: number
  /** Information which types of tr2:MaskType are supported. Valid values are 'Color', 'Pixelated' and 'Blurred'. */
  types?: string[]
  /** Colors supported. */
  color?: ColorOptions
}
export type WebRTCConfiguration = {
  /** The signaling server URI. */
  signalingServer?: AnyURI
  /** The CertPathValidationPolicyID for validating the signaling server certificate. */
  certPathValidationPolicyID?: string
  /** The Authorization Server to use for getting access tokens. This refers to an entity in the list of configured Authorization Servers in the [ONVIF Security Service Specification]. */
  authorizationServer?: ReferenceToken
  /** The default media profile to use for streaming if no specific profile is specified when initializing a session. */
  defaultProfile?: ReferenceToken
  /** Enables/disables the configuration. */
  enabled?: boolean
  /** Indicates if the device is connected to the server. This parameter is read-only. */
  connected?: boolean
  /** Optional user readable error information (readonly). */
  error?: string
}
export type GetServiceCapabilities = Record<string, unknown>
export type GetServiceCapabilitiesResponse = {
  /** The capabilities for the media service is returned in the Capabilities element. */
  capabilities?: Capabilities2
}
export type Capabilities = Record<string, unknown> & Capabilities2
export type CreateProfile = {
  /** friendly name of the profile to be created */
  name?: Name
  /** Optional set of configurations to be assigned to the profile. List entries with tr2:ConfigurationEnumeration value "All" shall be ignored. */
  configuration?: ConfigurationRef[]
}
export type CreateProfileResponse = {
  /** Token assigned by the device for the newly created profile. */
  token?: ReferenceToken
}
export type GetProfiles = {
  /** Optional token of the requested profile. */
  token?: ReferenceToken
  /** The types shall be provided as defined by tr2:ConfigurationEnumeration. */
  type?: string[]
}
export type GetProfilesResponse = {
  /**
   * Lists all profiles that exist in the media service. The response provides the requested types of Configurations as far as available.
   * If a profile doesn't contain a type no error shall be provided.
   */
  profiles?: MediaProfile[]
}
export type AddConfiguration = {
  /** Reference to the profile where the configuration should be added */
  profileToken?: ReferenceToken
  /** Optional item. If present updates the Name property of the profile. */
  name?: Name
  /** List of configurations to be added. The types shall be provided in the order defined by tr2:ConfigurationEnumeration. List entries with tr2:ConfigurationEnumeration value "All" shall be ignored. */
  configuration?: ConfigurationRef[]
}
export type AddConfigurationResponse = Record<string, unknown>
export type RemoveConfiguration = {
  /** This element contains a  reference to the media profile from which the configuration shall be removed. */
  profileToken?: ReferenceToken
  /** List of configurations to be removed. The types shall be provided in the order defined by tr2:ConfigurationEnumeration. Tokens appearing in the configuration list shall be ignored. Presence of the "All" type shall result in an empty profile. */
  configuration?: ConfigurationRef[]
}
export type RemoveConfigurationResponse = Record<string, unknown>
export type DeleteProfile = {
  /** This element contains a  reference to the profile that should be deleted. */
  token?: ReferenceToken
}
export type DeleteProfileResponse = Record<string, unknown>
export type GetVideoEncoderConfigurations = Record<string, unknown> & GetConfiguration
export type GetVideoEncoderConfigurationsResponse = {
  /** This element contains a list of video encoder configurations. */
  configurations?: VideoEncoder2Configuration[]
}
export type GetVideoSourceConfigurations = Record<string, unknown> & GetConfiguration
export type GetVideoSourceConfigurationsResponse = {
  /** This element contains a list of video source configurations. */
  configurations?: VideoSourceConfiguration[]
}
export type GetAudioEncoderConfigurations = Record<string, unknown> & GetConfiguration
export type GetAudioEncoderConfigurationsResponse = {
  /** This element contains a list of audio encoder configurations. */
  configurations?: AudioEncoder2Configuration[]
}
export type GetAudioSourceConfigurations = Record<string, unknown> & GetConfiguration
export type GetAudioSourceConfigurationsResponse = {
  /** This element contains a list of audio source configurations. */
  configurations?: AudioSourceConfiguration[]
}
export type GetAnalyticsConfigurations = Record<string, unknown> & GetConfiguration
export type GetAnalyticsConfigurationsResponse = {
  /** This element contains a list of Analytics configurations. */
  configurations?: VideoAnalyticsConfiguration[]
}
export type GetMetadataConfigurations = Record<string, unknown> & GetConfiguration
export type GetMetadataConfigurationsResponse = {
  /** This element contains a list of metadata configurations */
  configurations?: MetadataConfiguration[]
}
export type GetAudioOutputConfigurations = Record<string, unknown> & GetConfiguration
export type GetAudioOutputConfigurationsResponse = {
  /** This element contains a list of audio output configurations */
  configurations?: AudioOutputConfiguration[]
}
export type GetAudioDecoderConfigurations = Record<string, unknown> & GetConfiguration
export type GetAudioDecoderConfigurationsResponse = {
  /** This element contains a list of audio decoder configurations */
  configurations?: AudioDecoderConfiguration[]
}
export type SetVideoEncoderConfiguration = {
  /** Contains the modified video encoder configuration. The configuration shall exist in the device. */
  configuration?: VideoEncoder2Configuration
}
export type SetVideoEncoderConfigurationResponse = Record<string, unknown> & SetConfigurationResponse
export type SetVideoSourceConfiguration = {
  /** Contains the modified video source configuration. The configuration shall exist in the device. */
  configuration?: VideoSourceConfiguration
}
export type SetVideoSourceConfigurationResponse = Record<string, unknown> & SetConfigurationResponse
export type SetAudioEncoderConfiguration = {
  /** Contains the modified audio encoder configuration. The configuration shall exist in the device. */
  configuration?: AudioEncoder2Configuration
}
export type SetAudioEncoderConfigurationResponse = Record<string, unknown> & SetConfigurationResponse
export type SetAudioSourceConfiguration = {
  /** Contains the modified audio source configuration. The configuration shall exist in the device. */
  configuration?: AudioSourceConfiguration
}
export type SetAudioSourceConfigurationResponse = Record<string, unknown> & SetConfigurationResponse
export type SetMetadataConfiguration = {
  /** Contains the modified metadata configuration. The configuration shall exist in the device. */
  configuration?: MetadataConfiguration
}
export type SetMetadataConfigurationResponse = Record<string, unknown> & SetConfigurationResponse
export type SetAudioOutputConfiguration = {
  /** Contains the modified audio output configuration. The configuration shall exist in the device. */
  configuration?: AudioOutputConfiguration
}
export type SetAudioOutputConfigurationResponse = Record<string, unknown> & SetConfigurationResponse
export type SetAudioDecoderConfiguration = {
  /** Contains the modified audio decoder configuration. The configuration shall exist in the device. */
  configuration?: AudioDecoderConfiguration
}
export type SetAudioDecoderConfigurationResponse = Record<string, unknown> & SetConfigurationResponse
export type GetVideoSourceConfigurationOptions = Record<string, unknown> & GetConfiguration
export type GetVideoSourceConfigurationOptionsResponse = {
  /** This message contains the video source configuration options. If a video source configuration is specified, the options shall concern that particular configuration. If a media profile is specified, the options shall be compatible with that media profile. If no tokens are specified, the options shall be considered generic for the device. */
  options?: VideoSourceConfigurationOptions
}
export type GetVideoEncoderConfigurationOptions = Record<string, unknown> & GetConfiguration
export type GetVideoEncoderConfigurationOptionsResponse = {
  options?: VideoEncoder2ConfigurationOptions[]
}
export type GetAudioSourceConfigurationOptions = Record<string, unknown> & GetConfiguration
export type GetAudioSourceConfigurationOptionsResponse = {
  /** This message contains the audio source configuration options. If a audio source configuration is specified, the options shall concern that particular configuration. If a media profile is specified, the options shall be compatible with that media profile. If no tokens are specified, the options shall be considered generic for the device. */
  options?: AudioSourceConfigurationOptions
}
export type GetAudioEncoderConfigurationOptions = Record<string, unknown> & GetConfiguration
export type GetAudioEncoderConfigurationOptionsResponse = {
  /** This message contains the audio encoder configuration options. If a audio encoder configuration is specified, the options shall concern that particular configuration. If a media profile is specified, the options shall be compatible with that media profile. If no tokens are specified, the options shall be considered generic for the device. */
  options?: AudioEncoder2ConfigurationOptions[]
}
export type GetMetadataConfigurationOptions = Record<string, unknown> & GetConfiguration
export type GetMetadataConfigurationOptionsResponse = {
  /** This message contains the metadata configuration options. If a metadata configuration is specified, the options shall concern that particular configuration. If a media profile is specified, the options shall be compatible with that media profile. If no tokens are specified, the options shall be considered generic for the device. */
  options?: MetadataConfigurationOptions
}
export type GetAudioOutputConfigurationOptions = Record<string, unknown> & GetConfiguration
export type GetAudioOutputConfigurationOptionsResponse = {
  /** This message contains the audio output configuration options. If a audio output configuration is specified, the options shall concern that particular configuration. If a media profile is specified, the options shall be compatible with that media profile. If no tokens are specified, the options shall be considered generic for the device. */
  options?: AudioOutputConfigurationOptions
}
export type GetAudioDecoderConfigurationOptions = Record<string, unknown> & GetConfiguration
export type GetAudioDecoderConfigurationOptionsResponse = {
  /** This message contains the audio decoder configuration options. If a audio decoder configuration is specified, the options shall concern that particular configuration. If a media profile is specified, the options shall be compatible with that media profile. If no tokens are specified, the options shall be considered generic for the device. */
  options?: AudioEncoder2ConfigurationOptions[]
}
export type GetVideoEncoderInstances = {
  /** Token of the video source configuration */
  configurationToken?: ReferenceToken
}
export type GetVideoEncoderInstancesResponse = {
  /** The minimum guaranteed total number of encoder instances (applications) per VideoSourceConfiguration. */
  info?: EncoderInstanceInfo
}
export type GetStreamUri = {
  /** Defines the network protocol for streaming as defined by tr2:TransportProtocol */
  protocol?: string
  /** The ProfileToken element indicates the media profile to use and will define the configuration of the content of the stream. */
  profileToken?: ReferenceToken
}
export type GetStreamUriResponse = {
  /** Stable Uri to be used for requesting the media stream */
  uri?: AnyURI
}
export type SetSynchronizationPoint = {
  /** Contains a Profile reference for which a Synchronization Point is requested. */
  profileToken?: ReferenceToken
}
export type SetSynchronizationPointResponse = Record<string, unknown>
export type GetSnapshotUri = {
  /** The ProfileToken element indicates the media profile to use and will define the source and dimensions of the snapshot. */
  profileToken?: ReferenceToken
}
export type GetSnapshotUriResponse = {
  /** Stable Uri to be used for requesting snapshot images. */
  uri?: AnyURI
}
export type StartMulticastStreaming = Record<string, unknown> & StartStopMulticastStreaming
export type StartMulticastStreamingResponse = Record<string, unknown> & SetConfigurationResponse
export type StopMulticastStreaming = Record<string, unknown> & StartStopMulticastStreaming
export type StopMulticastStreamingResponse = Record<string, unknown> & SetConfigurationResponse
export type GetVideoSourceModes = {
  /** Contains a video source reference for which a video source mode is requested. */
  videoSourceToken?: ReferenceToken
}
export type GetVideoSourceModesResponse = {
  /** Return the information for specified video source mode. */
  videoSourceModes?: VideoSourceMode[]
}
export type SetVideoSourceMode = {
  /** Contains a video source reference for which a video source mode is requested. */
  videoSourceToken?: ReferenceToken
  /** Indicate video source mode. */
  videoSourceModeToken?: ReferenceToken
}
export type SetVideoSourceModeResponse = {
  /** The response contains information about rebooting after returning response. When Reboot is set true, a device will reboot automatically after setting mode. */
  reboot?: boolean
}
export type GetOSDs = {
  /** The GetOSDs command fetches the OSD configuration if the OSD token is known. */
  OSDToken?: ReferenceToken
  /** Token of the Video Source Configuration, which has OSDs associated with are requested. If token not exist, request all available OSDs. */
  configurationToken?: ReferenceToken
}
export type GetOSDsResponse = {
  /** This element contains a list of requested OSDs. */
  OSDs?: OSDConfiguration[]
}
export type SetOSD = {
  /** Contains the modified OSD configuration. */
  OSD?: OSDConfiguration
}
export type SetOSDResponse = Record<string, unknown> & SetConfigurationResponse
export type GetOSDOptions = {
  /** Video Source Configuration Token that specifies an existing video source configuration that the options shall be compatible with. */
  configurationToken?: ReferenceToken
}
export type GetOSDOptionsResponse = {
  /**/
  OSDOptions?: OSDConfigurationOptions
}
export type CreateOSD = {
  /** Contain the initial OSD configuration for create. */
  OSD?: OSDConfiguration
}
export type CreateOSDResponse = {
  /** Returns Token of the newly created OSD */
  OSDToken?: ReferenceToken
}
export type DeleteOSD = {
  /** This element contains a reference to the OSD configuration that should be deleted. */
  OSDToken?: ReferenceToken
}
export type DeleteOSDResponse = Record<string, unknown> & SetConfigurationResponse
export type GetMasks = {
  /** Optional mask token of an existing mask. */
  token?: ReferenceToken
  /** Optional token of a Video Source Configuration. */
  configurationToken?: ReferenceToken
}
export type GetMasksResponse = {
  /** List of Mask configurations. */
  masks?: Mask[]
}
export type SetMask = {
  /** Mask to be updated. */
  mask?: Mask
}
export type SetMaskResponse = Record<string, unknown> & SetConfigurationResponse
export type GetMaskOptions = {
  /** Video Source Configuration Token that specifies an existing video source configuration that the options shall be compatible with. */
  configurationToken?: ReferenceToken
}
export type GetMaskOptionsResponse = {
  /**/
  options?: MaskOptions
}
export type CreateMask = {
  /** Contain the initial mask configuration for create. */
  mask?: Mask
}
export type CreateMaskResponse = {
  /** Returns Token of the newly created Mask */
  token?: ReferenceToken
}
export type DeleteMask = {
  /** This element contains a reference to the Mask configuration that should be deleted. */
  token?: ReferenceToken
}
export type DeleteMaskResponse = Record<string, unknown> & SetConfigurationResponse
export type GetWebRTCConfigurations = Record<string, unknown>
export type GetWebRTCConfigurationsResponse = {
  /** Video Source Configuration Token that specifies an existing video source configuration that the options shall be compatible with. */
  webRTCConfiguration?: WebRTCConfiguration[]
}
export type SetWebRTCConfigurations = {
  /** Video Source Configuration Token that specifies an existing video source configuration that the options shall be compatible with. */
  webRTCConfiguration?: WebRTCConfiguration[]
}
export type SetWebRTCConfigurationsResponse = Record<string, unknown>
