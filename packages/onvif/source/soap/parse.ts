import { ParseError } from '#errors.ts'
import { XML_NAMESPACE } from '#soap/namespaces.ts'

export type XmlLimits = {
  maxLength: number
  maxDepth: number
  maxAttributes: number
  maxNodes: number
}

export type XmlObject = { [key: string]: XmlValue }
export type XmlValue = string | XmlObject | XmlValue[]

/** Prefix to namespace URI; the default namespace is under the empty prefix. */
export type XmlNamespaces = Readonly<Record<string, string>>

export type XmlNamespaceInfo = {
  /** Namespace of the element, `undefined` when it has none or its prefix is not declared. */
  namespace: string | undefined
  /** Declarations in scope at the element. */
  namespaces: XmlNamespaces
  /** Namespaces of prefixed attributes, by local name. */
  attributes: Readonly<Record<string, string | undefined>> | undefined
}

export type XmlOptions = {
  /** Keep the namespace of every element, readable with `namespaceInfo()`. Elements are then always objects. */
  namespaces?: boolean
}

const defaultLimits: XmlLimits = {
  maxLength: 4 * 1024 * 1024,
  maxDepth: 64,
  maxAttributes: 64,
  maxNodes: 100_000
}

const forbiddenNames = new Set(['__proto__', 'constructor', 'prototype'])

// The prototype chain never reaches Object.prototype, so names like `toString` or `__proto__` can't hit inherited
// members, and V8 still keeps these objects in fast mode.
const ParsedNode = function ParsedNode() {} as unknown as new () => XmlObject
ParsedNode.prototype = Object.create(null)

const infoKey = Symbol('namespaces')

type WithInfo = { [infoKey]?: XmlNamespaceInfo }

/**
 * Namespace details of an element parsed with `namespaces: true`, or of an object decoded from one.
 *
 * @param node - A parsed element or a decoded object
 * @returns The namespace details, `undefined` for elements parsed without namespaces
 */
export const namespaceInfo = (node: object): XmlNamespaceInfo | undefined => (node as WithInfo)[infoKey]

/**
 * Attach the namespace details of a parsed element to an object decoded from it.
 *
 * @param target - The decoded object
 * @param info - Namespace details of the element it came from
 */
export const setNamespaceInfo = (target: object, info: XmlNamespaceInfo): void => {
  Object.defineProperty(target, infoKey, { value: info })
}

const rootNamespaces: XmlNamespaces = Object.assign(Object.create(null) as Record<string, string>, {
  xml: XML_NAMESPACE
})

type Frame = {
  qualifiedName: string
  localName: string
  attributes: XmlObject | undefined
  children: XmlObject | undefined
  text: string
  namespaces: XmlNamespaces
  info: XmlNamespaceInfo | undefined
}

const isWhitespace = (code: number): boolean => code === 0x20 || code === 0x0a || code === 0x09 || code === 0x0d

const isNameEnd = (code: number): boolean =>
  isWhitespace(code) || code === 0x3e || code === 0x2f || code === 0x3d || Number.isNaN(code)

