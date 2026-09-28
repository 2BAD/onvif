export {
  type CallOptions,
  type Clock,
  type ConnectOptions,
  DEVICE_NAMESPACE,
  Device,
  type ServiceAddressPolicy
} from '#device.ts'
export {
  AuthError,
  DecodeError,
  type ErrorContext,
  OnvifError,
  ParseError,
  type SoapFault,
  SoapFaultError,
  TimeoutError,
  TransportError
} from '#errors.ts'
export * as DeviceManagement from '#generated/device.ts'
export type { Operation, Schema } from '#soap/codec.ts'
export type { TlsOptions } from '#transport/http.ts'
