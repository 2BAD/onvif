import { type Device, type ErrorContext, OnvifError } from '@2bad/onvif'
import * as Media from '#generated/media.ts'
import * as Media2 from '#generated/media2.ts'
import { contextOf, fromEitherService, type MediaOptions } from '#service.ts'

export type VideoEncoder = {
  token: string
  name: string
  /** Media subtype as in `tt:VideoEncodingMimeNames`: `JPEG`, `MPV4-ES`, `H264`, `H265` or what the device reports. */
  encoding: string
  resolution: { width: number; height: number }
  quality: number
  frameRateLimit?: number
  /** Kilobits per second. */
  bitrateLimit?: number
  govLength?: number
  /** Codec profile as in `tt:VideoEncodingProfiles`, such as `Main` or `High`, or what the device reports. */
  profile?: string
} & (
  | { service: 'media'; reported: Media.VideoEncoderConfiguration }
  | { service: 'media2'; reported: Media2.VideoEncoder2Configuration }
)

export type VideoEncoderOptions = {
  /** Media subtype, named as in `VideoEncoder`. */
  encoding: string
  resolutions: { width: number; height: number }[]
  qualityRange: { min: number; max: number }
  frameRateRange?: { min: number; max: number }
  /** The frame rates the device accepts, when it lists them. */
  frameRates?: number[]
  /** Kilobits per second. */
  bitrateRange?: { min: number; max: number }
  govLengthRange?: { min: number; max: number }
  profiles?: string[]
}

export type VideoEncoderChanges = Partial<
  Pick<
    VideoEncoder,
    'encoding' | 'resolution' | 'quality' | 'frameRateLimit' | 'bitrateLimit' | 'govLength' | 'profile'
  >
>

const mpeg4Profiles: Record<string, string> = { SP: 'Simple', ASP: 'AdvancedSimple' }
const mediaMpeg4Profiles: Record<string, string> = { Simple: 'SP', AdvancedSimple: 'ASP' }

const range = ({ min, max }: { min: number; max: number }) => ({ min, max })

const resolutionsOf = (resolutions: readonly { width: number; height: number }[]) =>
  resolutions.map(({ width, height }) => ({ width, height }))

export const encoderOfMedia = (configuration: Media.VideoEncoderConfiguration): VideoEncoder => {
  const { token, name, encoding, resolution, quality, rateControl, H264, MPEG4 } = configuration
  const codec =
    encoding === 'H264' && H264
      ? { govLength: H264.govLength, profile: H264.h264Profile }
      : encoding === 'MPEG4' && MPEG4
        ? { govLength: MPEG4.govLength, profile: mpeg4Profiles[MPEG4.mpeg4Profile] ?? MPEG4.mpeg4Profile }
        : {}
  return {
    token,
    name,
    encoding: encoding === 'MPEG4' ? 'MPV4-ES' : encoding,
    resolution: { width: resolution.width, height: resolution.height },
    quality,
    ...(rateControl ? { frameRateLimit: rateControl.frameRateLimit, bitrateLimit: rateControl.bitrateLimit } : {}),
    ...codec,
    service: 'media',
    reported: configuration
  }
}

export const encoderOfMedia2 = (configuration: Media2.VideoEncoder2Configuration): VideoEncoder => {
  const { token, name, encoding, resolution, quality, rateControl, govLength, profile } = configuration
  return {
    token,
    name,
    encoding,
    resolution: { width: resolution.width, height: resolution.height },
    quality,
    ...(rateControl ? { frameRateLimit: rateControl.frameRateLimit, bitrateLimit: rateControl.bitrateLimit } : {}),
    ...(govLength === undefined ? {} : { govLength }),
    ...(profile === undefined ? {} : { profile }),
    service: 'media2',
    reported: configuration
  }
}