const isAllowedCodePoint = (codePoint: number): boolean =>
  codePoint === 0x09 ||
  codePoint === 0x0a ||
  codePoint === 0x0d ||
  (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
  (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
  (codePoint >= 0x10000 && codePoint <= 0x10ffff)

const decodeEntities = (value: string, offset: number): string => {
  let ampersand = value.indexOf('&')
  if (ampersand === -1) return value
  let result = ''
  let last = 0
  while (ampersand !== -1) {
    const semicolon = value.indexOf(';', ampersand + 1)
    if (semicolon === -1 || semicolon - ampersand > 10) {
      throw new ParseError('Unterminated entity reference', offset + ampersand)
    }
    const entity = value.slice(ampersand + 1, semicolon)
    let decoded: string
    switch (entity) {
      case 'lt':
        decoded = '<'
        break
      case 'gt':
        decoded = '>'
        break
      case 'amp':
        decoded = '&'
        break
      case 'quot':
        decoded = '"'
        break
      case 'apos':
        decoded = "'"
        break
      default: {
        if (entity.charCodeAt(0) !== 0x23) {
          throw new ParseError(`Unknown entity '&${entity};'`, offset + ampersand)
        }
        const hex = entity.charCodeAt(1) === 0x78
        const digits = entity.slice(hex ? 2 : 1)
        const codePoint =
          digits.length > 0 && /^[0-9a-fA-F]+$/.test(digits) ? Number.parseInt(digits, hex ? 16 : 10) : Number.NaN
        if ((!hex && !/^\d+$/.test(digits)) || !isAllowedCodePoint(codePoint)) {
          throw new ParseError(`Invalid character reference '&${entity};'`, offset + ampersand)
        }
        decoded = String.fromCodePoint(codePoint)
      }
    }
    result += value.slice(last, ampersand) + decoded
    last = semicolon + 1
    ampersand = value.indexOf('&', last)
  }
  return result + value.slice(last)
}

const namePattern =
  /^[A-Za-z_\u00C0-\uFFFF][\w.\-\u00B7\u00C0-\uFFFF]*(?::[A-Za-z_\u00C0-\uFFFF][\w.\-\u00B7\u00C0-\uFFFF]*)?$/

const localName = (qualifiedName: string, position: number): string => {
  if (!namePattern.test(qualifiedName)) {
    throw new ParseError(`Invalid name '${qualifiedName.slice(0, 64)}'`, position)
  }
  const colon = qualifiedName.indexOf(':')
  const name = colon === -1 ? qualifiedName : qualifiedName.slice(colon + 1)
  if (forbiddenNames.has(name)) throw new ParseError(`Forbidden name '${name}'`, position)
  return name
}

const appendChild = (parent: Frame, name: string, value: XmlValue): void => {
  const children = (parent.children ??= new ParsedNode())
  const existing = children[name]
  if (existing === undefined) {
    children[name] = value
  } else if (Array.isArray(existing)) {
    existing.push(value)
  } else {
    children[name] = [existing, value]
  }
}

const finalize = (frame: Frame): XmlValue => {
  const text = frame.text.trim()
  if (frame.children === undefined && frame.attributes === undefined && frame.info === undefined) return text
  const node = frame.children ?? new ParsedNode()
  if (frame.attributes !== undefined) node['$'] = frame.attributes
  if (text.length > 0) node['_'] = text
  if (frame.info !== undefined) (node as WithInfo)[infoKey] = frame.info
  return node
}

const prefixOf = (qualifiedName: string): string => {
  const colon = qualifiedName.indexOf(':')
  return colon === -1 ? '' : qualifiedName.slice(0, colon)
}

const resolveNamespaces = (frame: Frame, prefixedAttributes: string[] | undefined): XmlNamespaceInfo => {
  const { namespaces } = frame
  const declared = namespaces[prefixOf(frame.qualifiedName)]
  let attributes: Record<string, string | undefined> | undefined
  if (prefixedAttributes !== undefined) {
    attributes = Object.create(null) as Record<string, string | undefined>
    for (const name of prefixedAttributes) attributes[name.slice(name.indexOf(':') + 1)] = namespaces[prefixOf(name)]
  }
  return { namespace: declared === '' ? undefined : declared, namespaces, attributes }
}

/**
 * Parse a SOAP message into plain objects.
 *
 * Namespace prefixes are removed from element and attribute names, `xmlns` declarations are dropped, attributes are
 * grouped under `$` and text next to attributes or child elements is stored under `_`. Repeated elements become
 * arrays. DOCTYPE, processing instructions (other than the XML declaration) and entities other than the five
 * predefined ones and character references are rejected.
 *
 * With `namespaces: true` the declarations are kept as well: every element becomes an object (text under `_`) whose
 * namespace, in-scope declarations and attribute namespaces `namespaceInfo()` returns. An undeclared prefix leaves the
 * namespace `undefined` instead of failing, so one sloppy vendor element does not lose a whole response.
 *
 * @param xml - The document to parse
 * @param overrides - Resource limits, merged with the defaults
 * @param options - Parser options
 * @returns The root element keyed by its local name
 * @throws {ParseError} If the document is malformed, uses a forbidden construct or exceeds a limit
 */
export function parseXml(xml: string, overrides?: Partial<XmlLimits>, options: XmlOptions = {}): XmlObject {
  const trackNamespaces = options.namespaces === true
  const limits = overrides ? { ...defaultLimits, ...overrides } : defaultLimits
  if (xml.length > limits.maxLength) {
    throw new ParseError(`Document exceeds ${limits.maxLength} characters`, limits.maxLength)
  }

  const root: Frame = {
    qualifiedName: '',
    localName: '',
    attributes: undefined,
    children: undefined,
    text: '',
    namespaces: rootNamespaces,
    info: undefined
  }
  const stack: Frame[] = [root]
  let current = root
  let nodes = 0
  let seenRoot = false
  let position = xml.charCodeAt(0) === 0xfeff ? 1 : 0

  while (position < xml.length) {
    const lessThan = xml.indexOf('<', position)
    const textEnd = lessThan === -1 ? xml.length : lessThan

    if (textEnd > position) {
      const text = xml.slice(position, textEnd)
      if (current === root) {
        if (text.trim().length > 0) throw new ParseError('Text outside of the root element', position)
      } else {
        current.text += decodeEntities(text, position)
      }
    }
    if (lessThan === -1) break

    const next = xml.charCodeAt(lessThan + 1)

    if (next === 0x3f) {
      if (lessThan !== 0 && !(lessThan === 1 && position === 1)) {
        throw new ParseError('Processing instructions are not allowed', lessThan)
      }
      if (!xml.startsWith('<?xml', lessThan) || !isWhitespace(xml.charCodeAt(lessThan + 5))) {
        throw new ParseError('Processing instructions are not allowed', lessThan)
      }
      const end = xml.indexOf('?>', lessThan + 5)
      if (end === -1) throw new ParseError('Unterminated XML declaration', lessThan)
      position = end + 2
      continue
    }

    if (next === 0x21) {
      if (xml.startsWith('<!--', lessThan)) {
        const end = xml.indexOf('-->', lessThan + 4)
        if (end === -1) throw new ParseError('Unterminated comment', lessThan)
        position = end + 3
        continue
      }
      if (xml.startsWith('<![CDATA[', lessThan)) {
        if (current === root) throw new ParseError('CDATA outside of the root element', lessThan)
        const end = xml.indexOf(']]>', lessThan + 9)
        if (end === -1) throw new ParseError('Unterminated CDATA section', lessThan)
        current.text += xml.slice(lessThan + 9, end)
        position = end + 3
        continue
      }
      throw new ParseError('DOCTYPE and markup declarations are not allowed', lessThan)
    }

    if (next === 0x2f) {
      const end = xml.indexOf('>', lessThan + 2)
      if (end === -1) throw new ParseError('Unterminated closing tag', lessThan)
      const name = xml.slice(lessThan + 2, end).trimEnd()
      if (current === root || name !== current.qualifiedName) {
        throw new ParseError(`Unexpected closing tag '${name.slice(0, 64)}'`, lessThan)
      }
      stack.pop()
      const parent = stack[stack.length - 1] as Frame
      appendChild(parent, current.localName, finalize(current))
      current = parent
      position = end + 1
      continue
    }

    if (current === root && seenRoot) throw new ParseError('Multiple root elements', lessThan)

    let cursor = lessThan + 1
    while (!isNameEnd(xml.charCodeAt(cursor))) cursor++
    const qualifiedName = xml.slice(lessThan + 1, cursor)
    const elementName = localName(qualifiedName, lessThan)

    if (++nodes > limits.maxNodes) throw new ParseError(`Document exceeds ${limits.maxNodes} elements`, lessThan)
    if (stack.length > limits.maxDepth) throw new ParseError(`Document exceeds depth ${limits.maxDepth}`, lessThan)

    const frame: Frame = {
      qualifiedName,
      localName: elementName,
      attributes: undefined,
      children: undefined,
      text: '',
      namespaces: current.namespaces,
      info: undefined
    }
    const attributeNames: string[] = []
    let prefixedAttributes: string[] | undefined
    let selfClosing = false

    for (;;) {
      while (isWhitespace(xml.charCodeAt(cursor))) cursor++
      const code = xml.charCodeAt(cursor)
      if (code === 0x3e) {
        cursor++
        break
      }
      if (code === 0x2f) {
        if (xml.charCodeAt(cursor + 1) !== 0x3e) throw new ParseError("Expected '>' after '/'", cursor)
        selfClosing = true
        cursor += 2
        break
      }
      if (Number.isNaN(code)) throw new ParseError(`Unterminated tag '${qualifiedName.slice(0, 64)}'`, lessThan)
      if (!isWhitespace(xml.charCodeAt(cursor - 1))) {
        throw new ParseError('Expected whitespace before attribute', cursor)
      }

      const nameStart = cursor
      while (!isNameEnd(xml.charCodeAt(cursor))) cursor++
      const attributeName = xml.slice(nameStart, cursor)
      while (isWhitespace(xml.charCodeAt(cursor))) cursor++
      if (xml.charCodeAt(cursor) !== 0x3d) {
        throw new ParseError(`Expected '=' after '${attributeName.slice(0, 64)}'`, cursor)
      }
      cursor++
      while (isWhitespace(xml.charCodeAt(cursor))) cursor++
      const quote = xml.charCodeAt(cursor)
      if (quote !== 0x22 && quote !== 0x27) throw new ParseError('Expected quoted attribute value', cursor)
      const valueEnd = xml.indexOf(quote === 0x22 ? '"' : "'", cursor + 1)
      if (valueEnd === -1) throw new ParseError('Unterminated attribute value', cursor)
      const rawValue = xml.slice(cursor + 1, valueEnd)
      if (rawValue.includes('<')) throw new ParseError("'<' in attribute value", cursor)
      const valueStart = cursor + 1
      cursor = valueEnd + 1

      if (attributeNames.includes(attributeName)) {
        throw new ParseError(`Duplicate attribute '${attributeName.slice(0, 64)}'`, nameStart)
      }
      if (attributeNames.push(attributeName) > limits.maxAttributes) {
        throw new ParseError(`Element exceeds ${limits.maxAttributes} attributes`, nameStart)
      }
      if (attributeName === 'xmlns' || attributeName.startsWith('xmlns:')) {
        if (trackNamespaces) {
          if (frame.namespaces === current.namespaces) {
            frame.namespaces = Object.assign(Object.create(null) as Record<string, string>, current.namespaces)
          }
          ;(frame.namespaces as Record<string, string>)[attributeName === 'xmlns' ? '' : attributeName.slice(6)] =
            decodeEntities(rawValue, valueStart)
        }
        continue
      }

      const attributeLocalName = localName(attributeName, nameStart)
      const attributes = (frame.attributes ??= new ParsedNode())
      if (attributes[attributeLocalName] !== undefined) continue
      attributes[attributeLocalName] = decodeEntities(rawValue, valueStart)
      if (trackNamespaces && attributeLocalName.length !== attributeName.length) {
        ;(prefixedAttributes ??= []).push(attributeName)
      }
    }

    if (trackNamespaces) frame.info = resolveNamespaces(frame, prefixedAttributes)
    if (current === root) seenRoot = true
    if (selfClosing) {
      appendChild(current, elementName, finalize(frame))
    } else {
      stack.push(frame)
      current = frame
    }
    position = cursor
  }

  if (current !== root) throw new ParseError(`Unclosed element '${current.qualifiedName.slice(0, 64)}'`, xml.length)
  if (!seenRoot || root.children === undefined) throw new ParseError('No root element', xml.length)
  return root.children
}
