import type { ReferenceToken } from './common.ts'
import type {
  AudioDecoderConfiguration,
  AudioDecoderConfigurationOptions,
  AudioEncoderConfiguration,
  AudioEncoderConfigurationOptions,
  AudioOutput,
  AudioOutputConfiguration,
  AudioOutputConfigurationOptions,
  AudioSource,
  AudioSourceConfiguration,
  AudioSourceConfigurationOptions,
  Description,
  MediaUri,
  MetadataConfiguration,
  MetadataConfigurationOptions,
  Name,
  OSDConfiguration,
  OSDConfigurationOptions,
  Profile,
  StreamSetup,
  StringList,
  VideoAnalyticsConfiguration,
  VideoEncoderConfiguration,
  VideoEncoderConfigurationOptions,
  VideoResolution,
  VideoSource,
  VideoSourceConfiguration,
  VideoSourceConfigurationOptions
} from './onvif.ts'

export type Capabilities = {
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
  /** Indicates the support for the Efficient XML Interchange (EXI) binary XML format. */
  EXICompression?: boolean
  /** Media profile capabilities. */
  profileCapabilities?: ProfileCapabilities
  /** Streaming capabilities. */
  streamingCapabilities?: StreamingCapabilities
}
export type ProfileCapabilities = {
  /** Maximum number of profiles supported. */
  maximumNumberOfProfiles?: number
}
export type StreamingCapabilities = {
  /** Indicates support for RTP multicast. */
  RTPMulticast?: boolean
  /** Indicates support for RTP over TCP. */
  RTP_TCP?: boolean
  /** Indicates support for RTP/RTSP/TCP. */
  RTP_RTSP_TCP?: boolean
  /** Indicates support for non aggregate RTSP control. */
  nonAggregateControl?: boolean
  /** Indicates the device does not support live media streaming via RTSP. */
  noRTSPStreaming?: boolean
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
  /** Indication which encodings are supported for this video source. The list may contain one or more enumeration values of tt:VideoEncoding. */
  encodings?: StringList
  /** After setting the mode if a device starts to reboot this value is true. If a device change the mode without rebooting this value is false. If true, configured parameters may not be guaranteed by the device after rebooting. */
  reboot?: boolean
  /** Informative description of this video source mode. This field should be described in English. */
  description?: Description
  extension?: VideoSourceModeExtension
}
export type VideoSourceModeExtension = Record<string, unknown>
export type GetServiceCapabilities = Record<string, unknown>
export type GetServiceCapabilitiesResponse = {
  /** The capabilities for the media service is returned in the Capabilities element. */
  capabilities?: Capabilities
}
export type GetVideoSources = Record<string, unknown>
export type GetVideoSourcesResponse = {
  /** List of existing Video Sources */
  videoSources?: VideoSource[]
}
export type GetAudioSources = Record<string, unknown>
export type GetAudioSourcesResponse = {
  /** List of existing Audio Sources */
  audioSources?: AudioSource[]
}
export type GetAudioOutputs = Record<string, unknown>
export type GetAudioOutputsResponse = {
  /** List of existing Audio Outputs */
  audioOutputs?: AudioOutput[]
}
export type CreateProfile = {
  /** friendly name of the profile to be created */
  name?: Name
  /** Optional token, specifying the unique identifier of the new profile. A device supports at least a token length of 12 characters and characters "A-Z" | "a-z" | "0-9" | "-.". */
  token?: ReferenceToken
}
export type CreateProfileResponse = {
  /** returns the new created profile */
  profile?: Profile
}
export type GetProfile = {
  /** this command requests a specific profile */
  profileToken?: ReferenceToken
}
export type GetProfileResponse = {
  /** returns the requested media profile */
  profile?: Profile
}
export type GetProfiles = Record<string, unknown>
export type GetProfilesResponse = {
  /** lists all profiles that exist in the media service */
  profiles?: Profile[]
}
export type AddVideoEncoderConfiguration = {
  /** Reference to the profile where the configuration should be added */
  profileToken?: ReferenceToken
  /** Contains a reference to the VideoEncoderConfiguration to add */
  configurationToken?: ReferenceToken
}
export type AddVideoEncoderConfigurationResponse = Record<string, unknown>
export type RemoveVideoEncoderConfiguration = {
  /**
   * Contains a reference to the media profile from which the
   * VideoEncoderConfiguration shall be removed.
   */
  profileToken?: ReferenceToken
}
export type RemoveVideoEncoderConfigurationResponse = Record<string, unknown>
export type AddVideoSourceConfiguration = {
  /** Reference to the profile where the configuration should be added */
  profileToken?: ReferenceToken
  /** Contains a reference to the VideoSourceConfiguration to add */
  configurationToken?: ReferenceToken
}
export type AddVideoSourceConfigurationResponse = Record<string, unknown>
export type RemoveVideoSourceConfiguration = {
  /**
   * Contains a reference to the media profile from which the
   * VideoSourceConfiguration shall be removed.
   */
  profileToken?: ReferenceToken
}
export type RemoveVideoSourceConfigurationResponse = Record<string, unknown>
export type AddAudioEncoderConfiguration = {
  /** Reference to the profile where the configuration should be added */
  profileToken?: ReferenceToken
  /** Contains a reference to the AudioEncoderConfiguration to add */
  configurationToken?: ReferenceToken
}
export type AddAudioEncoderConfigurationResponse = Record<string, unknown>
export type RemoveAudioEncoderConfiguration = {
  /**
   * Contains a reference to the media profile from which the
   * AudioEncoderConfiguration shall be removed.
   */
  profileToken?: ReferenceToken
}
export type RemoveAudioEncoderConfigurationResponse = Record<string, unknown>
export type AddAudioSourceConfiguration = {
  /** Reference to the profile where the configuration should be added */
  profileToken?: ReferenceToken
  /** Contains a reference to the AudioSourceConfiguration to add */
  configurationToken?: ReferenceToken
}
export type AddAudioSourceConfigurationResponse = Record<string, unknown>
export type RemoveAudioSourceConfiguration = {
  /**
   * Contains a reference to the media profile from which the
   * AudioSourceConfiguration shall be removed.
   */
  profileToken?: ReferenceToken
}
export type RemoveAudioSourceConfigurationResponse = Record<string, unknown>
export type AddPTZConfiguration = {
  /** Reference to the profile where the configuration should be added */
  profileToken?: ReferenceToken
  /** Contains a reference to the PTZConfiguration to add */
  configurationToken?: ReferenceToken
}
export type AddPTZConfigurationResponse = Record<string, unknown>
export type RemovePTZConfiguration = {
  /**
   * Contains a reference to the media profile from which the
   * PTZConfiguration shall be removed.
   */
  profileToken?: ReferenceToken
}
export type RemovePTZConfigurationResponse = Record<string, unknown>
export type AddVideoAnalyticsConfiguration = {
  /** Reference to the profile where the configuration should be added */
  profileToken?: ReferenceToken
  /** Contains a reference to the VideoAnalyticsConfiguration to add */
  configurationToken?: ReferenceToken
}
export type AddVideoAnalyticsConfigurationResponse = Record<string, unknown>
export type RemoveVideoAnalyticsConfiguration = {
  /**
   * Contains a reference to the media profile from which the
   * VideoAnalyticsConfiguration shall be removed.
   */
  profileToken?: ReferenceToken
}
export type RemoveVideoAnalyticsConfigurationResponse = Record<string, unknown>
export type AddMetadataConfiguration = {
  /** Reference to the profile where the configuration should be added */
  profileToken?: ReferenceToken
  /** Contains a reference to the MetadataConfiguration to add */
  configurationToken?: ReferenceToken
}
export type AddMetadataConfigurationResponse = Record<string, unknown>
export type RemoveMetadataConfiguration = {
  /**
   * Contains a reference to the media profile from which the
   * MetadataConfiguration shall be removed.
   */
  profileToken?: ReferenceToken
}
export type RemoveMetadataConfigurationResponse = Record<string, unknown>
export type AddAudioOutputConfiguration = {
  /** Reference to the profile where the configuration should be added */
  profileToken?: ReferenceToken
  /** Contains a reference to the AudioOutputConfiguration to add */
  configurationToken?: ReferenceToken
}
export type AddAudioOutputConfigurationResponse = Record<string, unknown>
export type RemoveAudioOutputConfiguration = {
  /**
   * Contains a reference to the media profile from which the
   * AudioOutputConfiguration shall be removed.
   */
  profileToken?: ReferenceToken
}
export type RemoveAudioOutputConfigurationResponse = Record<string, unknown>
export type AddAudioDecoderConfiguration = {
  /** This element contains a reference to the profile where the configuration should be added. */
  profileToken?: ReferenceToken
  /** This element contains a reference to the AudioDecoderConfiguration to add. */
  configurationToken?: ReferenceToken
}
export type AddAudioDecoderConfigurationResponse = Record<string, unknown>
export type RemoveAudioDecoderConfiguration = {
  /** This element contains a  reference to the media profile from which the AudioDecoderConfiguration shall be removed. */
  profileToken?: ReferenceToken
}
export type RemoveAudioDecoderConfigurationResponse = Record<string, unknown>
export type DeleteProfile = {
  /** This element contains a  reference to the profile that should be deleted. */
  profileToken?: ReferenceToken
}
export type DeleteProfileResponse = Record<string, unknown>
export type GetVideoEncoderConfigurations = Record<string, unknown>
export type GetVideoEncoderConfigurationsResponse = {
  /** This element contains a list of video encoder configurations. */
  configurations?: VideoEncoderConfiguration[]
}
export type GetVideoSourceConfigurations = Record<string, unknown>
export type GetVideoSourceConfigurationsResponse = {
  /** This element contains a list of video source configurations. */
  configurations?: VideoSourceConfiguration[]
}
export type GetAudioEncoderConfigurations = Record<string, unknown>
export type GetAudioEncoderConfigurationsResponse = {
  /** This element contains a list of audio encoder configurations. */
  configurations?: AudioEncoderConfiguration[]
}
export type GetAudioSourceConfigurations = Record<string, unknown>
export type GetAudioSourceConfigurationsResponse = {
  /** This element contains a list of audio source configurations. */
  configurations?: AudioSourceConfiguration[]
}
export type GetVideoAnalyticsConfigurations = Record<string, unknown>
export type GetVideoAnalyticsConfigurationsResponse = {
  /** This element contains a list of VideoAnalytics configurations. */
  configurations?: VideoAnalyticsConfiguration[]
}
export type GetMetadataConfigurations = Record<string, unknown>
export type GetMetadataConfigurationsResponse = {
  /** This element contains a list of metadata configurations */
  configurations?: MetadataConfiguration[]
}
export type GetAudioOutputConfigurations = Record<string, unknown>
export type GetAudioOutputConfigurationsResponse = {
  /** This element contains a list of audio output configurations */
  configurations?: AudioOutputConfiguration[]
}
export type GetAudioDecoderConfigurations = Record<string, unknown>
export type GetAudioDecoderConfigurationsResponse = {
  /** This element contains a list of audio decoder configurations */
  configurations?: AudioDecoderConfiguration[]
}
export type GetVideoSourceConfiguration = {
  /** Token of the requested video source configuration. */
  configurationToken?: ReferenceToken
}
export type GetVideoSourceConfigurationResponse = {
  /** The requested video source configuration. */
  configuration?: VideoSourceConfiguration
}
export type GetVideoEncoderConfiguration = {
  /** Token of the requested video encoder configuration. */
  configurationToken?: ReferenceToken
}
export type GetVideoEncoderConfigurationResponse = {
  /** The requested video encoder configuration. */
  configuration?: VideoEncoderConfiguration
}
export type GetAudioSourceConfiguration = {
  /** Token of the requested audio source configuration. */
  configurationToken?: ReferenceToken
}
export type GetAudioSourceConfigurationResponse = {
  /** The requested audio source configuration. */
  configuration?: AudioSourceConfiguration
}
export type GetAudioEncoderConfiguration = {
  /** Token of the requested audio encoder configuration. */
  configurationToken?: ReferenceToken
}
export type GetAudioEncoderConfigurationResponse = {
  /** The requested audio encoder configuration */
  configuration?: AudioEncoderConfiguration
}
export type GetVideoAnalyticsConfiguration = {
  /** Token of the requested video analytics configuration. */
  configurationToken?: ReferenceToken
}
export type GetVideoAnalyticsConfigurationResponse = {
  /** The requested video analytics configuration. */
  configuration?: VideoAnalyticsConfiguration
}
export type GetMetadataConfiguration = {
  /** Token of the requested metadata configuration. */
  configurationToken?: ReferenceToken
}
export type GetMetadataConfigurationResponse = {
  /** The requested metadata configuration. */
  configuration?: MetadataConfiguration
}
export type GetAudioOutputConfiguration = {
  /** Token of the requested audio output configuration. */
  configurationToken?: ReferenceToken
}
export type GetAudioOutputConfigurationResponse = {
  /** The requested audio output configuration. */
  configuration?: AudioOutputConfiguration
}
export type GetAudioDecoderConfiguration = {
  /** Token of the requested audio decoder configuration. */
  configurationToken?: ReferenceToken
}
export type GetAudioDecoderConfigurationResponse = {
  /** The requested audio decoder configuration */
  configuration?: AudioDecoderConfiguration
}
export type GetCompatibleVideoEncoderConfigurations = {
  /** Contains the token of an existing media profile the configurations shall be compatible with. */
  profileToken?: ReferenceToken
}
export type GetCompatibleVideoEncoderConfigurationsResponse = {
  /** Contains a list of video encoder configurations that are compatible with the specified media profile. */
  configurations?: VideoEncoderConfiguration[]
}
export type GetCompatibleVideoSourceConfigurations = {
  /** Contains the token of an existing media profile the configurations shall be compatible with. */
  profileToken?: ReferenceToken
}
export type GetCompatibleVideoSourceConfigurationsResponse = {
  /** Contains a list of video source configurations that are compatible with the specified media profile. */
  configurations?: VideoSourceConfiguration[]
}
export type GetCompatibleAudioEncoderConfigurations = {
  /** Contains the token of an existing media profile the configurations shall be compatible with. */
  profileToken?: ReferenceToken
}
export type GetCompatibleAudioEncoderConfigurationsResponse = {
  /** Contains a list of audio encoder configurations that are compatible with the specified media profile. */
  configurations?: AudioEncoderConfiguration[]
}
export type GetCompatibleAudioSourceConfigurations = {
  /** Contains the token of an existing media profile the configurations shall be compatible with. */
  profileToken?: ReferenceToken
}
export type GetCompatibleAudioSourceConfigurationsResponse = {
  /** Contains a list of audio source configurations that are compatible with the specified media profile. */
  configurations?: AudioSourceConfiguration[]
}
export type GetCompatibleVideoAnalyticsConfigurations = {
  /** Contains the token of an existing media profile the configurations shall be compatible with. */
  profileToken?: ReferenceToken
}
export type GetCompatibleVideoAnalyticsConfigurationsResponse = {
  /** Contains a list of video analytics configurations that are compatible with the specified media profile. */
  configurations?: VideoAnalyticsConfiguration[]
}
export type GetCompatibleMetadataConfigurations = {
  /** Contains the token of an existing media profile the configurations shall be compatible with. */
  profileToken?: ReferenceToken
}
export type GetCompatibleMetadataConfigurationsResponse = {
  /** Contains a list of metadata configurations that are compatible with the specified media profile. */
  configurations?: MetadataConfiguration[]
}
export type GetCompatibleAudioOutputConfigurations = {
  /** Contains the token of an existing media profile the configurations shall be compatible with. */
  profileToken?: ReferenceToken
}
export type GetCompatibleAudioOutputConfigurationsResponse = {
  /** Contains a list of audio output configurations that are compatible with the specified media profile. */
  configurations?: AudioOutputConfiguration[]
}
export type GetCompatibleAudioDecoderConfigurations = {
  /** Contains the token of an existing media profile the configurations shall be compatible with. */
  profileToken?: ReferenceToken
}
export type GetCompatibleAudioDecoderConfigurationsResponse = {
  /** Contains a list of audio decoder configurations that are compatible with the specified media profile. */
  configurations?: AudioDecoderConfiguration[]
}
export type SetVideoEncoderConfiguration = {
  /** Contains the modified video encoder configuration. The configuration shall exist in the device. */
  configuration?: VideoEncoderConfiguration
  /** The ForcePersistence element is obsolete and should always be assumed to be true. */
  forcePersistence?: boolean
}
export type SetVideoEncoderConfigurationResponse = Record<string, unknown>
export type SetVideoSourceConfiguration = {
  /** Contains the modified video source configuration. The configuration shall exist in the device. */
  configuration?: VideoSourceConfiguration
  /** The ForcePersistence element is obsolete and should always be assumed to be true. */
  forcePersistence?: boolean
}
export type SetVideoSourceConfigurationResponse = Record<string, unknown>
export type SetAudioEncoderConfiguration = {
  /** Contains the modified audio encoder configuration. The configuration shall exist in the device. */
  configuration?: AudioEncoderConfiguration
  /** The ForcePersistence element is obsolete and should always be assumed to be true. */
  forcePersistence?: boolean
}
export type SetAudioEncoderConfigurationResponse = Record<string, unknown>
export type SetAudioSourceConfiguration = {
  /** Contains the modified audio source configuration. The configuration shall exist in the device. */
  configuration?: AudioSourceConfiguration
  /** The ForcePersistence element is obsolete and should always be assumed to be true. */
  forcePersistence?: boolean
}
export type SetAudioSourceConfigurationResponse = Record<string, unknown>
export type SetVideoAnalyticsConfiguration = {
  /** Contains the modified video analytics configuration. The configuration shall exist in the device. */
  configuration?: VideoAnalyticsConfiguration
  /** The ForcePersistence element is obsolete and should always be assumed to be true. */
  forcePersistence?: boolean
}
export type SetVideoAnalyticsConfigurationResponse = Record<string, unknown>
export type SetMetadataConfiguration = {
  /** Contains the modified metadata configuration. The configuration shall exist in the device. */
  configuration?: MetadataConfiguration
  /** The ForcePersistence element is obsolete and should always be assumed to be true. */
  forcePersistence?: boolean
}
export type SetMetadataConfigurationResponse = Record<string, unknown>
export type SetAudioOutputConfiguration = {
  /** Contains the modified audio output configuration. The configuration shall exist in the device. */
  configuration?: AudioOutputConfiguration
  /** The ForcePersistence element is obsolete and should always be assumed to be true. */
  forcePersistence?: boolean
}
export type SetAudioOutputConfigurationResponse = Record<string, unknown>
export type SetAudioDecoderConfiguration = {
  /** Contains the modified audio decoder configuration. The configuration shall exist in the device. */
  configuration?: AudioDecoderConfiguration
  /** The ForcePersistence element is obsolete and should always be assumed to be true. */
  forcePersistence?: boolean
}
export type SetAudioDecoderConfigurationResponse = Record<string, unknown>
export type GetVideoSourceConfigurationOptions = {
  /** Optional video source configurationToken that specifies an existing configuration that the options are intended for. */
  configurationToken?: ReferenceToken
  /** Optional ProfileToken that specifies an existing media profile that the options shall be compatible with. */
  profileToken?: ReferenceToken
}
export type GetVideoSourceConfigurationOptionsResponse = {
  /** This message contains the video source configuration options. If a video source configuration is specified, the options shall concern that particular configuration. If a media profile is specified, the options shall be compatible with that media profile. If no tokens are specified, the options shall be considered generic for the device. */
  options?: VideoSourceConfigurationOptions
}
export type GetVideoEncoderConfigurationOptions = {
  /** Optional video encoder configuration token that specifies an existing configuration that the options are intended for. */
  configurationToken?: ReferenceToken
  /** Optional ProfileToken that specifies an existing media profile that the options shall be compatible with. */
  profileToken?: ReferenceToken
}
export type GetVideoEncoderConfigurationOptionsResponse = {
  options?: VideoEncoderConfigurationOptions
}
export type GetAudioSourceConfigurationOptions = {
  /** Optional audio source configuration token that specifies an existing configuration that the options are intended for. */
  configurationToken?: ReferenceToken
  /** Optional ProfileToken that specifies an existing media profile that the options shall be compatible with. */
  profileToken?: ReferenceToken
}
export type GetAudioSourceConfigurationOptionsResponse = {
  /** This message contains the audio source configuration options. If a audio source configuration is specified, the options shall concern that particular configuration. If a media profile is specified, the options shall be compatible with that media profile. If no tokens are specified, the options shall be considered generic for the device. */
  options?: AudioSourceConfigurationOptions
}
export type GetAudioEncoderConfigurationOptions = {
  /** Optional audio encoder configuration token that specifies an existing configuration that the options are intended for. */
  configurationToken?: ReferenceToken
  /** Optional ProfileToken that specifies an existing media profile that the options shall be compatible with. */
  profileToken?: ReferenceToken
}
export type GetAudioEncoderConfigurationOptionsResponse = {
  /** This message contains the audio encoder configuration options. If a audio encoder configuration is specified, the options shall concern that particular configuration. If a media profile is specified, the options shall be compatible with that media profile. If no tokens are specified, the options shall be considered generic for the device. */
  options?: AudioEncoderConfigurationOptions
}
export type GetMetadataConfigurationOptions = {
  /** Optional metadata configuration token that specifies an existing configuration that the options are intended for. */
  configurationToken?: ReferenceToken
  /** Optional ProfileToken that specifies an existing media profile that the options shall be compatible with. */
  profileToken?: ReferenceToken
}
export type GetMetadataConfigurationOptionsResponse = {
  /** This message contains the metadata configuration options. If a metadata configuration is specified, the options shall concern that particular configuration. If a media profile is specified, the options shall be compatible with that media profile. If no tokens are specified, the options shall be considered generic for the device. */
  options?: MetadataConfigurationOptions
}
export type GetAudioOutputConfigurationOptions = {
  /** Optional audio output configuration token that specifies an existing configuration that the options are intended for. */
  configurationToken?: ReferenceToken
  /** Optional ProfileToken that specifies an existing media profile that the options shall be compatible with. */
  profileToken?: ReferenceToken
}
export type GetAudioOutputConfigurationOptionsResponse = {
  /** This message contains the audio output configuration options. If a audio output configuration is specified, the options shall concern that particular configuration. If a media profile is specified, the options shall be compatible with that media profile. If no tokens are specified, the options shall be considered generic for the device. */
  options?: AudioOutputConfigurationOptions
}
export type GetAudioDecoderConfigurationOptions = {
  /** Optional audio decoder configuration token that specifies an existing configuration that the options are intended for. */
  configurationToken?: ReferenceToken
  /** Optional ProfileToken that specifies an existing media profile that the options shall be compatible with. */
  profileToken?: ReferenceToken
}
export type GetAudioDecoderConfigurationOptionsResponse = {
  /** This message contains the audio decoder configuration options. If a audio decoder configuration is specified, the options shall concern that particular configuration. If a media profile is specified, the options shall be compatible with that media profile. If no tokens are specified, the options shall be considered generic for the device. */
  options?: AudioDecoderConfigurationOptions
}
export type GetGuaranteedNumberOfVideoEncoderInstances = {
  /** Token of the video source configuration */
  configurationToken?: ReferenceToken
}
export type GetGuaranteedNumberOfVideoEncoderInstancesResponse = {
  /** The minimum guaranteed total number of encoder instances (applications) per VideoSourceConfiguration. The device is able to deliver the TotalNumber of streams */
  totalNumber?: number
  /** If a device limits the number of instances for respective Video Codecs the response contains the information how many Jpeg streams can be set up at the same time per VideoSource. */
  JPEG?: number
  /** If a device limits the number of instances for respective Video Codecs the response contains the information how many H264 streams can be set up at the same time per VideoSource. */
  H264?: number
  /** If a device limits the number of instances for respective Video Codecs the response contains the information how many Mpeg4 streams can be set up at the same time per VideoSource. */
  MPEG4?: number
}
export type GetStreamUri = {
  /** Stream Setup that should be used with the uri */
  streamSetup?: StreamSetup
  /** The ProfileToken element indicates the media profile to use and will define the configuration of the content of the stream. */
  profileToken?: ReferenceToken
}
export type GetStreamUriResponse = {
  /**/
  mediaUri?: MediaUri
}
export type StartMulticastStreaming = {
  /** Contains the token of the Profile that is used to define the multicast stream. */
  profileToken?: ReferenceToken
}
export type StartMulticastStreamingResponse = Record<string, unknown>
export type StopMulticastStreaming = {
  /** Contains the token of the Profile that is used to define the multicast stream. */
  profileToken?: ReferenceToken
}
export type StopMulticastStreamingResponse = Record<string, unknown>
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
  /**/
  mediaUri?: MediaUri
}
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
  /** Token of the Video Source Configuration, which has OSDs associated with are requested. If token not exist, request all available OSDs. */
  configurationToken?: ReferenceToken
}
export type GetOSDsResponse = {
  /** This element contains a list of requested OSDs. */
  OSDs?: OSDConfiguration[]
}
export type GetOSD = {
  /** The GetOSD command fetches the OSD configuration if the OSD token is known. */
  OSDToken?: ReferenceToken
}
export type GetOSDResponse = {
  /** The requested OSD configuration. */
  OSD?: OSDConfiguration
}
export type SetOSD = {
  /** Contains the modified OSD configuration. */
  OSD?: OSDConfiguration
}
export type SetOSDResponse = Record<string, unknown>
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
export type DeleteOSDResponse = Record<string, unknown>
