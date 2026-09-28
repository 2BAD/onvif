import { randomUUID } from 'node:crypto'
import { OnvifError } from '#errors.ts'
import { XML_NAMESPACE } from '#soap/namespaces.ts'
import { namespaceInfo, type XmlObject } from '#soap/parse.ts'
import type { XmlElement, XmlNode } from '#soap/serialize.ts'

const WSA = 'http://www.w3.org/2005/08/addressing'

/** A WS-Addressing endpoint reference as decoded from a response, such as a subscription reference. */
export type EndpointReference = {
  address: { value: string }
  referenceParameters?: { $any?: Record<string, unknown> }
}

/**
 * Build WS-Addressing 1.0 header blocks for a request.
 *
 * @param action - Action URI of the operation
 * @param to - Address the message is sent to, as the device issued it
 * @returns `wsa:MessageID`, `wsa:To` and `wsa:Action` header blocks
 */
export function addressingHeaders(action: string, to: string): XmlElement[] {
  const attributes = { 'xmlns:wsa': WSA }
  return [
    { name: 'wsa:MessageID', attributes, children: [`urn:uuid:${randomUUID()}`] },
    { name: 'wsa:To', attributes: { ...attributes, 's:mustUnderstand': '1' }, children: [to] },
    { name: 'wsa:Action', attributes: { ...attributes, 's:mustUnderstand': '1' }, children: [action] }
  ]
}

class Copier {
  readonly prefixes = new Map<string, string>()

  element(name: string, value: unknown): XmlElement {
    const info = typeof value === 'object' && value !== null ? namespaceInfo(value) : undefined
    if (!info) throw new OnvifError('Reference parameters can only be echoed from a response parsed with namespaces')
    const node = value as XmlObject
    const attributes: Record<string, string> = {}
    const children: XmlNode[] = []
    const attributeValues = node['$']
    if (typeof attributeValues === 'object' && !Array.isArray(attributeValues)) {
      for (const [local, attributeValue] of Object.entries(attributeValues)) {
        const prefixed = info.attributes !== undefined && local in info.attributes
        const namespace = prefixed ? info.attributes?.[local] : undefined
        if (prefixed && namespace === undefined) {
          throw new OnvifError(`Reference parameter attribute ${local} has an undeclared prefix`)
        }
        attributes[this.#qualify(local, namespace)] = String(attributeValue)
      }
    }
    const text = node['_']
    if (typeof text === 'string') children.push(text)
    for (const [key, child] of Object.entries(node)) {
      if (key === '$' || key === '_') continue
      for (const item of Array.isArray(child) ? child : [child]) children.push(this.element(key, item))
    }
    return { name: this.#qualify(name, info.namespace), attributes, children }
  }

  #qualify(name: string, namespace: string | undefined): string {
    if (namespace === undefined) return name
    if (namespace === XML_NAMESPACE) return `xml:${name}`
    let prefix = this.prefixes.get(namespace)
    if (prefix === undefined) {
      prefix = `rp${this.prefixes.size}`
      this.prefixes.set(namespace, prefix)
    }
    return `${prefix}:${name}`
  }
}

/**
 * Turn the reference parameters of an endpoint reference into SOAP header blocks, as the WS-Addressing SOAP binding
 * requires for every message sent to that endpoint. Names, namespaces, attributes and text are copied; the prefixes
 * are new.
 *
 * @param reference - Endpoint reference decoded from a response parsed with namespaces
 * @returns One header block per reference parameter, marked with `wsa:IsReferenceParameter`
 * @throws {OnvifError} If the reference was parsed without namespaces or uses an undeclared prefix
 */
export function referenceParameterHeaders(reference: EndpointReference): XmlElement[] {
  const headers: XmlElement[] = []
  for (const [name, value] of Object.entries(reference.referenceParameters?.$any ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      const copier = new Copier()
      const element = copier.element(name, item)
      const declarations: Record<string, string> = { 'xmlns:wsa': WSA, 'wsa:IsReferenceParameter': 'true' }
      for (const [namespace, prefix] of copier.prefixes) declarations[`xmlns:${prefix}`] = namespace
      headers.push({ ...element, attributes: { ...declarations, ...element.attributes } })
    }
  }
  return headers
}
