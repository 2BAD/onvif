import type { CallOptions, Device } from '@2bad/onvif'
import {
  ManagementClient,
  type SetSystemDateAndTimeRequest,
  type SetSystemDateAndTimeResponse
} from '#generated/management.ts'

class Management extends ManagementClient {
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
export const management = (device: Device): { management: ManagementClient } => ({ management: new Management(device) })
