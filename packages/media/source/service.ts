import {
  type CallOptions,
  DecodeError,
  type Device,
  type ErrorContext,
  ParseError,
  SoapFaultError,
  TimeoutError,
  TransportError
} from '@2bad/onvif'

export type MediaOptions = Pick<CallOptions, 'signal' | 'timeoutMs'>

const MEDIA_NAMESPACE = 'http://www.onvif.org/ver10/media/wsdl'
const MEDIA2_NAMESPACE = 'http://www.onvif.org/ver20/media/wsdl'

export const contextOf = (device: Device, service: 'media' | 'media2', action: string): ErrorContext => ({
  host: device.address.host,
  service: service === 'media2' ? 'tr2' : 'trt',
  action
})

const answeredBadly = (error: unknown): boolean =>
  error instanceof SoapFaultError ||
  error instanceof DecodeError ||
  error instanceof ParseError ||
  (error instanceof TransportError && error.status !== undefined)

// Media2 when the device offers it, Media v1 when it does not or Media2 answers with an error, under one timeout
export const fromEitherService = async <Result>(
  device: Device,
  action: string,
  options: MediaOptions,
  media2: (callOptions: MediaOptions) => Promise<Result>,
  media: (callOptions: MediaOptions) => Promise<Result>
): Promise<Result> => {
  if (!device.services.has(MEDIA2_NAMESPACE)) return await media(options)
  const timeoutMs = options.timeoutMs ?? device.timeoutMs
  const deadline = performance.now() + timeoutMs
  try {
    return await media2({ ...options, timeoutMs })
  } catch (error) {
    if (!device.services.has(MEDIA_NAMESPACE) || !answeredBadly(error)) throw error
    const remainingMs = deadline - performance.now()
    if (remainingMs <= 0) {
      throw new TimeoutError(`No response within ${timeoutMs} ms`, contextOf(device, 'media', action), {
        cause: error
      })
    }
    return await media({ ...options, timeoutMs: remainingMs })
  }
}
