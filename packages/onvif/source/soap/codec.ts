import { DecodeError, type ErrorContext, OnvifError } from '#errors.ts'
import { XML_NAMESPACE, prefixes } from '#soap/namespaces.ts'
import { namespaceInfo, setNamespaceInfo, type XmlNamespaces, type XmlObject, type XmlValue } from '#soap/parse.ts'
import type { XmlElement, XmlNode } from '#soap/serialize.ts'

export type Primitive =
  | 'string'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'dateTime'
  | 'base64'
  | 'qname'
  | 'prefixed'
  | 'any'

export type FieldSchema = {
  name: string
  /** Key of the field in decoded and request objects, when it differs from `name`. */
  property?: string
  /** A primitive, a primitive list such as `integer[]` (XSD list), or a key of the schema. */
  type: string
  namespace?: string
  attribute?: true
  optional?: true
  array?: true
}

export type TypeSchema = {
  fields: readonly FieldSchema[]
  text?: string
  any?: true
  /** Properties of the elements that stand in for a required `xs:any`. A request has exactly one of them. */
  choice?: readonly string[]
}

export type Schema = Readonly<Record<string, TypeSchema>>

export type Operation<Request, Response> = {
  name: string
  action: string
  request: { name: string; namespace: string; type: string }
  response: { name: string; type: string }
  schema: Schema
  /** Parse the response with namespaces, for content that holds QNames or has to be echoed back. */
  namespaces?: true
  /** Never set; carries the request and response types. */
  types?: { request: Request; response: Response }
}

