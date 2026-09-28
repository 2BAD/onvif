import { AuthError, type ErrorContext, ParseError, type SoapFault, SoapFaultError } from '#errors.ts'
import { parseXml, type XmlLimits, type XmlObject, type XmlOptions, type XmlValue } from '#soap/parse.ts'
import { serialize, type XmlElement, type XmlNode } from '#soap/serialize.ts'

export const SOAP_NAMESPACE = 'http://www.w3.org/2003/05/soap-envelope'

export type Envelope = {
  header: XmlObject | undefined
  body: XmlObject
}

const authFaults = new Set(['NotAuthorized', 'FailedAuthentication', 'InvalidSecurity', 'InvalidSecurityToken'])

/**
 * Build a SOAP 1.2 envelope. The envelope prefix is `s`.
 *
 * @param body - The operation element, carrying its own namespace declaration
 * @param header - Header blocks such as WS-Security or WS-Addressing
 * @returns The serialized envelope with an XML declaration
 */
export function buildEnvelope(body: XmlElement, header: XmlNode[] = []): string {
  const children: XmlNode[] = header.length > 0 ? [{ name: 's:Header', children: header }] : []
  children.push({ name: 's:Body', children: [body] })
  return `<?xml version="1.0" encoding="UTF-8"?>${serialize({ name: 's:Envelope', attributes: { 'xmlns:s': SOAP_NAMESPACE }, children })}`
}

const isObject = (value: XmlValue | undefined): value is XmlObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const first = (value: XmlValue | undefined): XmlValue | undefined => (Array.isArray(value) ? value[0] : value)

const textOf = (value: XmlValue | undefined): string => {
  const node = first(value)
  if (typeof node === 'string') return node
  if (isObject(node) && typeof node['_'] === 'string') return node['_']
  return ''
}

const localName = (qualified: string): string => qualified.slice(qualified.indexOf(':') + 1).trim()

const readFault = (fault: XmlObject): SoapFault => {
  if (fault['Code'] !== undefined) {
    const code = first(fault['Code'])
    const subcodes: string[] = []
    let subcode = isObject(code) ? first(code['Subcode']) : undefined
    while (isObject(subcode) && subcodes.length < 8) {
      subcodes.push(localName(textOf(subcode['Value'])))
      subcode = first(subcode['Subcode'])
    }
    const reason = first(fault['Reason'])
    return {
      code: localName(textOf(isObject(code) ? code['Value'] : undefined)),
      subcodes,
      reason: textOf(isObject(reason) ? reason['Text'] : undefined)
    }
  }
  return { code: localName(textOf(fault['faultcode'])), subcodes: [], reason: textOf(fault['faultstring']) }
}

/**
 * Parse a SOAP response and raise its fault, if any, as an error.
 *
 * @param xml - The response body
 * @param context - Host, service and action for error reporting
 * @param limits - Parser resource limits
 * @param options - Parser options
 * @returns The header and body children with namespace prefixes removed
 * @throws {ParseError} If the response is not well formed or not a SOAP envelope
 * @throws {AuthError} If the fault reports failed authentication
 * @throws {SoapFaultError} For any other fault
 */
export function parseEnvelope(
  xml: string,
  context: ErrorContext = {},
  limits?: Partial<XmlLimits>,
  options?: XmlOptions
): Envelope {
  let document: XmlObject
  try {
    document = parseXml(xml, limits, options)
  } catch (error) {
    if (error instanceof ParseError) throw new ParseError(error.reason, error.position, context)
    throw error
  }

  const envelope = document['Envelope']
  if (!isObject(envelope) || envelope['Body'] === undefined) throw new ParseError('Not a SOAP envelope', 0, context)
  const body = isObject(envelope['Body']) ? envelope['Body'] : {}
  const header = isObject(envelope['Header']) ? envelope['Header'] : undefined

  const fault = first(body['Fault'])
  if (fault !== undefined) {
    const details = readFault(isObject(fault) ? fault : {})
    if ([details.code, ...details.subcodes].some((code) => authFaults.has(code))) {
      throw new AuthError(`Not authorized: ${details.reason}`, context, details)
    }
    throw new SoapFaultError(details, context)
  }
  return { header, body }
}