const optionsOfMedia = (options: Media.VideoEncoderConfigurationOptions): VideoEncoderOptions[] => {
  const { qualityRange, JPEG, MPEG4, H264, extension } = options
  const codecs = [
    { encoding: 'JPEG', base: JPEG, extended: extension?.JPEG, profiles: undefined },
    {
      encoding: 'MPV4-ES',
      base: MPEG4,
      extended: extension?.MPEG4,
      profiles: MPEG4?.mpeg4ProfilesSupported.map((profile) => mpeg4Profiles[profile] ?? profile)
    },
    { encoding: 'H264', base: H264, extended: extension?.H264, profiles: H264?.h264ProfilesSupported }
  ]
  return codecs.flatMap(({ encoding, base, extended, profiles }) => {
    if (!base) return []
    const govLengthRange = 'govLengthRange' in base ? base.govLengthRange : undefined
    return [
      {
        encoding,
        resolutions: resolutionsOf(base.resolutionsAvailable),
        qualityRange: range(qualityRange),
        frameRateRange: range(base.frameRateRange),
        ...(extended ? { bitrateRange: range(extended.bitrateRange) } : {}),
        ...(govLengthRange ? { govLengthRange: range(govLengthRange) } : {}),
        ...(profiles ? { profiles: [...profiles] } : {})
      }
    ]
  })
}

const optionsOfMedia2 = (options: Media2.VideoEncoder2ConfigurationOptions): VideoEncoderOptions => {
  const { encoding, qualityRange, resolutionsAvailable, bitrateRange, frameRatesSupported, profilesSupported } = options
  const [govLengthMin, govLengthMax] = options.govLengthRange ?? []
  return {
    encoding,
    resolutions: resolutionsOf(resolutionsAvailable),
    qualityRange: range(qualityRange),
    ...(frameRatesSupported?.length
      ? {
          frameRateRange: { min: Math.min(...frameRatesSupported), max: Math.max(...frameRatesSupported) },
          frameRates: frameRatesSupported
        }
      : {}),
    bitrateRange: range(bitrateRange),
    ...(govLengthMin === undefined || govLengthMax === undefined
      ? {}
      : { govLengthRange: { min: govLengthMin, max: govLengthMax } }),
    ...(profilesSupported ? { profiles: profilesSupported } : {})
  }
}

const withRateControl = <RateControl extends { frameRateLimit: number; bitrateLimit: number }>(
  current: RateControl | undefined,
  changes: VideoEncoderChanges,
  context: ErrorContext
): RateControl | undefined => {
  const { frameRateLimit, bitrateLimit } = changes
  if (frameRateLimit === undefined && bitrateLimit === undefined) return current
  if (!current) throw new OnvifError('The encoder reports no rate control to change', context)
  return {
    ...current,
    ...(frameRateLimit === undefined ? {} : { frameRateLimit }),
    ...(bitrateLimit === undefined ? {} : { bitrateLimit })
  }
}

const changedMedia = (
  reported: Media.VideoEncoderConfiguration,
  changes: VideoEncoderChanges,
  context: ErrorContext
): Media.VideoEncoderConfiguration => {
  const { resolution, quality, govLength, profile } = changes
  const encoding =
    changes.encoding === undefined ? reported.encoding : changes.encoding === 'MPV4-ES' ? 'MPEG4' : changes.encoding
  const rateControl = withRateControl(reported.rateControl, changes, context)
  const configuration = {
    ...reported,
    encoding,
    ...(resolution ? { resolution: { ...reported.resolution, ...resolution } } : {}),
    ...(quality === undefined ? {} : { quality }),
    ...(rateControl ? { rateControl } : {})
  }
  if (changes.encoding === undefined && govLength === undefined && profile === undefined) return configuration
  if (encoding === 'H264') {
    const h264GovLength = govLength ?? reported.H264?.govLength
    const h264Profile = profile ?? reported.H264?.h264Profile
    if (h264GovLength === undefined || h264Profile === undefined) {
      throw new OnvifError('Media v1 needs govLength and profile for H264', context)
    }
    return { ...configuration, H264: { govLength: h264GovLength, h264Profile } }
  }
  if (encoding === 'MPEG4') {
    const mpeg4GovLength = govLength ?? reported.MPEG4?.govLength
    const mpeg4Profile = profile === undefined ? reported.MPEG4?.mpeg4Profile : (mediaMpeg4Profiles[profile] ?? profile)
    if (mpeg4GovLength === undefined || mpeg4Profile === undefined) {
      throw new OnvifError('Media v1 needs govLength and profile for MPV4-ES', context)
    }
    return { ...configuration, MPEG4: { govLength: mpeg4GovLength, mpeg4Profile } }
  }
  if (govLength !== undefined || profile !== undefined) {
    throw new OnvifError(`Media v1 has no GOP length or profile for ${encoding}`, context)
  }
  return configuration
}

