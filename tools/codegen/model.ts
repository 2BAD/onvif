import { keyOf, type Registry, type SchemaContext, XS } from './registry.ts'
import { type QName, resolveQName, type SchemaNode } from './xml.ts'

export type Primitive = 'string' | 'integer' | 'decimal' | 'boolean' | 'dateTime' | 'base64' | 'any'

export type SimpleModel = {
  kind: 'simple'
  primitive: Primitive
  list: boolean
  enumeration: string[] | undefined
  qname: QName | undefined
  documentation: string | undefined
}

export type FieldModel = {
  name: string
  namespace: string | undefined
  attribute: boolean
  optional: boolean
  array: boolean
  type: SimpleModel | ComplexModel
  documentation: string | undefined
}

export type ComplexModel = {
  kind: 'complex'
  qname: QName | undefined
  suggestedName: string
  fields: FieldModel[]
  text: SimpleModel | undefined
  any: boolean
  documentation: string | undefined
}

export type OperationModel = {
  name: string
  action: string
  request: { element: QName; type: ComplexModel }
  response: { element: QName; type: ComplexModel }
}

const builtins: Record<string, [Primitive, boolean]> = {
  string: ['string', false],
  normalizedString: ['string', false],
  token: ['string', false],
  anyURI: ['string', false],
  QName: ['string', false],
  NCName: ['string', false],
  Name: ['string', false],
  ID: ['string', false],
  IDREF: ['string', false],
  IDREFS: ['string', true],
  NMTOKEN: ['string', false],
  NMTOKENS: ['string', true],
  language: ['string', false],
  hexBinary: ['string', false],
  duration: ['string', false],
  date: ['string', false],
  time: ['string', false],
  anySimpleType: ['string', false],
  int: ['integer', false],
  integer: ['integer', false],
  long: ['integer', false],
  short: ['integer', false],
  byte: ['integer', false],
  unsignedInt: ['integer', false],
  unsignedLong: ['integer', false],
  unsignedShort: ['integer', false],
  unsignedByte: ['integer', false],
  positiveInteger: ['integer', false],
  nonNegativeInteger: ['integer', false],
  negativeInteger: ['integer', false],
  nonPositiveInteger: ['integer', false],
  float: ['decimal', false],
  double: ['decimal', false],
  decimal: ['decimal', false],
  boolean: ['boolean', false],
  dateTime: ['dateTime', false],
  base64Binary: ['base64', false],
  anyType: ['any', false]
}

const isXs = (node: SchemaNode, local: string): boolean => node.name.namespace === XS && node.name.local === local

const documentationOf = (node: SchemaNode): string | undefined => {
  const annotation = node.children.find((child) => isXs(child, 'annotation'))
  const documentation = annotation?.children.find((child) => isXs(child, 'documentation'))
  const text = documentation ? documentation.text.replace(/\s+/g, ' ').trim() : ''
  return text.length > 0 ? text : undefined
}

const occurs = (node: SchemaNode) => ({
  optional: node.attributes['minOccurs'] === '0',
  array: node.attributes['maxOccurs'] !== undefined && node.attributes['maxOccurs'] !== '1'
})

const pascal = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1)

export class ModelBuilder {
  readonly #registry: Registry
  readonly #complex = new Map<string, ComplexModel>()
  readonly #simple = new Map<string, SimpleModel>()
  readonly complexTypes: ComplexModel[] = []

  constructor(registry: Registry) {
    this.#registry = registry
  }

  operation(name: string, action: string, input: QName, output: QName): OperationModel {
    return {
      name,
      action,
      request: { element: input, type: this.#globalElementType(input, `${name}Request`) },
      response: { element: output, type: this.#globalElementType(output, output.local) }
    }
  }

  #globalElementType(element: QName, suggestedName: string): ComplexModel {
    const { node, context } = this.#registry.component('element', element)
    const type = this.#elementType(node, context, suggestedName)
    if (type.kind !== 'complex') throw new Error(`Element ${keyOf(element)} is not a complex type`)
    return type
  }

  #elementType(node: SchemaNode, context: SchemaContext, suggestedName: string): SimpleModel | ComplexModel {
    const typeName = node.attributes['type']
    if (typeName) return this.#namedType(resolveQName(typeName, node.namespaces))
    const inlineComplex = node.children.find((child) => isXs(child, 'complexType'))
    if (inlineComplex) return this.#complexType(inlineComplex, context, suggestedName, undefined)
    const inlineSimple = node.children.find((child) => isXs(child, 'simpleType'))
    if (inlineSimple) return this.#simpleType(inlineSimple, undefined)
    return this.#builtin('anyType')
  }

