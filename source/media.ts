import type { AnyURI } from './interfaces/basics.ts'
import type { ReferenceToken } from './interfaces/common.ts'
import type {
  ConfigurationSet,
  GetOSDOptions,
  GetOSDOptionsResponse,
  GetOSDs,
  GetOSDsResponse,
  GetVideoEncoderConfigurationsResponse as GetVideoEncoder2ConfigurationsResponse,
  GetVideoEncoderConfigurations,
  GetVideoSourceConfigurationOptions,
  GetVideoSourceConfigurationOptionsResponse,
  GetVideoSourceConfigurations,
  MediaProfile
} from './interfaces/media.2.ts'
import type {
  GetSnapshotUri,
  GetVideoEncoderConfigurationsResponse,
  GetVideoSourceConfigurationsResponse,
  GetVideoSourcesResponse
} from './interfaces/media.ts'
import type {
  AudioEncoderConfiguration,
  MediaUri,
  Profile,
  VideoEncoderConfiguration,
  VideoSource
} from './interfaces/onvif.ts'
import type { Onvif } from './onvif.ts'
import { linerase } from './utils/xml.ts'

export type GetStreamUriOptions = {
  profileToken?: ReferenceToken
  stream?: 'RTP-Unicast' | 'RTP-Multicast'
  protocol?:
    | 'RtspUnicast'
    | 'RtspMulticast'
    | 'RTSP'
    | 'RtspOverHttp' // for Media2
    | 'UDP'
    | 'TCP'
    | 'HTTP' // for Media1
}

export type GetSnapshotUriOptions = {
  profileToken?: ReferenceToken
}

export class Media {
  private readonly onvif: Onvif
  public profiles: Profile[] = []
  public videoSources: VideoSource[] = []

  constructor(onvif: Onvif) {
    this.onvif = onvif
  }

  /**
   * Receive profiles
   */
  async getProfiles(): Promise<Array<Profile | MediaProfile>> {
    if (this.onvif.device.media2Support) {
      // Profile T request using Media2
      // The reply is in a different format to the old API so we convert the data from the new API to the old structure
      // for backwards compatibility with existing users of this library
      const [data] = await this.onvif.request({
        service: 'media2',
        body: `
          <GetProfiles xmlns="http://www.onvif.org/ver20/media/wsdl">
            <Type>All</Type>
          </GetProfiles>`
      })

      // Slight difference in Media1 and Media2 reply XML
      // Generate a reply that looks like a Media1 reply for existing library users
      // @ts-expect-error TODO: this request client sucks big time...
      this.profiles = data.getProfilesResponse.profiles.map((profile: Record<string, unknown>) => {
        const tmp = linerase(profile) as MediaProfile
        const conf = tmp.configurations as ConfigurationSet
        const newProfile: Profile = {
          token: tmp.token,
          name: tmp.name,
          fixed: tmp.fixed || false
        }
        // Media2 Spec says there will be these some or all of these configuration entities
        // Video source configuration
        // Audio source configuration
        // Video encoder configuration
        // Audio encoder configuration
        // PTZ configuration
        // Video analytics configuration
        // Metadata configuration
        // Audio output configuration
        // Audio decoder configuration
        if (conf.videoSource) {
          newProfile.videoSourceConfiguration = conf.videoSource
        }
        if (conf.audioSource) {
          newProfile.audioSourceConfiguration = conf.audioSource
        }
        if (conf.videoEncoder) {
          newProfile.videoEncoderConfiguration = conf.videoEncoder as unknown as VideoEncoderConfiguration
        }
        if (conf.audioEncoder) {
          newProfile.audioEncoderConfiguration = conf.audioEncoder as AudioEncoderConfiguration
        }
        if (conf.PTZ) {
          newProfile.PTZConfiguration = conf.PTZ
        }
        if (conf.analytics) {
          newProfile.videoAnalyticsConfiguration = conf.analytics
        }
        if (conf.metadata) {
          newProfile.metadataConfiguration = conf.metadata
        }
        if (conf.audioOutput || conf.audioDecoder) {
          newProfile.extension = {
            audioOutputConfiguration: conf.audioOutput,
            audioDecoderConfiguration: conf.audioDecoder
          }
        }
        // TODO - Add Audio
        return newProfile
      })
      return this.profiles
    }
    // Original ONVIF Media support (used in Profile S)
    const [data] = await this.onvif.request({
      service: 'media',
      body: '<GetProfiles xmlns="http://www.onvif.org/ver10/media/wsdl"/>'
    })
    // @ts-expect-error TODO: this request client sucks big time...
    this.profiles = data.getProfilesResponse.profiles.map(linerase)
    return this.profiles
  }

