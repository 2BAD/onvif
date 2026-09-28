import { setTimeout as sleep } from 'node:timers/promises'
import {
  AuthError,
  DecodeError,
  type Device,
  type EndpointReference,
  OnvifError,
  ParseError,
  SoapFaultError,
  TimeoutError,
  TransportError
} from '@2bad/onvif'
import { CreatePullPointSubscription, PullMessages, Renew, Unsubscribe } from '#generated/events.ts'
import { decodeNotification, type Notification } from '#notification.ts'

export type SubscribeOptions = {
  /**
   * Receives every failure the subscription recovers from: lost connections, SOAP faults, expired or rebuilt pull
   * points, responses and messages that could not be decoded. Failures it cannot recover from (rejected credentials,
   * an address the service address policy refuses) close the subscription and are thrown from the iteration instead.
   */
  onError: (error: OnvifError) => void
  /** Closes the subscription when aborted, and aborts `subscribe()` itself. */
  signal?: AbortSignal
  /**
   * How long one PullMessages waits on the device for events, 10 000 ms by default. Halved when the device keeps
   * resetting long polls, and doubled back after 10 minutes without a reset.
   */
  pullTimeoutMs?: number
  /** Most notifications per PullMessages, 100 by default. */
  messageLimit?: number
  /** Lifetime asked for when creating and renewing a pull point, 60 000 ms by default. */
  terminationMs?: number
}

const RESPONSE_MARGIN_MS = 10_000
const RENEW_MARGIN_MS = 5_000
const MIN_PULL_TIMEOUT_MS = 1_000
const RESTORE_PULL_TIMEOUT_AFTER_MS = 10 * 60_000
const MAX_BACKOFF_MS = 60_000
const UNSUBSCRIBE_TIMEOUT_MS = 5_000

const duration = (ms: number): string => `PT${Number((ms / 1000).toFixed(3))}S`

const hasFault = (error: unknown, name: string): boolean =>
  error instanceof SoapFaultError && [error.code, ...error.subcodes].includes(name)

const isAbort = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError'

const isRecoverable = (error: unknown): error is OnvifError =>
  !(error instanceof AuthError) &&
  (error instanceof SoapFaultError ||
    error instanceof TransportError ||
    error instanceof TimeoutError ||
    error instanceof ParseError ||
    error instanceof DecodeError)

/**
 * A real-time pull point subscription. Iterate it to receive notifications; it pulls only while it is iterated,
 * renews the pull point when the device does not extend it on pulls, and rebuilds it with backoff after failures
 * until it is closed. Breaking out of the loop closes it.
 */
export class Subscription implements AsyncIterableIterator<Notification>, AsyncDisposable {
  readonly #device: Device
  readonly #onError: (error: OnvifError) => void
  readonly #messageLimit: number
  readonly #terminationMs: number
  readonly #configuredPullTimeoutMs: number
  readonly #controller = new AbortController()
  readonly #buffer: Notification[] = []
  #pullTimeoutMs: number
  #reference: EndpointReference | undefined
  #expiresAt = 0
  #renew = true
  #failures = 0
  #resets = 0
  #pullTimeoutSince = 0
  #closed = false
  #closing: Promise<void> | undefined
  #queue: Promise<void> = Promise.resolve()
  #detachSignal: (() => void) | undefined

  /**
   * Create a real-time pull point subscription on the device's event service.
   *
   * @param device - A connected device
   * @param options - Error callback, abort signal and pull settings
   * @returns The subscription, ready to iterate
   * @throws {AuthError} If the credentials are rejected
   * @throws {SoapFaultError} If the device refuses the subscription, for example because all pull points are taken
   * @throws {OnvifError} If the device does not offer an event service
   */
  static async open(device: Device, options: SubscribeOptions): Promise<Subscription> {
    const subscription = new Subscription(device, options)
    const { signal } = options
    await subscription.#create(signal)
    if (signal) {
      const onAbort = async () => {
        await subscription.close()
      }
      signal.addEventListener('abort', onAbort, { once: true })
      subscription.#detachSignal = () => signal.removeEventListener('abort', onAbort)
      if (signal.aborted) await subscription.close()
    }
    return subscription
  }

  private constructor(device: Device, options: SubscribeOptions) {
    this.#device = device
    this.#onError = options.onError
    this.#pullTimeoutMs = options.pullTimeoutMs ?? 10_000
    this.#configuredPullTimeoutMs = this.#pullTimeoutMs
    this.#messageLimit = options.messageLimit ?? 100
    this.#terminationMs = options.terminationMs ?? 60_000
  }

  /** Address of the current pull point, `undefined` while it is being rebuilt. */
  get address(): string | undefined {
    return this.#reference?.address.value
  }

  [Symbol.asyncIterator](): this {
    return this
  }

