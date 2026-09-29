export {
  type CallOptions,
  type Clock,
  type ConnectOptions,
  type Download,
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
export type { EndpointReference } from '#soap/addressing.ts'
export { decode, type Operation, type Schema } from '#soap/codec.ts'
export { namespaceInfo, type XmlNamespaceInfo, type XmlNamespaces, type XmlValue } from '#soap/parse.ts'
export type { TlsOptions } from '#transport/http.ts'