  #builtin(local: string): SimpleModel {
    const builtin = builtins[local]
    if (!builtin) throw new Error(`Unsupported built-in type xs:${local}`)
    return {
      kind: 'simple',
      primitive: builtin[0],
      list: builtin[1],
      enumeration: undefined,
      qname: undefined,
      documentation: undefined
    }
  }

  #namedType(name: QName): SimpleModel | ComplexModel {
    if (name.namespace === XS) return this.#builtin(name.local)
    const key = keyOf(name)
    const known = this.#complex.get(key) ?? this.#simple.get(key)
    if (known) return known
    const simple = this.#registry.find('simpleType', name)
    if (simple) return this.#simpleType(simple.node, name)
    const { node, context } = this.#registry.component('complexType', name)
    return this.#complexType(node, context, name.local, name)
  }

  #simpleType(node: SchemaNode, qname: QName | undefined): SimpleModel {
    const restriction = node.children.find((child) => isXs(child, 'restriction'))
    const list = node.children.find((child) => isXs(child, 'list'))
    let model: SimpleModel
    if (restriction) {
      const base = this.#simpleBase(restriction, restriction.attributes['base'])
      const enumeration = restriction.children
        .filter((child) => isXs(child, 'enumeration'))
        .map((child) => child.attributes['value'] ?? '')
      model = {
        ...base,
        enumeration: enumeration.length > 0 ? enumeration : base.enumeration,
        qname,
        documentation: documentationOf(node)
      }
    } else if (list) {
      const item = this.#simpleBase(list, list.attributes['itemType'])
      model = { ...item, list: true, enumeration: undefined, qname, documentation: documentationOf(node) }
    } else {
      model = { ...this.#builtin('string'), qname, documentation: documentationOf(node) }
    }
    if (qname) this.#simple.set(keyOf(qname), model)
    return model
  }

  #simpleBase(node: SchemaNode, base: string | undefined): SimpleModel {
    if (base) {
      const type = this.#namedType(resolveQName(base, node.namespaces))
      if (type.kind === 'complex') {
        if (!type.text) throw new Error(`Simple type derived from complex type ${type.suggestedName}`)
        return type.text
      }
      return type
    }
    const inline = node.children.find((child) => isXs(child, 'simpleType'))
    return inline ? this.#simpleType(inline, undefined) : this.#builtin('string')
  }

  #complexType(
    node: SchemaNode,
    context: SchemaContext,
    suggestedName: string,
    qname: QName | undefined
  ): ComplexModel {
    const model: ComplexModel = {
      kind: 'complex',
      qname,
      suggestedName,
      fields: [],
      text: undefined,
      any: false,
      documentation: documentationOf(node)
    }
    if (qname) this.#complex.set(keyOf(qname), model)
    this.complexTypes.push(model)
    this.#content(model, node, context)
    return model
  }

  #content(model: ComplexModel, node: SchemaNode, context: SchemaContext): void {
    for (const child of node.children) {
      if (child.name.namespace !== XS) continue
      switch (child.name.local) {
        case 'sequence':
        case 'choice':
        case 'all':
        case 'group':
          this.#particles(model, child, context, false, false)
          break
        case 'attribute':
        case 'attributeGroup':
          this.#attributes(model, child, context)
          break
        case 'complexContent':
        case 'simpleContent':
          this.#derivation(model, child, context)
          break
        case 'anyAttribute':
        case 'annotation':
          break
        default:
          throw new Error(`Unsupported ${child.name.local} in complex type ${model.suggestedName}`)
      }
    }
  }

  #derivation(model: ComplexModel, node: SchemaNode, context: SchemaContext): void {
    const derivation = node.children.find((child) => isXs(child, 'extension') || isXs(child, 'restriction'))
    if (!derivation) return
    const baseName = derivation.attributes['base']
    const base = baseName ? this.#namedType(resolveQName(baseName, derivation.namespaces)) : undefined
    const extension = derivation.name.local === 'extension'
    if (base?.kind === 'simple') {
      model.text = base
    } else if (base?.kind === 'complex') {
      if (isXs(node, 'simpleContent')) model.text = base.text
      if (extension || isXs(node, 'simpleContent')) {
        model.fields.push(...base.fields.filter((field) => extension || field.attribute))
        model.any ||= extension && base.any
      }
    }
    this.#content(model, derivation, context)
  }

  #particles(model: ComplexModel, node: SchemaNode, context: SchemaContext, optional: boolean, array: boolean): void {
    const own = occurs(node)
    if (isXs(node, 'group')) {
      const ref = node.attributes['ref']
      if (!ref) throw new Error(`Group without ref in ${model.suggestedName}`)
      const group = this.#registry.component('group', resolveQName(ref, node.namespaces))
      for (const child of group.node.children) {
        if (isXs(child, 'sequence') || isXs(child, 'choice') || isXs(child, 'all')) {
          this.#particles(model, child, group.context, optional || own.optional, array || own.array)
        }
      }
      return
    }
    const choice = isXs(node, 'choice')
    for (const child of node.children) {
      if (child.name.namespace !== XS) continue
      const childOptional = optional || own.optional || choice
      const childArray = array || own.array
      switch (child.name.local) {
        case 'element':
          this.#element(model, child, context, childOptional, childArray)
          break
        case 'sequence':
        case 'choice':
        case 'all':
        case 'group':
          this.#particles(model, child, context, childOptional, childArray)
          break
        case 'any':
          model.any = true
          break
        case 'annotation':
          break
        default:
          throw new Error(`Unsupported ${child.name.local} in ${model.suggestedName}`)
      }
    }
  }

  #element(model: ComplexModel, node: SchemaNode, context: SchemaContext, optional: boolean, array: boolean): void {
    const own = occurs(node)
    const ref = node.attributes['ref']
    let field: FieldModel
    if (ref) {
      const name = resolveQName(ref, node.namespaces)
      const global = this.#registry.component('element', name)
      field = {
        name: name.local,
        namespace: name.namespace,
        attribute: false,
        optional: optional || own.optional,
        array: array || own.array,
        type: this.#elementType(global.node, global.context, `${model.suggestedName}${pascal(name.local)}`),
        documentation: documentationOf(node) ?? documentationOf(global.node)
      }
    } else {
      const name = node.attributes['name']
      if (!name) throw new Error(`Element without name in ${model.suggestedName}`)
      const qualified = node.attributes['form'] ? node.attributes['form'] === 'qualified' : context.elementsQualified
      field = {
        name,
        namespace: qualified ? context.targetNamespace : undefined,
        attribute: false,
        optional: optional || own.optional,
        array: array || own.array,
        type: this.#elementType(node, context, `${model.suggestedName}${pascal(name)}`),
        documentation: documentationOf(node)
      }
    }
    this.#addField(model, field)
  }

  #attributes(model: ComplexModel, node: SchemaNode, context: SchemaContext): void {
    if (isXs(node, 'attributeGroup')) {
      const ref = node.attributes['ref']
      if (!ref) throw new Error(`Attribute group without ref in ${model.suggestedName}`)
      const group = this.#registry.component('attributeGroup', resolveQName(ref, node.namespaces))
      for (const child of group.node.children) {
        if (isXs(child, 'attribute') || isXs(child, 'attributeGroup')) this.#attributes(model, child, group.context)
      }
      return
    }
    if (node.attributes['use'] === 'prohibited') return
    const ref = node.attributes['ref']
    const declaration = ref ? this.#registry.component('attribute', resolveQName(ref, node.namespaces)).node : node
    const name = ref ? resolveQName(ref, node.namespaces) : undefined
    const typeName = declaration.attributes['type']
    const inline = declaration.children.find((child) => isXs(child, 'simpleType'))
    const type = typeName
      ? this.#namedType(resolveQName(typeName, declaration.namespaces))
      : inline
        ? this.#simpleType(inline, undefined)
        : this.#builtin('anySimpleType')
    if (type.kind !== 'simple') throw new Error(`Attribute with complex type in ${model.suggestedName}`)
    const qualified = name !== undefined || node.attributes['form'] === 'qualified' || context.attributesQualified
    this.#addField(model, {
      name: name?.local ?? declaration.attributes['name'] ?? '',
      namespace: qualified ? (name?.namespace ?? context.targetNamespace) : undefined,
      attribute: true,
      optional: node.attributes['use'] !== 'required',
      array: false,
      type,
      documentation: documentationOf(node)
    })
  }

  #addField(model: ComplexModel, field: FieldModel): void {
    const existing = model.fields.findIndex((candidate) => candidate.name === field.name)
    if (existing === -1) {
      model.fields.push(field)
    } else if (model.fields[existing]?.attribute === field.attribute) {
      model.fields[existing] = field
    } else {
      throw new Error(`Attribute and element both named ${field.name} in ${model.suggestedName}`)
    }
  }
}
