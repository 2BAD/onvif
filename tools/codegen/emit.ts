import { prefixes } from '#onvif/soap/namespaces.ts'
import type { ComplexModel, FieldModel, OperationModel, SimpleModel } from '#tools/codegen/model.ts'
import { keyOf } from '#tools/codegen/registry.ts'

export type EmitOptions = {
  commit: string
  codecImport: string
  operations: OperationModel[]
  /** Types of global elements that no operation references, such as the content of an `xs:any`. */
  elements?: ComplexModel[]
  /** Operations whose responses are parsed with namespaces. */
  namespaces?: string[]
  client?: ClientOptions | undefined
}

type ClientOptions = {
  /** Name of the class with one method per operation. */
  name: string
  /** Module the `CallOptions` type and, for a concrete client, the `Device` type come from. */
  typesImport: string
  /**
   * Emit an abstract class with an abstract `call` for the device to extend, with `CallArguments` from `typesImport`.
   * Otherwise the class takes the device in its constructor.
   */
  abstract?: boolean
  /** Operations that get a method, all by default. */
  operations?: string[]
  /**
   * A second class, returned by `method`, that fills the request element `field` from its constructor. It has a
   * method for each operation of the client whose request has that element. Not for an abstract client.
   */
  scoped?: { name: string; method: string; field: string }
}

const tsPrimitives: Record<SimpleModel['primitive'], string> = {
  string: 'string',
  integer: 'number',
  decimal: 'number',
  boolean: 'boolean',
  dateTime: 'Date',
  base64: 'Uint8Array',
  any: 'unknown'
}

const pascal = (value: string): string =>
  value
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

const misspelledNames: Record<string, string> = { DNSname: 'dnsName' }

const camelCase = (name: string): string => {
  const misspelled = misspelledNames[name]
  if (misspelled) return misspelled
  if (!/[a-z]/.test(name)) return name
  const upper = /^[A-Z]+/.exec(name)?.[0] ?? ''
  const rest = name.slice(upper.length)
  if (upper.length > 1 && /^[a-z]{2}/.test(rest)) return `${upper.slice(0, -1).toLowerCase()}${upper.slice(-1)}${rest}`
  return `${upper.toLowerCase()}${rest}`
}

const properties = (model: ComplexModel): string[] => {
  const candidates = model.fields.map((field) => camelCase(field.name))
  const keys = model.fields.map((field) => {
    const candidate = camelCase(field.name)
    return candidates.filter((other) => other === candidate).length === 1 ? candidate : field.name
  })
  const all = model.text ? [...keys, 'value'] : keys
  if (new Set(all).size !== all.length) throw new Error(`Colliding property names in ${model.suggestedName}`)
  return keys
}