  async next(): Promise<IteratorResult<Notification>> {
    const previous = this.#queue
    let release = () => {}
    this.#queue = new Promise((resolve) => {
      release = resolve
    })
    try {
      await previous
      return await this.#next()
    } finally {
      release()
    }
  }

  async return(): Promise<IteratorResult<Notification>> {
    await this.close()
    return { value: undefined, done: true }
  }

  /** Stop pulling and unsubscribe. Safe to call more than once and from any state. */
  close(): Promise<void> {
    this.#closing ??= this.#shutdown(true)
    return this.#closing
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }

  async #next(): Promise<IteratorResult<Notification>> {
    while (!this.#closed) {
      const queued = this.#buffer.shift()
      if (queued) return { value: queued, done: false }
      try {
        if (this.#reference) {
          await this.#pull()
          this.#failures = 0
        } else {
          await this.#create(this.#controller.signal)
        }
      } catch (error) {
        if (this.#closed) break
        await this.#recover(error)
      }
    }
    return { value: undefined, done: true }
  }

  async #create(signal?: AbortSignal): Promise<void> {
    const response = await this.#device.call(
      CreatePullPointSubscription,
      { initialTerminationTime: duration(this.#terminationMs) },
      { signal }
    )
    this.#device.resolveAddress(response.subscriptionReference.address.value)
    this.#reference = response.subscriptionReference
    this.#track(response.terminationTime, response.currentTime)
  }

  async #pull(): Promise<void> {
    const reference = this.#reference as EndpointReference
    const started = performance.now()
    let response
    try {
      response = await this.#device.call(
        PullMessages,
        { timeout: duration(this.#pullTimeoutMs), messageLimit: this.#messageLimit },
        {
          to: reference,
          addressing: true,
          timeoutMs: this.#pullTimeoutMs + RESPONSE_MARGIN_MS,
          signal: this.#controller.signal
        }
      )
    } catch (error) {
      this.#adaptToResets(error, performance.now() - started)
      throw error
    }
    this.#resets = 0
    this.#restorePullTimeout()
    this.#track(response.terminationTime, response.currentTime)
    const context = { host: this.#device.address.host, service: 'tev', action: 'PullMessages' }
    for (const holder of response.notificationMessage ?? []) {
      try {
        this.#buffer.push(decodeNotification(holder, context))
      } catch (error) {
        if (!(error instanceof DecodeError)) throw error
        this.#onError(error)
      }
    }
    if (this.#renew && this.#expiresAt - performance.now() < this.#pullTimeoutMs + RENEW_MARGIN_MS) {
      await this.#renewPullPoint(reference)
    }
  }

  async #renewPullPoint(reference: EndpointReference): Promise<void> {
    try {
      const response = await this.#device.call(
        Renew,
        { terminationTime: duration(this.#terminationMs) },
        { to: reference, addressing: true, signal: this.#controller.signal }
      )
      this.#track(response.terminationTime, response.currentTime)
    } catch (error) {
      if (!(error instanceof SoapFaultError) || error instanceof AuthError || hasFault(error, 'ResourceUnknownFault')) {
        throw error
      }
      this.#renew = false
      this.#onError(error)
    }
  }

  /**
   * Device termination time minus device current time, so the device clock never has to match ours.
   *
   * @param terminationTime - When the device will drop the pull point
   * @param currentTime - Device time of the same response, if it sent one
   */
  #track(terminationTime: Date, currentTime: Date | undefined): void {
    const deviceNow = currentTime?.getTime() ?? Date.now() + this.#device.clock.skewMs
    this.#expiresAt = performance.now() + (terminationTime.getTime() - deviceNow)
  }

  /**
   * Devices that drop idle connections (TP-Link) reset every long poll; pull for less time than they allow.
   *
   * @param error - Why the pull failed
   * @param elapsedMs - How long the pull ran
   */
  #adaptToResets(error: unknown, elapsedMs: number): void {
    if (!(error instanceof TransportError) || elapsedMs >= this.#pullTimeoutMs) return
    this.#resets++
    this.#pullTimeoutSince = performance.now()
    if (this.#resets >= 2) this.#pullTimeoutMs = Math.max(MIN_PULL_TIMEOUT_MS, Math.floor(this.#pullTimeoutMs / 2))
  }

  #restorePullTimeout(): void {
    if (this.#pullTimeoutMs >= this.#configuredPullTimeoutMs) return
    if (performance.now() - this.#pullTimeoutSince < RESTORE_PULL_TIMEOUT_AFTER_MS) return
    this.#pullTimeoutMs = Math.min(this.#configuredPullTimeoutMs, this.#pullTimeoutMs * 2)
    this.#pullTimeoutSince = performance.now()
  }

  async #recover(error: unknown): Promise<void> {
    if (!isRecoverable(error)) {
      if (error instanceof OnvifError) {
        this.#closing ??= this.#shutdown(false)
        await this.#closing
      }
      throw error
    }
    this.#onError(error)
    const expired = hasFault(error, 'ResourceUnknownFault')
    const stillValid =
      error instanceof DecodeError ||
      ((error instanceof TransportError || error instanceof TimeoutError) && performance.now() < this.#expiresAt)
    if (expired) this.#reference = undefined
    else if (!stillValid) await this.#unsubscribe()

    const delay = expired && this.#failures === 0 ? 0 : Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.#failures)
    this.#failures++
    if (delay === 0) return
    try {
      await sleep(delay * (0.5 + Math.random() / 2), undefined, { signal: this.#controller.signal })
    } catch (sleepError) {
      if (!isAbort(sleepError)) throw sleepError
    }
  }

  async #unsubscribe(): Promise<void> {
    const reference = this.#reference
    this.#reference = undefined
    if (!reference) return
    try {
      await this.#device.call(Unsubscribe, {}, { to: reference, addressing: true, timeoutMs: UNSUBSCRIBE_TIMEOUT_MS })
    } catch (error) {
      if (!(error instanceof OnvifError)) throw error
      this.#onError(error)
    }
  }

  async #shutdown(waitForPull: boolean): Promise<void> {
    this.#closed = true
    this.#controller.abort()
    this.#detachSignal?.()
    if (waitForPull) await this.#queue
    await this.#unsubscribe()
  }
}
