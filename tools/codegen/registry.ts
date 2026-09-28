import { dirname, join, resolve } from 'node:path'
import { type QName, readSchemaFile, resolveQName, type SchemaNode } from './xml.ts'

export const XS = 'http://www.w3.org/2001/XMLSchema'
const WSDL = 'http://schemas.xmlsoap.org/wsdl/'
const SOAP12 = 'http://schemas.xmlsoap.org/wsdl/soap12/'

export const specsDirectory = join(import.meta.dirname, 'specs')

export type SchemaContext = {
  targetNamespace: string
  elementsQualified: boolean
  attributesQualified: boolean
}

export type Component = { node: SchemaNode; context: SchemaContext }

export type WsdlOperation = {
  name: string
  namespace: string
  input: QName
  output: QName | undefined
  action: string
}

const componentKinds = ['complexType', 'simpleType', 'element', 'group', 'attributeGroup', 'attribute'] as const
type ComponentKind = (typeof componentKinds)[number]

export const keyOf = (name: QName): string => `{${name.namespace}}${name.local}`

const locate = (location: string, from: string): string => {
  const remote = /^https?:\/\/(.+)$/.exec(location)?.[1]
  if (remote === undefined) return resolve(dirname(from), location)
  const onvif = /^www\.onvif\.org\/(?:onvif\/)?(ver\d+\/.+)$/.exec(remote)?.[1]
  return onvif ? join(specsDirectory, 'onvif', onvif) : join(specsDirectory, 'external', remote)
}

const is = (node: SchemaNode, namespace: string, local: string): boolean =>
  node.name.namespace === namespace && node.name.local === local

export class Registry {
  readonly #loaded = new Set<string>()
  readonly #components = new Map<ComponentKind, Map<string, Component>>(componentKinds.map((kind) => [kind, new Map()]))
  readonly #messages = new Map<string, QName>()
  readonly #portTypes = new Map<string, { name: string; input: QName; output: QName | undefined }[]>()
  readonly #actions = new Map<string, string>()

  load(path: string): void {
    if (this.#loaded.has(path)) return
    this.#loaded.add(path)
    const root = readSchemaFile(path)
    if (is(root, XS, 'schema')) this.#loadSchema(root, path)
    else if (is(root, WSDL, 'definitions')) this.#loadWsdl(root, path)
    else throw new Error(`Unsupported document ${root.name.local} in ${path}`)
  }

  find(kind: ComponentKind, name: QName): Component | undefined {
    return this.#components.get(kind)?.get(keyOf(name))
  }

  component(kind: ComponentKind, name: QName): Component {
    const found = this.find(kind, name)
    if (!found) throw new Error(`Unknown ${kind} ${keyOf(name)}`)
    return found
  }

  operations(portType: QName): WsdlOperation[] {
    const operations = this.#portTypes.get(keyOf(portType))
    if (!operations) throw new Error(`Unknown portType ${keyOf(portType)}`)
    return operations.map((operation) => {
      const input = this.#messages.get(keyOf(operation.input))
      if (!input) throw new Error(`Unknown message ${keyOf(operation.input)}`)
      const output = operation.output ? this.#messages.get(keyOf(operation.output)) : undefined
      return {
        name: operation.name,
        namespace: portType.namespace,
        input,
        output,
        action: this.#actions.get(`${keyOf(portType)}#${operation.name}`) ?? ''
      }
    })
  }

  #loadSchema(schema: SchemaNode, path: string): void {
    const context: SchemaContext = {
      targetNamespace: schema.attributes['targetNamespace'] ?? '',
      elementsQualified: schema.attributes['elementFormDefault'] === 'qualified',
      attributesQualified: schema.attributes['attributeFormDefault'] === 'qualified'
    }
    for (const child of schema.children) {
      if (child.name.namespace !== XS) continue
      const kind = child.name.local
      if (kind === 'import' || kind === 'include') {
        const location = child.attributes['schemaLocation']
        if (location) this.load(locate(location, path))
      } else if ((componentKinds as readonly string[]).includes(kind)) {
        const name = child.attributes['name']
        if (name === undefined) throw new Error(`Unnamed global ${kind} in ${path}`)
        this.#components
          .get(kind as ComponentKind)
          ?.set(keyOf({ namespace: context.targetNamespace, local: name }), { node: child, context })
      }
    }
  }

  #loadWsdl(definitions: SchemaNode, path: string): void {
    const targetNamespace = definitions.attributes['targetNamespace'] ?? ''
    for (const child of definitions.children) {
      if (is(child, WSDL, 'import')) {
        const location = child.attributes['location']
        if (location) this.load(locate(location, path))
      } else if (is(child, WSDL, 'types')) {
        for (const schema of child.children) if (is(schema, XS, 'schema')) this.#loadSchema(schema, path)
      } else if (is(child, WSDL, 'message')) {
        const part = child.children.find((node) => is(node, WSDL, 'part'))
        const element = part?.attributes['element']
        if (element) {
          const name = { namespace: targetNamespace, local: child.attributes['name'] ?? '' }
          this.#messages.set(keyOf(name), resolveQName(element, part?.namespaces ?? {}))
        }
      } else if (is(child, WSDL, 'portType')) {
        const name = keyOf({ namespace: targetNamespace, local: child.attributes['name'] ?? '' })
        this.#portTypes.set(
          name,
          child.children
            .filter((node) => is(node, WSDL, 'operation'))
            .map((operation) => {
              const input = operation.children.find((node) => is(node, WSDL, 'input'))?.attributes['message']
              const output = operation.children.find((node) => is(node, WSDL, 'output'))?.attributes['message']
              if (!input) throw new Error(`Operation ${operation.attributes['name']} has no input in ${path}`)
              return {
                name: operation.attributes['name'] ?? '',
                input: resolveQName(input, operation.namespaces),
                output: output ? resolveQName(output, operation.namespaces) : undefined
              }
            })
        )
      } else if (is(child, WSDL, 'binding')) {
        const type = child.attributes['type']
        if (!type) continue
        const portType = keyOf(resolveQName(type, child.namespaces))
        for (const operation of child.children.filter((node) => is(node, WSDL, 'operation'))) {
          const action = operation.children.find((node) => is(node, SOAP12, 'operation'))?.attributes['soapAction']
          if (action) this.#actions.set(`${portType}#${operation.attributes['name']}`, action)
        }
      }
    }
  }
}
