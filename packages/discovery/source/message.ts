import { randomUUID } from 'node:crypto'
import {
  DecodeError,
  type ErrorContext,
  namespaceInfo,
  OnvifError,
  parseEnvelope,
  serialize,
  type XmlObject,
  type XmlValue
} from '@2bad/onvif'

const SOAP = 'http://www.w3.org/2003/05/soap-envelope'
const WSA = 'http://schemas.xmlsoap.org/ws/2004/08/addressing'
const WSD = 'http://schemas.xmlsoap.org/ws/2005/04/discovery'
const NETWORK = 'http://www.onvif.org/ver10/network/wsdl'
const DEVICE = 'http://www.onvif.org/ver10/device/wsdl'
const SCOPE_PREFIX = 'onvif://www.onvif.org/'

/**
 * What to do with service addresses a reply lists on a host other than the one that sent it: `sender` drops them,
 * `any` keeps every HTTP and HTTPS address.
 */
export type XAddrPolicy = 'sender' | 'any'

export type QualifiedName = {
  /** `undefined` when the reply used a prefix it did not declare. */
  namespace: string | undefined
  name: string
}

export type DiscoveredDevice = {
  /** Endpoint reference address of the device, usually a `urn:uuid:`. It stays the same across reboots and IP changes. */
  endpoint: string
  /** Address the reply came from. */
  address: string
  /** Device service addresses allowed by the `xaddrs` policy, in the order the device listed them. */
  xaddrs: URL[]
  /** Addresses the device listed that the `xaddrs` policy dropped or that are not HTTP or HTTPS URLs. */
  droppedXAddrs: string[]
  types: QualifiedName[]
  scopes: string[]
  /** From the `onvif://www.onvif.org/name/` scope, percent-decoded. */
  name: string | undefined
  /** From the `onvif://www.onvif.org/hardware/` scope, percent-decoded. */
  hardware: string | undefined
  /** From the `onvif://www.onvif.org/Profile/` scopes, such as `Streaming`, `T` or `G`. */
  profiles: string[]
}

export type Probe = {
  messageId: string
  xml: string
}

/**
 * Build a WS-Discovery Probe for one device type. The type prefixes are declared on the envelope and the probe carries
 * an empty `Scopes`, the shape every camera answers.
 *
 * @param type - `NetworkVideoTransmitter` for cameras and encoders, `Device` for any ONVIF device
 * @returns The message id and the serialized envelope
 */
export function buildProbe(type: 'NetworkVideoTransmitter' | 'Device'): Probe {
  const messageId = `urn:uuid:${randomUUID()}`
  const envelope = serialize({
    name: 's:Envelope',
    attributes: { 'xmlns:s': SOAP, 'xmlns:a': WSA, 'xmlns:d': WSD, 'xmlns:dn': NETWORK, 'xmlns:tds': DEVICE },
    children: [
      {
        name: 's:Header',
        children: [
          { name: 'a:MessageID', children: [messageId] },
          { name: 'a:To', children: ['urn:schemas-xmlsoap-org:ws:2005:04:discovery'] },
          { name: 'a:Action', children: [`${WSD}/Probe`] }
        ]
      },
      {
        name: 's:Body',
        children: [
          {
            name: 'd:Probe',
            children: [
              { name: 'd:Types', children: [type === 'Device' ? 'tds:Device' : 'dn:NetworkVideoTransmitter'] },
              { name: 'd:Scopes' }
            ]
          }
        ]
      }
    ]
  })
  return { messageId, xml: `<?xml version="1.0" encoding="UTF-8"?>${envelope}` }
}

const isObject = (value: XmlValue | undefined): value is XmlObject => typeof value === 'object' && !Array.isArray(value)