  async getVideoSources(): Promise<GetVideoSourcesResponse> {
    const [data] = await this.onvif.request({
      service: 'media',
      body: '<GetVideoSources xmlns="http://www.onvif.org/ver10/media/wsdl"/>'
    })
    // @ts-expect-error TODO: this request client sucks big time...
    const videoSourcesResponse = linerase(data, { array: ['videoSources'] })
      .getVideoSourcesResponse as GetVideoSourcesResponse

    if (Array.isArray(videoSourcesResponse.videoSources)) {
      for (const videoSource of videoSourcesResponse.videoSources) {
        this.videoSources.push(videoSource)
      }
    } else if (videoSourcesResponse.videoSources) {
      this.videoSources.push(videoSourcesResponse.videoSources)
    }

    return videoSourcesResponse
  }

  async getVideoSourceConfigurations({
    configurationToken,
    profileToken
  }: GetVideoSourceConfigurations = {}): Promise<GetVideoSourceConfigurationsResponse> {
    const body = `<GetVideoSourceConfigurations xmlns="${
      this.onvif.device.media2Support
        ? 'http://www.onvif.org/ver20/media/wsdl'
        : 'http://www.onvif.org/ver10/media/wsdl'
    }">${configurationToken ? `<ConfigurationToken>${configurationToken}</ConfigurationToken>` : ''}${
      profileToken ? `<ProfileToken>${profileToken}</ProfileToken>` : ''
    }</GetVideoSourceConfigurations>`
    const service = this.onvif.device.media2Support ? 'media2' : 'media'

    const [data] = await this.onvif.request({ service, body })
    // @ts-expect-error TODO: this request client sucks big time...
    return linerase(data, { array: ['configurations'] }).getVideoSourceConfigurationsResponse
  }

  async getVideoSourceConfigurationOptions({
    configurationToken,
    profileToken
  }: GetVideoSourceConfigurationOptions = {}): Promise<GetVideoSourceConfigurationOptionsResponse> {
    const body = `<GetVideoSourceConfigurationOptions xmlns="${
      this.onvif.device.media2Support
        ? 'http://www.onvif.org/ver20/media/wsdl'
        : 'http://www.onvif.org/ver10/media/wsdl'
    }">${configurationToken ? `<ConfigurationToken>${configurationToken}</ConfigurationToken>` : ''}${
      profileToken ? `<ProfileToken>${profileToken}</ProfileToken>` : ''
    }</GetVideoSourceConfigurationOptions>`
    const service = this.onvif.device.media2Support ? 'media2' : 'media'

    const [data] = await this.onvif.request({ service, body })
    // @ts-expect-error TODO: this request client sucks big time...
    return linerase(data, { array: ['videoSourceTokensAvailable'] }).getVideoSourceConfigurationOptionsResponse
  }

