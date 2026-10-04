export type { EndpointReference } from '#soap/addressing.ts'
export { decode, type Operation, type Schema } from '#soap/codec.ts'
export { type Envelope, parseEnvelope } from '#soap/envelope.ts'
export {
  namespaceInfo,
  type XmlLimits,
  type XmlNamespaceInfo,
  type XmlNamespaces,
  type XmlObject,
  type XmlOptions,
  type XmlValue
} from '#soap/parse.ts'
export { serialize, type XmlElement, type XmlNode } from '#soap/serialize.ts'
