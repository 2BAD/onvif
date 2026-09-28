import { prefixes } from '#onvif/soap/namespaces.ts'
import type { ComplexModel, FieldModel, OperationModel, SimpleModel } from '#tools/codegen/model.ts'
import { keyOf } from '#tools/codegen/registry.ts'

export type EmitOptions = {
  commit: string
  codecImport: string
  operations: OperationModel[]
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

const camelCase = (name: string): string => {
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

const comment = (text: string | undefined, indent: string): string => {
  if (!text) return ''
  const words = text.replaceAll('*/', '* /').split(' ')
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
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`
  return `${indent}/**\n${lines.map((entry) => `${indent} * ${entry}`).join('\n')}\n${indent} */\n`
}

// generated types can't shadow these globals or codec types
const reservedNames = new Set([
  'Array',
  'Boolean',
  'Date',
  'Error',
  'Map',
  'Number',
  'Object',
  'Operation',
  'Promise',
  'Record',
  'Schema',
  'Set',
  'String',
  'Uint8Array'
])

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

const reachable = (operations: OperationModel[]): ComplexModel[] => {
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
  return [...found]
}

/**
 * Render the types, schema table and operations of one generated module.
 *
 * @param options - Operations and the codec import path
 * @returns TypeScript source
 */
export function emit(options: EmitOptions): string {
  const { commit, codecImport, operations } = options
  const complexTypes = reachable(operations)
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
      '  schema\n' +
      '}\n\n'
  }

  const constants = [...names.namespaces].map(([uri, name]) => `const ${name} = '${uri}'`).join('\n')

  return (
    `// Generated by tools/codegen from ONVIF specs ${commit}. Do not edit.\n` +
    `import type { Operation, Schema } from '${codecImport}'\n\n` +
    `${types}${constants}\n\n${schema}\n${operationsSource}`
  )
}