const listOf = (value: XmlValue | undefined): XmlValue[] => {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

const textOf = (value: XmlValue | undefined): string => {
  const node = listOf(value)[0]
  if (typeof node === 'string') return node.trim()
  const text = isObject(node) ? node['_'] : undefined
  return typeof text === 'string' ? text.trim() : ''
}

const tokens = (text: string): string[] => text.split(/\s+/).filter((token) => token.length > 0)

const readTypes = (value: XmlValue | undefined): QualifiedName[] => {
  const node = listOf(value)[0]
  const namespaces = isObject(node) ? namespaceInfo(node)?.namespaces : undefined
  return tokens(textOf(node)).map((token) => {
    const colon = token.indexOf(':')
    return {
      namespace: namespaces?.[colon === -1 ? '' : token.slice(0, colon)],
      name: token.slice(colon + 1)
    }
  })
}

const isOnvifDevice = (types: QualifiedName[]): boolean =>
  types.length === 0 ||
  types.some(
    ({ namespace, name }) =>
      (namespace === NETWORK && name === 'NetworkVideoTransmitter') || (namespace === DEVICE && name === 'Device')
  )

const decodeScope = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const scopeValues = (scopes: string[], category: string): string[] => {
  const prefix = `${SCOPE_PREFIX}${category}/`.toLowerCase()
  return scopes
    .filter((scope) => scope.toLowerCase().startsWith(prefix) && scope.length > prefix.length)
    .map((scope) => decodeScope(scope.slice(prefix.length)))
}

const readXAddrs = (
  text: string,
  sender: string,
  policy: XAddrPolicy
): Pick<DiscoveredDevice, 'xaddrs' | 'droppedXAddrs'> => {
  const xaddrs: URL[] = []
  const droppedXAddrs: string[] = []
  for (const token of tokens(text)) {
    const url = URL.parse(token)
    const web = url !== null && (url.protocol === 'http:' || url.protocol === 'https:')
    if (web && (policy === 'any' || url.hostname === sender)) xaddrs.push(url)
    else droppedXAddrs.push(token)
  }
  return { xaddrs, droppedXAddrs }
}

export type Reply = {
  devices: DiscoveredDevice[]
  /** One error per ProbeMatch that could not be decoded; the others are still returned. */
  errors: DecodeError[]
}

/**
 * Read a ProbeMatches reply to one of our probes. Matches that list types but neither `dn:NetworkVideoTransmitter`
 * nor `tds:Device` are left out, since printers and computers answer probes too.
 *
 * @param xml - The datagram as text
 * @param sender - Address the datagram came from
 * @param probes - Message ids of the probes sent
 * @param policy - Which service addresses to keep
 * @returns The ONVIF devices in the reply and the matches that could not be decoded
 * @throws {ParseError} If the datagram is not a well formed SOAP envelope
 * @throws {SoapFaultError} If it is a fault
 * @throws {OnvifError} If it is not a ProbeMatches answering one of `probes`
 */
export function readProbeMatches(xml: string, sender: string, probes: ReadonlySet<string>, policy: XAddrPolicy): Reply {
  const context: ErrorContext = { host: sender, service: 'discovery', action: 'ProbeMatches' }
  const { header, body } = parseEnvelope(xml, context, undefined, { namespaces: true })
  const matches = body['ProbeMatches']
  if (!isObject(matches) || namespaceInfo(matches)?.namespace !== WSD) {
    throw new OnvifError('Reply is not a WS-Discovery ProbeMatches', context)
  }
  if (!probes.has(textOf(header?.['RelatesTo']))) throw new OnvifError('Reply does not answer this probe', context)

  const devices: DiscoveredDevice[] = []
  const errors: DecodeError[] = []
  listOf(matches['ProbeMatch']).forEach((match, index) => {
    const path = `ProbeMatches/ProbeMatch[${index}]`
    const reference = isObject(match) ? listOf(match['EndpointReference'])[0] : undefined
    const endpoint = isObject(reference) ? textOf(reference['Address']) : ''
    if (!isObject(match) || endpoint.length === 0) {
      errors.push(new DecodeError('Missing element', `${path}/EndpointReference/Address`, context))
      return
    }
    const types = readTypes(match['Types'])
    if (!isOnvifDevice(types)) return
    const scopes = tokens(textOf(match['Scopes']))
    devices.push({
      endpoint,
      address: sender,
      ...readXAddrs(textOf(match['XAddrs']), sender, policy),
      types,
      scopes,
      name: scopeValues(scopes, 'name')[0],
      hardware: scopeValues(scopes, 'hardware')[0],
      profiles: scopeValues(scopes, 'Profile')
    })
  })
  return { devices, errors }
}
