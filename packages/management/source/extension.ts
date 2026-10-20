import { setTimeout as sleep } from 'node:timers/promises'
import { type CallOptions, DecodeError, type Device, TimeoutError } from '@2bad/onvif'
import {
  ManagementClient as GeneratedManagementClient,
  type SetSystemDateAndTimeRequest,
  type SetSystemDateAndTimeResponse
} from '#generated/management.ts'

export type UploadResult = {
  /** How long the device expects to be unavailable, as an `xs:duration` such as `PT2M`. */
  expectedDownTime: string
}

const DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/

const durationMs = (value: string): number | undefined => {
  const trimmed = value.trim()
  const match = DURATION.exec(trimmed)
  if (!match || trimmed === 'P' || trimmed.endsWith('T')) return undefined
  const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = match
  return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60_000 + Number(seconds) * 1000
}

const wait = async (ms: number, signal: AbortSignal | undefined): Promise<void> => {
  try {
    await sleep(ms, undefined, { signal })
  } catch (error) {
    signal?.throwIfAborted()
    throw error
  }
}

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
    return this.#upload('StartFirmwareUpgrade', (call) => this.startFirmwareUpgrade({}, call), firmware, options)
  }

  /**
   * Upload a backup with `StartSystemRestore` and an HTTP POST. The device applies it and reboots if needed.
   *
   * @param backup - A backup file, such as one downloaded from `systemBackupUri` of `getSystemUris()`
   * @param options - Abort signal and a timeout covering every step
   * @returns How long the device expects to be unavailable
   */
  uploadBackup(backup: Uint8Array, options: Pick<CallOptions, 'signal' | 'timeoutMs'> = {}): Promise<UploadResult> {
    return this.#upload('StartSystemRestore', (call) => this.startSystemRestore({}, call), backup, options)
  }

  async #upload(
    action: string,
    start: (options: CallOptions) => Promise<{ uploadUri: string; uploadDelay?: string; expectedDownTime: string }>,
    body: Uint8Array,
    options: Pick<CallOptions, 'signal' | 'timeoutMs'>
  ): Promise<UploadResult> {
    const { signal, timeoutMs = this.#device.timeoutMs } = options
    const deadline = performance.now() + timeoutMs
    const { uploadUri, uploadDelay, expectedDownTime } = await start({ signal, timeoutMs })
    if (uploadDelay !== undefined) {
      const context = { host: this.#device.address.host, service: 'tds', action }
      const delayMs = durationMs(uploadDelay)
      if (delayMs === undefined) {
        throw new DecodeError(
          `Invalid duration '${uploadDelay.slice(0, 64)}'`,
          `${action}Response.UploadDelay`,
          context
        )
      }
      if (performance.now() + delayMs >= deadline) {
        throw new TimeoutError(`Upload delay of ${uploadDelay} exceeds the timeout of ${timeoutMs} ms`, context)
      }
      await wait(delayMs, signal)
    }
    await this.#device.upload(uploadUri, body, { signal, timeoutMs: Math.max(0, deadline - performance.now()) })
    return { expectedDownTime }
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
