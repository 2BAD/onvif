import type { CallOptions, Device } from '@2bad/onvif'
import {
  ManagementClient as GeneratedManagementClient,
  type SetSystemDateAndTimeRequest,
  type SetSystemDateAndTimeResponse
} from '#generated/management.ts'
import { type UploadResult, uploadBackup, uploadFirmware } from '#upload.ts'

export class ManagementClient extends GeneratedManagementClient {
  readonly #device: Device

  constructor(device: Device) {
    super(device)
    this.#device = device
  }

  /**
   * Set the device date, time and time zone, then measure the device clock again. Both requests share one deadline.
   *
   * @param request - The `SetSystemDateAndTime` request
   * @param options - Call options
   * @returns The decoded `SetSystemDateAndTimeResponse`
   */
  override async setSystemDateAndTime(
    request: SetSystemDateAndTimeRequest,
    options: CallOptions = {}
  ): Promise<SetSystemDateAndTimeResponse> {
    const deadline = performance.now() + (options.timeoutMs ?? this.#device.timeoutMs)
    const response = await super.setSystemDateAndTime(request, options)
    await this.#device.synchronizeClock({
      signal: options.signal,
      timeoutMs: Math.max(0, deadline - performance.now())
    })
    return response
  }

  /**
   * Upload a firmware image with `StartFirmwareUpgrade` and an HTTP POST, after the upload delay the device asks for.
   * The device installs it and reboots.
   *
   * @param firmware - The firmware image
   * @param options - Abort signal and a timeout covering every step, which a large image needs
   * @returns How long the device expects to be unavailable
   */
  uploadFirmware(firmware: Uint8Array, options: Pick<CallOptions, 'signal' | 'timeoutMs'> = {}): Promise<UploadResult> {
    return uploadFirmware(this.#device, (call) => this.startFirmwareUpgrade({}, call), firmware, options)
  }

  /**
   * Upload a backup with `StartSystemRestore` and an HTTP POST. The device applies it and reboots if needed.
   *
   * @param backup - A backup file, such as one downloaded from `systemBackupUri` of `getSystemUris()`
   * @param options - Abort signal and a timeout covering every step
   * @returns How long the device expects to be unavailable
   */
  uploadBackup(backup: Uint8Array, options: Pick<CallOptions, 'signal' | 'timeoutMs'> = {}): Promise<UploadResult> {
    return uploadBackup(this.#device, (call) => this.startSystemRestore({}, call), backup, options)
  }
}

/**
 * Add the device management operations to a device as `device.management`.
 *
 * @param device - A connected device
 * @returns The properties to add
 * @example
 * const camera = device.use(management)
 * const { user = [] } = await camera.management.getUsers()
 */
export const management = (device: Device): { management: ManagementClient } => ({
  management: new ManagementClient(device)
})
