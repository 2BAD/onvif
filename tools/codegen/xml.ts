import { readFileSync } from 'node:fs'
import { XMLParser } from 'fast-xml-parser'

export type QName = { namespace: string; local: string }

export type SchemaNode = {
  name: QName
  attributes: Record<string, string>
  namespaces: Record<string, string>
  children: SchemaNode[]
  /** All descendant text in document order. */
  text: string
}

type OrderedNode = { [key: string]: OrderedNode[] | Record<string, string> | string | undefined }

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  htmlEntities: false
})

export const resolveQName = (qualified: string, namespaces: Record<string, string>): QName => {
  const colon = qualified.indexOf(':')
  const prefix = colon === -1 ? '' : qualified.slice(0, colon)
  const local = colon === -1 ? qualified : qualified.slice(colon + 1)
  if (prefix === 'xml') return { namespace: 'http://www.w3.org/XML/1998/namespace', local }
  const namespace = namespaces[prefix]
  if (namespace === undefined && prefix !== '') {
    throw new Error(`Unknown namespace prefix '${prefix}' in '${qualified}'`)
  }
  return { namespace: namespace ?? '', local }
}

const build = (node: OrderedNode, inherited: Record<string, string>): SchemaNode | undefined => {
  const tag = Object.keys(node).find((key) => key !== ':@')
  if (tag === undefined || tag === '#text') return undefined
  const rawAttributes = (node[':@'] ?? {}) as Record<string, string>
  const namespaces = { ...inherited }
  const attributes: Record<string, string> = {}
  for (const [name, value] of Object.entries(rawAttributes)) {
    if (name === 'xmlns') namespaces[''] = value
    else if (name.startsWith('xmlns:')) namespaces[name.slice(6)] = value
    else attributes[name] = value
  }
  const content = (node[tag] ?? []) as OrderedNode[]
  const children: SchemaNode[] = []
  let text = ''
  for (const child of content) {
    if (typeof child['#text'] === 'string') {
      text += child['#text']
      continue
    }
    const built = build(child, namespaces)
    if (built) {
      children.push(built)
      text += built.text
    }
  }
  return { name: resolveQName(tag, namespaces), attributes, namespaces, children, text }
}

/**
 * Read an XSD or WSDL file into a tree with resolved element names and the namespace declarations in scope.
 *
 * @param path - File to read
 * @returns The document element
 */
export function readSchemaFile(path: string): SchemaNode {
  const document = parser.parse(readFileSync(path, 'utf8')) as OrderedNode[]
  for (const node of document) {
    const root = build(node, {})
    if (root) return root
  }
  throw new Error(`No document element in ${path}`)
}