  /**
   * Retrieves video encoder configurations.
   *
   * @param options - Configuration options
   * @param [options.configurationToken] - Specific configuration token to retrieve
   * @param [options.profileToken] - Profile token to filter configurations
   * @returns
   *          Video encoder configurations. Returns VideoEncoder2Configuration array if device
   *          supports Media 2.0, otherwise VideoEncoderConfiguration array.
   * @throws {Error} On request failure or invalid response
   */
  async getVideoEncoderConfigurations({
    configurationToken,
    profileToken
  }: GetVideoEncoderConfigurations = {}): Promise<
    GetVideoEncoderConfigurationsResponse | GetVideoEncoder2ConfigurationsResponse
  > {
    const body = `<GetVideoEncoderConfigurations xmlns="${
      this.onvif.device.media2Support
        ? 'http://www.onvif.org/ver20/media/wsdl'
        : 'http://www.onvif.org/ver10/media/wsdl'
    }">${configurationToken ? `<ConfigurationToken>${configurationToken}</ConfigurationToken>` : ''}${
      profileToken ? `<ProfileToken>${profileToken}</ProfileToken>` : ''
    }</GetVideoEncoderConfigurations>`
    const service = this.onvif.device.media2Support ? 'media2' : 'media'

    const [data] = await this.onvif.request({ service, body })

    // @ts-expect-error TODO: this request client sucks big time...
    const { getVideoEncoderConfigurationsResponse } = linerase(data, { array: ['configurations'] })
    return getVideoEncoderConfigurationsResponse
  }

  /**
   * This method requests a URI that can be used to initiate a live media stream using RTSP as the control protocol.
   * The returned URI shall remain valid indefinitely even if the profile is changed.
   * Method uses Media2 if device supports it.
   *
   * For Media2 you need to provide only `protocol` parameter ('RTPS' by default). Here is supported values from the
   * ONVIF documentation:
   * Defined stream types are
   * - RtspUnicast RTSP streaming RTP as UDP Unicast.
   * - RtspMulticast RTSP streaming RTP as UDP Multicast.
   * - RTSP RTSP streaming RTP over TCP.
   * - RtspOverHttp Tunneling both the RTSP control channel and the RTP stream over HTTP or HTTPS.
   *
   * For Media1 you need to set both parameters: protocl and stream (RTP-Unicast by default) If Media2 supported
   * by device, this parameters will be converted to Media2 call. This is excerpt from ONVIF documentation:
   * The correct syntax for the StreamSetup element for these media stream setups defined in 5.1.1 of the streaming specification are as follows:
   * - RTP unicast over UDP: StreamType = "RTP_unicast", TransportProtocol = "UDP"
   * - RTP over RTSP over HTTP over TCP: StreamType = "RTP_unicast", TransportProtocol = "HTTP"
   * - RTP over RTSP over TCP: StreamType = "RTP_unicast", TransportProtocol = "RTSP"
   *
   * @param options - GetStreamUriOptions
   */
  async getStreamUri(options: GetStreamUriOptions = {}): Promise<MediaUri | string> {
    const { profileToken, stream = 'RTP-Unicast' } = options
    let { protocol = 'RTSP' } = options
    if (this.onvif.device.media2Support) {
      // Permitted values for options.protocol are :-
      //   RtspUnicast - RTSP streaming RTP via UDP Unicast.
      //   RtspMulticast - RTSP streaming RTP via UDP Multicast.
      //   RTSP - RTSP streaming RTP over TCP.
      //   RtspOverHttp - Tunneling both the RTSP control channel and the RTP stream over HTTP or HTTPS.

      // For backwards compatibility this function will convert Media1 Stream and Transport Protocol to a Media2 protocol
      if (protocol === 'HTTP') {
        protocol = 'RtspOverHttp'
      }
      if (protocol === 'TCP') {
        protocol = 'RTSP'
      }
      if (protocol === 'UDP' && stream === 'RTP-Unicast') {
        protocol = 'RtspUnicast'
      }
      if (protocol === 'UDP' && stream === 'RTP-Multicast') {
        protocol = 'RtspMulticast'
      }

      // Profile T request using Media2
      const [data] = await this.onvif.request({
        service: 'media2',
        body: `
          <GetStreamUri xmlns="http://www.onvif.org/ver20/media/wsdl">
            <Protocol>${protocol}</Protocol>
            <ProfileToken>${profileToken || this.onvif.activeSource?.profileToken}</ProfileToken>
          </GetStreamUri>`
      })
      // @ts-expect-error TODO: this request client sucks big time...
      return linerase(data).getStreamUriResponse
    }
    // Original (v.1.0)  ONVIF Specification for Media (used in Profile S)
    const [data] = await this.onvif.request({
      service: 'media',
      body: `
        <GetStreamUri xmlns="http://www.onvif.org/ver10/media/wsdl">
          <StreamSetup>
            <Stream xmlns="http://www.onvif.org/ver10/schema">${stream}</Stream>
            <Transport xmlns="http://www.onvif.org/ver10/schema">
              <Protocol>${protocol || 'RTSP'}</Protocol>
            </Transport>
          </StreamSetup>
          <ProfileToken>${profileToken || this.onvif.activeSource?.profileToken}</ProfileToken>
        </GetStreamUri>`
    })
    // @ts-expect-error TODO: this request client sucks big time...
    return linerase(data).getStreamUriResponse.mediaUri
  }