const propertyName = (name: string): string => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`)

const comment = (text: string | undefined, indent: string, tags: string[] = []): string => {
  if (!text && tags.length === 0) return ''
  const words = (text ?? '')
    .replaceAll('*/', '* /')
    .replaceAll(/[\u2018\u2019]/g, "'")
    .replaceAll(/[\u201c\u201d]/g, '"')
    .replaceAll(/[\u2013\u2014]/g, '-')
    .split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (line.length > 0 && line.length + word.length + 1 > 100) {
      lines.push(line)
      line = word
    } else {
      line = line.length > 0 ? `${line} ${word}` : word
    }
  }
  if (line.length > 0) lines.push(line)
  if (lines.length === 1 && tags.length === 0) return `${indent}/** ${lines[0]} */\n`
  if (lines.length > 0 && tags.length > 0) lines.push('')
  lines.push(...tags)
  const body = lines.map((entry) => (entry === '' ? `${indent} *` : `${indent} * ${entry}`)).join('\n')
  return `${indent}/**\n${body}\n${indent} */\n`
}

// generated types can't shadow these globals or codec types
const reservedNames = new Set(
  'Array Boolean Date Error Map Number Object Operation Promise Record Schema Set String Uint8Array'.split(' ')
)

class Names {
  readonly #complex = new Map<ComplexModel, string>()
  readonly #simple = new Map<string, string>()
  readonly namespaces = new Map<string, string>()

  constructor(complexTypes: ComplexModel[], enumerations: SimpleModel[]) {
    const candidates = new Map<string, { model: ComplexModel | SimpleModel; namespace: string }[]>()
    const add = (name: string, model: ComplexModel | SimpleModel, namespace: string) => {
      const list = candidates.get(name) ?? []
      list.push({ model, namespace })
      candidates.set(name, list)
    }
    for (const model of complexTypes) {
      add(pascal(model.qname?.local ?? model.suggestedName), model, model.qname?.namespace ?? '')
    }
    for (const model of enumerations) if (model.qname) add(pascal(model.qname.local), model, model.qname.namespace)

    for (const [name, list] of candidates) {
      list.forEach(({ model, namespace }, index) => {
        const base = reservedNames.has(name) ? `${name}Type` : name
        let unique = base
        if (list.length > 1) {
          const prefix = pascal(this.namespace(namespace) ?? '')
          unique =
            list.filter((entry) => entry.namespace === namespace).length > 1
              ? `${prefix}${base}${index}`
              : `${prefix}${base}`
        }
        if (model.kind === 'complex') this.#complex.set(model, unique)
        else if (model.qname) this.#simple.set(keyOf(model.qname), unique)
      })
    }
  }

  namespace(uri: string): string | undefined {
    if (uri === '') return undefined
    let name = this.namespaces.get(uri)
    if (name === undefined) {
      name = (prefixes[uri] ?? `ns${this.namespaces.size + 1}`).replace(/[^A-Za-z0-9]/g, '')
      this.namespaces.set(uri, name)
    }
    return name
  }

  complex(model: ComplexModel): string {
    const name = this.#complex.get(model)
    if (!name) throw new Error(`Unnamed complex type ${model.suggestedName}`)
    return name
  }

  simple(model: SimpleModel): string | undefined {
    return model.qname && model.enumeration ? this.#simple.get(keyOf(model.qname)) : undefined
  }
}

const unionOf = (values: string[]): string =>
  [
    ...values.map((value) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`),
    '(string & Record<never, never>)'
  ].join(' | ')

const tsSimple = (model: SimpleModel, names: Names): string => {
  const item =
    names.simple(model) ?? (model.enumeration ? `(${unionOf(model.enumeration)})` : tsPrimitives[model.primitive])
  return model.list ? `${item}[]` : item
}

const tsField = (field: FieldModel, names: Names): string => {
  const base = field.type.kind === 'simple' ? tsSimple(field.type, names) : names.complex(field.type)
  return field.array ? (/^[\w.]+$/.test(base) ? `${base}[]` : `(${base})[]`) : base
}

const schemaType = (field: FieldModel, names: Names): string =>
  field.type.kind === 'simple' ? `${field.type.primitive}${field.type.list ? '[]' : ''}` : names.complex(field.type)

const collectEnumerations = (complexTypes: ComplexModel[]): SimpleModel[] => {
  const seen = new Map<string, SimpleModel>()
  for (const model of complexTypes) {
    for (const simple of [...model.fields.map((field) => field.type), model.text]) {
      if (simple?.kind === 'simple' && simple.qname && simple.enumeration) seen.set(keyOf(simple.qname), simple)
    }
  }
  return [...seen.values()]
}

const reachable = (operations: OperationModel[], elements: ComplexModel[]): ComplexModel[] => {
  const found = new Set<ComplexModel>()
  const visit = (model: ComplexModel) => {
    if (found.has(model)) return
    found.add(model)
    for (const field of model.fields) if (field.type.kind === 'complex') visit(field.type)
  }
  for (const operation of operations) {
    visit(operation.request.type)
    visit(operation.response.type)
  }
  for (const element of elements) visit(element)
  return [...found]
}

type Scope = { key: string; index: number }

