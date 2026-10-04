export {
  getVideoEncoderConfigurationOptions,
  getVideoEncoderConfigurations,
  setVideoEncoderConfiguration,
  type VideoEncoder,
  type VideoEncoderChanges,
  type VideoEncoderOptions
} from '#encoder.ts'
export { media } from '#extension.ts'
export * as Media from '#generated/media.ts'
export type { VideoSourceConfiguration } from '#generated/media.ts'
export * as Media2 from '#generated/media2.ts'
export {
  defaultProfile,
  fetchSnapshot,
  getProfiles,
  getSnapshotUri,
  getStreamUri,
  getVideoSourceConfigurations,
  type MediaAddress,
  type Profile,
  type StreamOptions
} from '#media.ts'
export type { MediaOptions } from '#service.ts'