const primitives = new Set([
  'string',
  'integer',
  'decimal',
  'boolean',
  'dateTime',
  'base64',
  'qname',
  'prefixed',
  'any'
])
const integerPattern = /^[+-]?\d+$/
const decimalPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const dateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/
const qnamePattern = /^(?:([^\s:{}]+):)?([^\s:{}]+)$/
const clarkPattern = /^\{([^{}]*)\}([^\s:{}]+)$/
// a prefix or a {namespace} at the start of a name in a topic or XPath expression
const prefixedPattern = /(^|[\s/|([])(?:\{([^{}]*)\}|([A-Za-z_][\w.-]*):)(?=[A-Za-z_*])/g
const namespacesByPrefix = new Map(Object.entries(prefixes).map(([namespace, prefix]) => [prefix, namespace]))
const knownNames = new WeakMap<TypeSchema, Set<string>>()

const typeOf = (schema: Schema, name: string): TypeSchema => {
  const type = schema[name]
  if (!type) throw new OnvifError(`Unknown schema type ${name}`)
  return type
}

const firstOf = (value: XmlValue): string | XmlObject => (Array.isArray(value) ? firstOf(value[0] ?? '') : value)

const textOf = (value: string | XmlObject): string => {
  if (typeof value === 'string') return value
  const text = value['_']
  return typeof text === 'string' ? text : ''
}

const decodeQName = (text: string, path: string, context: ErrorContext, scope: XmlNamespaces | undefined): string => {
  const [, prefix, local = ''] = qnamePattern.exec(text) ?? []
  if (!local) throw new DecodeError(`Invalid QName '${text.slice(0, 32)}'`, path, context)
  if (!scope) throw new OnvifError(`The QName at ${path} needs a response parsed with namespaces`, context)
  const namespace = Object.hasOwn(scope, prefix ?? '') ? scope[prefix ?? ''] : undefined
  if (!namespace) {
    if (prefix !== undefined) throw new DecodeError(`Undeclared prefix in QName '${text.slice(0, 32)}'`, path, context)
    return local
  }
  const known = prefixes[namespace]
  return known === undefined ? `{${namespace}}${local}` : `${known}:${local}`
}

// prefixes that are not declared stay as they are, as does all text of a response parsed without namespaces
const decodePrefixed = (text: string, scope: XmlNamespaces | undefined): string =>
  scope === undefined
    ? text
    : text.replace(prefixedPattern, (match: string, lead: string, clark?: string, prefix?: string) => {
        const namespace = prefix !== undefined && Object.hasOwn(scope, prefix) ? scope[prefix] : undefined
        if (clark !== undefined || !namespace) return match
        const known = prefixes[namespace]
        return known === undefined ? `${lead}{${namespace}}` : `${lead}${known}:`
      })

const decodePrimitive = (
  primitive: string,
  text: string,
  path: string,
  context: ErrorContext,
  scope: XmlNamespaces | undefined
): unknown => {
  if (primitive === 'string') return text
  const trimmed = text.trim()
  switch (primitive) {
    case 'integer':
      if (!integerPattern.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) {
        throw new DecodeError(`Invalid integer '${trimmed.slice(0, 32)}'`, path, context)
      }
      return Number(trimmed)
    case 'decimal':
      if (trimmed === 'INF') return Number.POSITIVE_INFINITY
      if (trimmed === '-INF') return Number.NEGATIVE_INFINITY
      if (trimmed === 'NaN') return Number.NaN
      if (!decimalPattern.test(trimmed)) {
        throw new DecodeError(`Invalid number '${trimmed.slice(0, 32)}'`, path, context)
      }
      return Number(trimmed)
    case 'boolean':
      if (trimmed === 'true' || trimmed === '1') return true
      if (trimmed === 'false' || trimmed === '0') return false
      throw new DecodeError(`Invalid boolean '${trimmed.slice(0, 32)}'`, path, context)
    case 'dateTime': {
      const [, year, month, day, zone] = dateTimePattern.exec(trimmed) ?? []
      // ONVIF times are UTC; Date would read a dateTime without a zone as local time
      const date = new Date(zone === undefined ? `${trimmed}Z` : trimmed)
      const calendarDay = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDate()
      if (day === undefined || Number.isNaN(date.getTime()) || calendarDay !== Number(day)) {
        throw new DecodeError(`Invalid dateTime '${trimmed.slice(0, 32)}'`, path, context)
      }
      return date
    }
    case 'qname':
      return decodeQName(trimmed, path, context, scope)
    case 'prefixed':
      return decodePrefixed(trimmed, scope)
    case 'base64':
      try {
        return Uint8Array.fromBase64(trimmed, { lastChunkHandling: 'strict' })
      } catch {
        throw new DecodeError('Invalid base64 value', path, context)
      }
    default:
      throw new OnvifError(`Unknown primitive ${primitive}`)
  }
}

const decodeSimple = (
  type: string,
  value: string | XmlObject,
  path: string,
  context: ErrorContext,
  scope: XmlNamespaces | undefined
): unknown => {
  if (type === 'any') return value
  const text = textOf(value)
  if (type.endsWith('[]')) {
    const item = type.slice(0, -2)
    return text
      .split(/\s+/)
      .filter((part) => part.length > 0)
      .map((part, index) => decodePrimitive(item, part, `${path}[${index}]`, context, scope))
  }
  return decodePrimitive(type, text, path, context, scope)
}

const scopeOf = (value: string | XmlObject, parent: XmlNamespaces | undefined): XmlNamespaces | undefined =>
  typeof value === 'string' ? parent : (namespaceInfo(value)?.namespaces ?? parent)

const isSimple = (type: string): boolean => primitives.has(type) || type.endsWith('[]')

const namesOf = (type: TypeSchema): Set<string> => {
  let names = knownNames.get(type)
  if (!names) {
    names = new Set(type.fields.filter((field) => !field.attribute).map((field) => field.name))
    names.add('$')
    names.add('_')
    knownNames.set(type, names)
  }
  return names
}

const decodeValue = (
  schema: Schema,
  type: string,
  value: string | XmlObject,
  path: string,
  context: ErrorContext,
  scope: XmlNamespaces | undefined
): unknown =>
  isSimple(type)
    ? decodeSimple(type, value, path, context, scopeOf(value, scope))
    : decodeComplex(schema, type, value, path, context)

const decodeComplex = (
  schema: Schema,
  typeName: string,
  value: string | XmlObject,
  path: string,
  context: ErrorContext
): Record<string, unknown> => {
  const type = typeOf(schema, typeName)
  const node: XmlObject = typeof value === 'string' ? {} : value
  const attributes = node['$']
  const info = namespaceInfo(node)
  const scope = info?.namespaces
  const result: Record<string, unknown> = {}

  for (const field of type.fields) {
    const key = field.property ?? field.name
    const raw = field.attribute
      ? typeof attributes === 'object' && !Array.isArray(attributes)
        ? attributes[field.name]
        : undefined
      : node[field.name]
    if (raw === undefined) {
      if (!field.optional) {
        throw new DecodeError(
          `Missing required ${field.attribute ? 'attribute' : 'element'} ${field.name}`,
          path,
          context
        )
      }
      continue
    }
    const fieldPath = `${path}.${field.name}`
    if (field.array) {
      const items = Array.isArray(raw) ? raw : [raw]
      result[key] = items.map((item, index) =>
        decodeValue(schema, field.type, firstOf(item), `${fieldPath}[${index}]`, context, scope)
      )
    } else {
      result[key] = decodeValue(schema, field.type, firstOf(raw), fieldPath, context, scope)
    }
  }

  if (type.text !== undefined) {
    result['value'] = decodeSimple(type.text, value, `${path}#text`, context, scope)
  }

  if (info) setNamespaceInfo(result, info)

  if (type.any) {
    const names = namesOf(type)
    let extra: Record<string, unknown> | undefined
    for (const key of Object.keys(node)) {
      if (!names.has(key)) (extra ??= {})[key] = node[key]
    }
    if (extra) result['$any'] = extra
  }
  return result
}

/**
 * Turn a parsed element into the typed shape from the schema. Numbers, booleans and dates get converted, repeatable
 * elements are always arrays, elements and attributes go under their property names and simple content becomes
 * `value`. If an element that should occur once is repeated, the first one wins. Unknown elements go under `$any` on
 * types that allow extensions and are dropped otherwise.
 *
 * @param schema - Generated schema table
 * @param type - Type key in the table
 * @param value - Parser output for the element
 * @param context - Host, service and action for error reporting
 * @returns The decoded object
 * @throws {DecodeError} If a required element is missing or a value does not match its type
 */
export function decode(schema: Schema, type: string, value: XmlValue, context: ErrorContext = {}): unknown {
  return decodeValue(schema, type, firstOf(value), type, context, undefined)
}

class Encoder {
  readonly used = new Map<string, string>()
  readonly #schema: Schema

  constructor(schema: Schema) {
    this.#schema = schema
  }

  qualify(name: string, namespace: string | undefined): string {
    if (namespace === undefined || namespace === '') return name
    let prefix = this.used.get(namespace)
    if (prefix === undefined) {
      prefix = prefixes[namespace] ?? `ns${this.used.size + 1}`
      this.used.set(namespace, prefix)
    }
    return `${prefix}:${name}`
  }

  primitive(type: string, value: unknown, path: string): string {
    if (type.endsWith('[]')) {
      if (!Array.isArray(value)) throw new OnvifError(`Expected an array at ${path}`)
      return value.map((item, index) => this.primitive(type.slice(0, -2), item, `${path}[${index}]`)).join(' ')
    }
    switch (type) {
      case 'string':
        if (typeof value === 'string') return value
        break
      case 'integer':
        if (Number.isSafeInteger(value)) return String(value)
        break
      case 'decimal':
        if (typeof value === 'number' && !Number.isNaN(value)) {
          return Number.isFinite(value) ? String(value) : value > 0 ? 'INF' : '-INF'
        }
        break
      case 'boolean':
        if (typeof value === 'boolean') return String(value)
        break
      case 'dateTime':
        if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
        break
      case 'base64':
        if (value instanceof Uint8Array) return value.toBase64()
        break
      case 'qname':
        if (typeof value === 'string') return this.qname(value, path)
        break
      case 'prefixed':
        if (typeof value === 'string') return this.prefixed(value, path)
        break
      case 'any':
        if (typeof value === 'string') return value
        break
      default:
        throw new OnvifError(`Unknown primitive ${type}`)
    }
    throw new OnvifError(`Invalid ${type} value at ${path}`)
  }

  qname(value: string, path: string): string {
    const clark = clarkPattern.exec(value)
    if (clark) {
      const [, namespace = '', local = ''] = clark
      return this.qualify(local, namespace)
    }
    const [, prefix, local] = qnamePattern.exec(value) ?? []
    if (local === undefined) throw new OnvifError(`Invalid QName at ${path}`)
    if (prefix === undefined) return local
    const namespace = namespacesByPrefix.get(prefix)
    if (namespace === undefined) throw new OnvifError(`Unknown prefix ${prefix} in the QName at ${path}`)
    return this.qualify(local, namespace)
  }

  prefixed(value: string, path: string): string {
    return value.replace(prefixedPattern, (_match: string, lead: string, clark?: string, prefix?: string) => {
      const namespace = clark ?? namespacesByPrefix.get(prefix ?? '')
      if (namespace === undefined) throw new OnvifError(`Unknown prefix ${prefix} at ${path}`)
      return namespace === '' ? lead : `${lead}${this.qualify('', namespace)}`
    })
  }

  element(name: string, type: string, value: unknown, path: string): XmlElement {
    if (isSimple(type)) return { name, children: [this.primitive(type, value, path)] }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new OnvifError(`Expected an object at ${path}`)
    }
    const data = value as Record<string, unknown>
    const schema = typeOf(this.#schema, type)
    const attributes: Record<string, string> = {}
    const children: XmlNode[] = []
    for (const field of schema.fields) {
      const key = field.property ?? field.name
      const fieldValue = data[key]
      const fieldPath = `${path}.${key}`
      if (fieldValue === undefined) {
        if (!field.optional) throw new OnvifError(`Missing required ${key} at ${path}`)
        continue
      }
      if (field.attribute) {
        const attributeName =
          field.namespace === XML_NAMESPACE ? `xml:${field.name}` : this.qualify(field.name, field.namespace)
        attributes[attributeName] = this.primitive(field.type, fieldValue, fieldPath)
        continue
      }
      const items = field.array ? fieldValue : [fieldValue]
      if (!Array.isArray(items)) throw new OnvifError(`Expected an array at ${fieldPath}`)
      items.forEach((item, index) => {
        children.push(
          this.element(
            this.qualify(field.name, field.namespace),
            field.type,
            item,
            field.array ? `${fieldPath}[${index}]` : fieldPath
          )
        )
      })
    }
    if (schema.choice && schema.choice.filter((key) => data[key] !== undefined).length !== 1) {
      throw new OnvifError(`Expected one of ${schema.choice.join(', ')} at ${path}`)
    }
    if (schema.text !== undefined && data['value'] !== undefined) {
      children.push(this.primitive(schema.text, data['value'], `${path}.value`))
    }
    return Object.keys(attributes).length > 0 ? { name, attributes, children } : { name, children }
  }
}

/**
 * Build the body element of an operation request from typed data.
 *
 * @param operation - Generated operation
 * @param request - Request data
 * @returns The request element with its namespace declarations
 * @throws {OnvifError} If a required value is missing or a value has the wrong type
 */
export function encodeRequest<Request>(operation: Operation<Request, unknown>, request: Request): XmlElement {
  const encoder = new Encoder(operation.schema)
  const { name, namespace, type } = operation.request
  const element = encoder.element(encoder.qualify(name, namespace), type, request, name)
  const declarations: Record<string, string> = {}
  for (const [uri, prefix] of encoder.used) {
    declarations[`xmlns:${prefix}`] = uri
  }
  return { ...element, attributes: { ...declarations, ...element.attributes } }
}