const changedMedia2 = (
  reported: Media2.VideoEncoder2Configuration,
  changes: VideoEncoderChanges,
  context: ErrorContext
): Media2.VideoEncoder2Configuration => {
  const { encoding, resolution, quality, govLength, profile } = changes
  const rateControl = withRateControl(reported.rateControl, changes, context)
  const { profile: reportedProfile, ...rest } = reported
  const encodingChanged = encoding !== undefined && encoding !== reported.encoding
  return {
    ...rest,
    ...(encoding === undefined ? {} : { encoding }),
    ...(resolution ? { resolution: { ...reported.resolution, ...resolution } } : {}),
    ...(quality === undefined ? {} : { quality }),
    ...(rateControl ? { rateControl } : {}),
    ...(govLength === undefined ? {} : { govLength }),
    ...(profile !== undefined
      ? { profile }
      : reportedProfile === undefined || encodingChanged
        ? {}
        : { profile: reportedProfile })
  }
}

/**
 * List the video encoder configurations of the device, from the same service as `getProfiles()`.
 *
 * @param device - A connected device
 * @param options - Abort signal and timeout
 * @returns Every configuration, in the order the device reports them
 * @throws {OnvifError} If the device offers no usable media service, and the errors of `device.call()`
 */
export async function getVideoEncoderConfigurations(
  device: Device,
  options: MediaOptions = {}
): Promise<VideoEncoder[]> {
  return await fromEitherService(
    device,
    'GetVideoEncoderConfigurations',
    options,
    async (callOptions) => {
      const { configurations = [] } = await device.call(Media2.GetVideoEncoderConfigurations, {}, callOptions)
      return configurations.map(encoderOfMedia2)
    },
    async (callOptions) => {
      const { configurations = [] } = await device.call(Media.GetVideoEncoderConfigurations, {}, callOptions)
      return configurations.map(encoderOfMedia)
    }
  )
}

/**
 * Ask what an encoder accepts, on the service the encoder came from.
 *
 * @param device - A connected device
 * @param encoder - An encoder from `getVideoEncoderConfigurations()` or a profile, or its token and service
 * @param options - Abort signal and timeout
 * @returns The options for each codec the encoder offers
 * @throws {SoapFaultError} If the encoder does not exist (`NoConfig`)
 * @throws {OnvifError} The errors of `device.call()`
 */
export async function getVideoEncoderConfigurationOptions(
  device: Device,
  encoder: Pick<VideoEncoder, 'service' | 'token'>,
  options: MediaOptions = {}
): Promise<VideoEncoderOptions[]> {
  const configurationToken = encoder.token
  if (encoder.service === 'media2') {
    const response = await device.call(Media2.GetVideoEncoderConfigurationOptions, { configurationToken }, options)
    return response.options.map(optionsOfMedia2)
  }
  const response = await device.call(Media.GetVideoEncoderConfigurationOptions, { configurationToken }, options)
  return optionsOfMedia(response.options)
}

/**
 * Change an encoder, on the service it came from. The changes are applied to the configuration the device reported,
 * and the whole configuration is sent back. Changing the codec on Media2 drops the codec profile unless one is given.
 *
 * @param device - A connected device
 * @param encoder - An encoder from `getVideoEncoderConfigurations()` or a profile
 * @param changes - The fields to change
 * @param options - Abort signal and timeout
 * @returns The encoder as sent
 * @throws {SoapFaultError} If the device refuses the configuration (`ConfigModify`, `NoConfig`)
 * @throws {OnvifError} If a change needs settings the encoder does not report: a rate control, or on Media v1 a GOP
 *   length and profile for H264 and MPV4-ES and none for other codecs. And the errors of `device.call()`
 */
export async function setVideoEncoderConfiguration(
  device: Device,
  encoder: VideoEncoder,
  changes: VideoEncoderChanges,
  options: MediaOptions = {}
): Promise<VideoEncoder> {
  const context = contextOf(device, encoder.service, 'SetVideoEncoderConfiguration')
  if (encoder.service === 'media2') {
    const configuration = changedMedia2(encoder.reported, changes, context)
    await device.call(Media2.SetVideoEncoderConfiguration, { configuration }, options)
    return encoderOfMedia2(configuration)
  }
  const configuration = changedMedia(encoder.reported, changes, context)
  await device.call(Media.SetVideoEncoderConfiguration, { configuration, forcePersistence: true }, options)
  return encoderOfMedia(configuration)
}
