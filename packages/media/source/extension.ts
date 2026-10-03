import type { Device } from '@2bad/onvif'
import {
  getVideoEncoderConfigurationOptions,
  getVideoEncoderConfigurations,
  setVideoEncoderConfiguration
} from '#encoder.ts'
import { fetchSnapshot, getProfiles, getSnapshotUri, getStreamUri, getVideoSourceConfigurations } from '#media.ts'

/**
 * Add the media functions to a device as `device.media`, called without the device argument.
 *
 * @param device - A connected device
 * @returns The properties to add
 * @example
 * const camera = device.use(media)
 * const profiles = await camera.media.getProfiles()
 */
export const media = (device: Device) => ({
  media: {
    getProfiles: getProfiles.bind(undefined, device),
    getVideoSourceConfigurations: getVideoSourceConfigurations.bind(undefined, device),
    getSnapshotUri: getSnapshotUri.bind(undefined, device),
    getStreamUri: getStreamUri.bind(undefined, device),
    fetchSnapshot: fetchSnapshot.bind(undefined, device),
    getVideoEncoderConfigurations: getVideoEncoderConfigurations.bind(undefined, device),
    getVideoEncoderConfigurationOptions: getVideoEncoderConfigurationOptions.bind(undefined, device),
    setVideoEncoderConfiguration: setVideoEncoderConfiguration.bind(undefined, device)
  }
})
