import { OnvifError } from '../errors.ts'
import { isAllowedCodePoint } from './parse.ts'

export type XmlElement = {
  name: string
  attributes?: Record<string, string>
  children?: XmlNode[]
}

export type XmlNode = XmlElement | string

const escapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
  '\t': '&#9;',
  '\n': '&#10;',
  '\r': '&#13;'
}

const checkCharacters = (value: string): void => {
  for (const character of value) {
    if (!isAllowedCodePoint(character.codePointAt(0) ?? 0)) {
      throw new OnvifError('Value contains a character that XML cannot represent')
    }
  }
}

export const escapeText = (value: string): string => {
  checkCharacters(value)
  return value.replace(/[&<>\r]/g, (char) => escapes[char] ?? char)
}

export const escapeAttribute = (value: string): string => {
  checkCharacters(value)
  return value.replace(/[&<>"'\t\n\r]/g, (char) => escapes[char] ?? char)
}

/**
 * Serialize an element tree to XML. Text and attribute values are escaped; names are written as given and must come
 * from trusted code, never from input.
 *
 * @param node - The element or text to serialize
 * @returns The XML string
 * @throws {OnvifError} If a value contains a character that XML cannot represent
 */
export function serialize(node: XmlNode): string {
  if (typeof node === 'string') return escapeText(node)
  let xml = `<${node.name}`
  if (node.attributes) {
    for (const [name, value] of Object.entries(node.attributes)) xml += ` ${name}="${escapeAttribute(value)}"`
  }
  if (!node.children || node.children.length === 0) return `${xml}/>`
  xml += '>'
  for (const child of node.children) xml += serialize(child)
  return `${xml}</${node.name}>`
}
