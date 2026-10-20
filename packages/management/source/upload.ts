import { setTimeout as sleep } from 'node:timers/promises'
import { type CallOptions, DecodeError, type Device, TimeoutError } from '@2bad/onvif'

export type UploadResult = {
  /** How long the device expects to be unavailable, as an `xs:duration` such as `PT2M`. */
  expectedDownTime: string
}

const DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/

const durationMs = (value: string): number | undefined => {
  const match = DURATION.exec(value.trim())
  if (!match || value.trim() === 'P' || value.trim().endsWith('T')) return undefined
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

/**
 * Upload a firmware image the way `StartFirmwareUpgrade` describes: ask for the upload address, wait the upload
 * delay, then POST the image. All steps share one deadline.
 *
 * @param device - A connected device
 * @param start - The `StartFirmwareUpgrade` call
 * @param firmware - The firmware image
 * @param options - Abort signal and a timeout overriding the connection timeout
 * @returns The expected down time
 */
export const uploadFirmware = async (
  device: Device,
  start: (options: CallOptions) => Promise<{ uploadUri: string; uploadDelay: string; expectedDownTime: string }>,
  firmware: Uint8Array,
  options: Pick<CallOptions, 'signal' | 'timeoutMs'> = {}
): Promise<UploadResult> => {
  const { signal, timeoutMs = device.timeoutMs } = options
  const deadline = performance.now() + timeoutMs
  const { uploadUri, uploadDelay, expectedDownTime } = await start({ signal, timeoutMs })
  const context = { host: device.address.host, service: 'tds', action: 'StartFirmwareUpgrade' }
  const delayMs = durationMs(uploadDelay)
  if (delayMs === undefined) {
    throw new DecodeError(
      `Invalid duration '${uploadDelay.slice(0, 64)}'`,
      'StartFirmwareUpgradeResponse.UploadDelay',
      context
    )
  }
  if (performance.now() + delayMs >= deadline) {
    throw new TimeoutError(`Upload delay of ${uploadDelay} exceeds the timeout of ${timeoutMs} ms`, context)
  }
  await wait(delayMs, signal)
  await device.upload(uploadUri, firmware, { signal, timeoutMs: Math.max(0, deadline - performance.now()) })
  return { expectedDownTime }
}

/**
 * Upload a backup the way `StartSystemRestore` describes: ask for the upload address, then POST the backup. Both
 * steps share one deadline.
 *
 * @param device - A connected device
 * @param start - The `StartSystemRestore` call
 * @param backup - The backup file
 * @param options - Abort signal and a timeout overriding the connection timeout
 * @returns The expected down time
 */
export const uploadBackup = async (
  device: Device,
  start: (options: CallOptions) => Promise<{ uploadUri: string; expectedDownTime: string }>,
  backup: Uint8Array,
  options: Pick<CallOptions, 'signal' | 'timeoutMs'> = {}
): Promise<UploadResult> => {
  const { signal, timeoutMs = device.timeoutMs } = options
  const deadline = performance.now() + timeoutMs
  const { uploadUri, expectedDownTime } = await start({ signal, timeoutMs })
  await device.upload(uploadUri, backup, { signal, timeoutMs: Math.max(0, deadline - performance.now()) })
  return { expectedDownTime }
}
