import type { Device } from '@2bad/onvif'
import {
  getVideoEncoderConfigurationOptions,
  getVideoEncoderConfigurations,
  setVideoEncoderConfiguration
} from '#encoder.ts'
import { MediaClient } from '#generated/media.ts'
import { Media2Client } from '#generated/media2.ts'
import { fetchSnapshot, getProfiles, getSnapshotUri, getStreamUri, getVideoSourceConfigurations } from '#media.ts'

/**
 * Add the media functions to a device as `device.media`, called without the device argument. `device.media.v1` and
 * `device.media.v2` have a method per Media and Media2 operation.
 *
 * @param device - A connected device
 * @returns The properties to add
 * @example
 * const camera = device.use(media)
 * const profiles = await camera.media.getProfiles()
 * const { profiles: reported = [] } = await camera.media.v2.getProfiles({ type: ['All'] })
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
    setVideoEncoderConfiguration: setVideoEncoderConfiguration.bind(undefined, device),
    v1: new MediaClient(device),
    v2: new Media2Client(device)
  }
})
