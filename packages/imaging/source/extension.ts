import type { Device } from '@2bad/onvif'
import { ImagingClient } from '#generated/imaging.ts'

/**
 * Add the imaging operations to a device as `device.imaging`.
 *
 * @param device - A connected device
 * @returns The properties to add
 * @example
 * const camera = device.use(imaging)
 * const source = camera.imaging.forVideoSource('VideoSource_1')
 * await source.setImagingSettings({ imagingSettings: { brightness: 60 } })
 */
export const imaging = (device: Device) => ({ imaging: new ImagingClient(device) })