const method = (operation: OperationModel, names: Names, target: string, scope?: Scope): string => {
  const { type } = operation.request
  const optional = !type.text && type.fields.every((field, index) => field.optional || index === scope?.index)
  const request = scope ? `Omit<${names.complex(type)}, '${scope.key}'>` : names.complex(type)
  const response = names.complex(operation.response.type)
  const name = `${operation.name.charAt(0).toLowerCase()}${operation.name.slice(1)}`
  const argument = scope ? `{ ...request, ${scope.key}: this.#${scope.key} }` : 'request'
  const tags = [
    `@param request - The \`${operation.name}\` request${scope ? ` without \`${scope.key}\`` : ''}`,
    '@param options - Abort signal, timeout and addressing for this call',
    `@returns The decoded \`${operation.response.element.local}\``
  ]
  return (
    `\n${comment(operation.documentation, '  ', tags)}` +
    `  ${name}(request${optional ? '?' : ''}: ${request}, options?: CallOptions): Promise<${response}> {\n` +
    `    return ${target}.call(${operation.name}, ${argument}, options)\n  }\n`
  )
}

const deviceClass = (name: string, body: string, key?: string): string =>
  `export class ${name} {\n  readonly #device: Device\n${key ? `  readonly #${key}: string\n` : ''}\n` +
  `  constructor(device: Device${key ? `, ${key}: string` : ''}) {\n    this.#device = device\n` +
  `${key ? `    this.#${key} = ${key}\n` : ''}  }\n${body}}\n`

const scopedClient = (scoped: NonNullable<ClientOptions['scoped']>, operations: OperationModel[], names: Names) => {
  const scopes = operations.flatMap((operation) => {
    const { fields } = operation.request.type
    const index = fields.findIndex(
      (field) =>
        field.name === scoped.field &&
        !field.attribute &&
        !field.array &&
        field.type.kind === 'simple' &&
        field.type.primitive === 'string'
    )
    if (index === -1) return []
    return [{ operation, scope: { key: properties(operation.request.type)[index] ?? scoped.field, index } }]
  })
  const keys = new Set(scopes.map(({ scope }) => scope.key))
  const [key] = keys
  if (key === undefined) throw new Error(`No operation of ${scoped.name} has a request element ${scoped.field}`)
  if (keys.size > 1) throw new Error(`${scoped.field} has different property names`)
  const factory =
    `\n  /**\n   * @param ${key} - The \`${scoped.field}\` of every request\n` +
    `   * @returns The operations that take a \`${scoped.field}\`, without it in the request\n   */\n` +
    `  ${scoped.method}(${key}: string): ${scoped.name} {\n    return new ${scoped.name}(this.#device, ${key})\n  }\n`
  const body = scopes.map(({ operation, scope }) => method(operation, names, 'this.#device', scope)).join('')
  return { factory, source: `\n${deviceClass(scoped.name, body, key)}` }
}

const emitClient = (client: ClientOptions, operations: OperationModel[], names: Names): string => {
  const { name, abstract = false, operations: included, scoped } = client
  const unknown = included?.find((operation) => !operations.some((candidate) => candidate.name === operation))
  if (unknown) throw new Error(`Client ${name} lists the unknown operation ${unknown}`)
  const methods = operations.filter((operation) => included?.includes(operation.name) ?? true)
  const scope = scoped ? scopedClient(scoped, methods, names) : { factory: '', source: '' }
  const body =
    scope.factory + methods.map((operation) => method(operation, names, abstract ? 'this' : 'this.#device')).join('')
  if (!abstract) return `${deviceClass(name, body)}${scope.source}`
  return (
    `export abstract class ${name} {\n` +
    '  abstract call<Request, Response>(\n' +
    '    operation: Operation<Request, Response>,\n' +
    '    ...args: CallArguments<Request>\n' +
    `  ): Promise<Response>\n${body}}\n`
  )
}

/**
 * Render the types, schema table and operations of one generated module.
 *
 * @param options - Operations, extra element types and the codec import path
 * @returns TypeScript source
 */