  /**
   * Retrieves the snapshot URI for a given profile.
   *
   * @param options - Options for the snapshot request
   * @param [options.profileToken] - Token of the profile to get the snapshot URI for.
   *                                 If not provided, uses the active source's profile token.
   * @returns Object containing the snapshot URI
   * @throws {Error} On request failure or invalid response
   */
  async getSnapshotUri({ profileToken }: GetSnapshotUri = {}): Promise<{ uri: AnyURI }> {
    if (this.onvif.device.media2Support) {
      // Profile T request using Media2
      const [data] = await this.onvif.request({
        service: 'media2',
        body: `
          <GetSnapshotUri xmlns="http://www.onvif.org/ver20/media/wsdl">
            <ProfileToken>${profileToken || this.onvif.activeSource?.profileToken}</ProfileToken>
          </GetSnapshotUri>`
      })
      // @ts-expect-error TODO: this request client sucks big time...
      return linerase(data).getSnapshotUriResponse
    }
    const [data] = await this.onvif.request({
      service: 'media',
      body: `
        <GetSnapshotUri xmlns="http://www.onvif.org/ver10/media/wsdl">
          <ProfileToken>${profileToken || this.onvif.activeSource?.profileToken}</ProfileToken>
        </GetSnapshotUri>`
    })
    // @ts-expect-error TODO: this request client sucks big time...
    return linerase(data).getSnapshotUriResponse.mediaUri
  }

  async getOSDs({ configurationToken, OSDToken }: GetOSDs = {}): Promise<GetOSDsResponse> {
    const mediaService = this.onvif.device.media2Support ? 'media2' : 'media'
    const mediaNs = this.onvif.device.media2Support
      ? 'http://www.onvif.org/ver20/media/wsdl'
      : 'http://www.onvif.org/ver10/media/wsdl'

    const [data] = await this.onvif.request({
      service: mediaService,
      body: `<GetOSDs xmlns="${mediaNs}" >${
        configurationToken ? `<ConfigurationToken>${configurationToken}</ConfigurationToken>` : ''
      }${OSDToken ? `<OSDToken>${configurationToken}</OSDToken>` : ''}</GetOSDs>`
    })
    // this.videoSources = linerase(data).getVideoSourcesResponse.videoSources;
    // @ts-expect-error TODO: this request client sucks big time...
    return linerase(data.getOSDsResponse, { array: ['OSDs'] })
  }

  async getOSDOptions({ configurationToken }: GetOSDOptions = {}): Promise<GetOSDOptionsResponse> {
    const mediaService = this.onvif.device.media2Support ? 'media2' : 'media'
    const mediaNs = this.onvif.device.media2Support
      ? 'http://www.onvif.org/ver20/media/wsdl'
      : 'http://www.onvif.org/ver10/media/wsdl'

    const [data] = await this.onvif.request({
      service: mediaService,
      body: `
        <GetOSDOptions xmlns="${mediaNs}" >
          <ConfigurationToken>${configurationToken ?? this.onvif.activeSource?.videoSourceConfigurationToken}</ConfigurationToken>
        </GetOSDOptions>`
    })
    // @ts-expect-error TODO: this request client sucks big time...
    const result = linerase(data).getOSDOptionsResponse
    return result
  }
}