export function emit(options: EmitOptions): string {
  const { commit, codecImport, operations, elements = [], namespaces = [], client } = options
  const complexTypes = reachable(operations, elements)
  const enumerations = collectEnumerations(complexTypes)
  const names = new Names(complexTypes, enumerations)

  let types = ''
  for (const model of enumerations.toSorted((a, b) => (names.simple(a) ?? '').localeCompare(names.simple(b) ?? ''))) {
    types += comment(model.documentation, '')
    types += `export type ${names.simple(model)} = ${unionOf(model.enumeration ?? [])}\n\n`
  }
  const sorted = complexTypes.toSorted((a, b) => names.complex(a).localeCompare(names.complex(b)))
  for (const model of sorted) {
    types += comment(model.documentation, '')
    if (model.fields.length === 0 && !model.text && !model.any) {
      types += `export type ${names.complex(model)} = Record<string, never>\n\n`
      continue
    }
    types += `export type ${names.complex(model)} = {\n`
    const keys = properties(model)
    for (const [index, field] of model.fields.entries()) {
      types += comment(field.documentation, '  ')
      types += `  ${propertyName(keys[index] ?? field.name)}${field.optional ? '?' : ''}: ${tsField(field, names)}\n`
    }
    if (model.text) types += `  value: ${tsSimple(model.text, names)}\n`
    if (model.any) types += '  $any?: Record<string, unknown>\n'
    types += '}\n\n'
  }

  let schema = 'export const schema: Schema = {\n'
  for (const model of sorted) {
    const keys = properties(model)
    const fields = model.fields.map((field, index) => {
      const parts = [`name: '${field.name}'`]
      const key = keys[index] ?? field.name
      if (key !== field.name) parts.push(`property: '${key}'`)
      parts.push(`type: '${schemaType(field, names)}'`)
      const namespace = field.namespace === undefined ? undefined : names.namespace(field.namespace)
      if (namespace) parts.push(`namespace: ${namespace}`)
      if (field.attribute) parts.push('attribute: true')
      if (field.optional) parts.push('optional: true')
      if (field.array) parts.push('array: true')
      return `{ ${parts.join(', ')} }`
    })
    const extras = [
      model.text ? `text: '${model.text.primitive}${model.text.list ? '[]' : ''}'` : '',
      model.any ? 'any: true' : ''
    ].filter(Boolean)
    schema += `  ${names.complex(model)}: { fields: [${fields.join(', ')}]${extras.map((extra) => `, ${extra}`).join('')} },\n`
  }
  schema += '}\n'

  let operationsSource = ''
  for (const operation of operations) {
    const request = names.complex(operation.request.type)
    const response = names.complex(operation.response.type)
    operationsSource +=
      `export const ${operation.name}: Operation<${request}, ${response}> = {\n` +
      `  name: '${operation.name}',\n` +
      `  action: '${operation.action}',\n` +
      `  request: { name: '${operation.request.element.local}', namespace: ${names.namespace(operation.request.element.namespace)}, type: '${request}' },\n` +
      `  response: { name: '${operation.response.element.local}', type: '${response}' },\n` +
      (namespaces.includes(operation.name) ? '  namespaces: true,\n' : '') +
      '  schema\n' +
      '}\n\n'
  }

  const constants = [...names.namespaces].map(([uri, name]) => `const ${name} = '${uri}'`).join('\n')

  let clientImport = ''
  let clientSource = ''
  if (client) {
    const imported = client.abstract ? 'CallArguments, CallOptions' : 'CallOptions, Device'
    clientImport = `import type { ${imported} } from '${client.typesImport}'\n`
    clientSource = emitClient(client, operations, names)
  }

  return (
    `// Generated by tools/codegen from ONVIF specs ${commit}. Do not edit.\n` +
    clientImport +
    `import type { ${operations.length > 0 ? 'Operation, ' : ''}Schema } from '${codecImport}'\n\n` +
    `${types}${constants}\n\n${schema}\n${operationsSource}${clientSource}`
  )
}
