import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { type Operation, type Schema, decode, encodeRequest } from '#onvif/soap/codec.ts'
import { parseXml, type XmlObject } from '#onvif/soap/parse.ts'
import { serialize } from '#onvif/soap/serialize.ts'
import { emit } from '#tools/codegen/emit.ts'
import { ModelBuilder, type OperationModel } from '#tools/codegen/model.ts'
import { Registry } from '#tools/codegen/registry.ts'
import { resolveQName } from '#tools/codegen/xml.ts'

const testDirectory = join(import.meta.dirname, 'test')
const codecPath = join(import.meta.dirname, '../../packages/onvif/source/soap/codec.ts')
const scratch = mkdtempSync(join(tmpdir(), 'codegen-test-'))

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const build = () => {
  const registry = new Registry()
  registry.load(join(testDirectory, 'service.wsdl'))
  const [operation] = registry.operations('Service')
  if (!operation) throw new Error('SetThing not found')
  const builder = new ModelBuilder(registry)
  const model = builder.operation(operation)
  return { model, builder }
}

const buildAll = () => {
  const registry = new Registry()
  registry.load(join(testDirectory, 'service.wsdl'))
  const builder = new ModelBuilder(registry)
  return registry.operations('Service').map((operation) => builder.operation(operation))
}

describe('ModelBuilder', () => {
  const { model, builder } = build()
  const thing = builder.complexTypes.find((type) => type.qname?.local === 'Thing')
  const field = (name: string) => thing?.fields.find((candidate) => candidate.name === name)

  it('reads the operation from the port type and binding', () => {
    expect(model).toMatchObject({
      name: 'SetThing',
      action: 'urn:test:service/SetThing',
      request: { element: { namespace: 'urn:test:service', local: 'SetThing' } },
      response: { element: { local: 'SetThingResponse' } }
    })
  })

  it('reads the operation documentation as plain text', () => {
    expect(model.documentation).toBe('Change a thing. The device shall keep the token.')
    expect(buildAll()[1]?.documentation).toBeUndefined()
  })

  it('puts inherited fields first and flattens attribute groups and attribute refs', () => {
    expect(thing?.fields.map(({ name }) => name)).toEqual([
      'Name',
      'token',
      'shared',
      'Mode',
      'Levels',
      'Mixed',
      'Percent',
      'MTU',
      'DNSname',
      'Shared',
      'Width',
      'Height',
      'Pair',
      'Note',
      'Label',
      'Payload'
    ])
    expect(field('token')).toMatchObject({ attribute: true, optional: false, namespace: undefined })
    expect(field('shared')).toMatchObject({ attribute: true, optional: true, namespace: 'urn:test:types' })
  })

  it('derives cardinality from particles, choices and nested sequences', () => {
    expect(field('Name')).toMatchObject({ optional: false, array: false, namespace: 'urn:test:types' })
    expect(field('Width')).toMatchObject({ optional: true })
    expect(field('Pair')).toMatchObject({ optional: false, array: true })
    expect(field('Note')).toMatchObject({ optional: true })
  })

  it('maps simple types to primitives, lists and enumerations', () => {
    expect(field('Mode')?.type).toMatchObject({ primitive: 'string', enumeration: ['Auto', 'Manual'] })
    expect(field('Levels')?.type).toMatchObject({ primitive: 'integer', list: true })
    expect(field('Mixed')?.type).toMatchObject({ primitive: 'string', list: false })
    expect(field('Percent')?.type).toMatchObject({ primitive: 'decimal' })
    expect(field('Shared')?.type).toMatchObject({ primitive: 'dateTime' })
    expect(field('Payload')?.type).toMatchObject({ primitive: 'base64' })
  })

  it('models simple content, inline types and extensions', () => {
    expect(field('Label')?.type).toMatchObject({
      kind: 'complex',
      suggestedName: 'ThingLabel',
      text: { primitive: 'string' }
    })
    expect(thing?.any).toBe(true)
    expect(thing?.documentation).toBe('A thing with everything.')
  })
})

describe('emit', () => {
  const { model } = build()
  const source = emit({ commit: 'test', codecImport: '#soap/codec.ts', operations: [model] })

  it('matches the snapshot', async () => {
    await expect(source).toMatchFileSnapshot('test/__snapshots__/service.ts.snap')
  })

  it('marks operations whose responses are parsed with namespaces', () => {
    expect(source).not.toContain('namespaces: true')
    const marked = emit({
      commit: 'test',
      codecImport: '#soap/codec.ts',
      operations: [model],
      namespaces: ['SetThing']
    })
    expect(marked).toContain("response: { name: 'SetThingResponse', type: 'SetThingResponse' },\n  namespaces: true,\n")
  })

  it('prefixes colliding type names with their namespace', () => {
    expect(source).toMatch(/export type Ns\dStatus = \{\n {2}code: number/)
    expect(source).toMatch(/export type Ns\dStatus = \{\n {2}text: string/)
  })

  it('converts field names to camelCase, keeps all caps names and records the spec name in the schema', () => {
    expect(source).toContain("{ name: 'Name', property: 'name', type: 'string', namespace: ns2 }")
    expect(source).toContain("{ name: 'token', type: 'string', attribute: true }")
    expect(source).toContain("{ name: 'MTU', type: 'integer', namespace: ns2, optional: true }")
  })

  it('names the misspelled DNSname field dnsName', () => {
    expect(source).toContain("{ name: 'DNSname', property: 'dnsName', type: 'string', namespace: ns2, optional: true }")
  })

  it('keeps spec names for fields whose camelCase names collide', () => {
    expect(source).toMatch(/^ {2}shared\?: boolean$/m)
    expect(source).toMatch(/^ {2}Shared\?: Date$/m)
  })

  it('produces a module that encodes and decodes through the codec', async () => {
    const file = join(scratch, 'service.ts')
    writeFileSync(file, source.replace("'#soap/codec.ts'", `'${pathToFileURL(codecPath).href}'`))
    const generated = (await import(pathToFileURL(file).href)) as { SetThing: Operation<unknown, unknown> }
    const request = {
      thing: {
        name: 'n',
        token: 't',
        shared: true,
        mode: 'Auto',
        levels: [1, 2],
        Shared: new Date('2026-01-01T00:00:00.000Z'),
        MTU: 1500,
        height: 5,
        pair: ['a', 'b'],
        label: { lang: 'en', value: 'label' },
        payload: new Uint8Array([255])
      },
      enabled: false
    }
    const xml = serialize(encodeRequest(generated.SetThing, request))
    expect(xml).toContain('<ns1:SetThing xmlns:ns1="urn:test:service" xmlns:ns2="urn:test:types">')
    expect(xml).toContain('ns2:shared="true"')
    const element = parseXml(xml)['SetThing'] as XmlObject
    expect(decode(generated.SetThing.schema, generated.SetThing.request.type, element)).toEqual(request)
  })
})

describe('client', () => {
  const operations = buildAll()
  const client = { name: 'ServiceClient', typesImport: '@2bad/onvif' }
  const source = emit({ commit: 'test', codecImport: '#soap/codec.ts', operations, client })
  const abstractSource = emit({
    commit: 'test',
    codecImport: '#soap/codec.ts',
    operations,
    client: { name: 'ServiceOperations', typesImport: '#device.ts', abstract: true }
  })

  it('matches the snapshot', async () => {
    await expect(source).toMatchFileSnapshot('test/__snapshots__/client.ts.snap')
  })

  it('emits a method per operation, with the request optional when every field is', () => {
    expect(source).toContain("import type { CallOptions, Device } from '@2bad/onvif'")
    expect(source).toContain(
      '  setThing(request: SetThingRequest, options?: CallOptions): Promise<SetThingResponse> {\n' +
        '    return this.#device.call(SetThing, request, options)\n'
    )
    expect(source).toContain(
      '  getThing(request?: GetThingRequest, options?: CallOptions): Promise<GetThingResponse> {'
    )
  })

  it('documents methods with the operation documentation', () => {
    expect(source).toContain(
      '  /**\n' +
        '   * Change a thing. The device shall keep the token.\n' +
        '   *\n' +
        '   * @param request - The `SetThing` request\n' +
        '   * @param options - Abort signal, timeout and addressing for this call\n' +
        '   * @returns The decoded `SetThingResponse`\n' +
        '   */\n' +
        '  setThing('
    )
    expect(source).toContain('  /**\n   * @param request - The `GetThing` request\n')
  })

  it('replaces typographic quotes and dashes with ASCII', () => {
    const [first, second] = operations
    if (!first || !second) throw new Error('operations not found')
    const documented = { ...first, documentation: '\u2018a\u2019 \u201cb\u201d c\u2013d e\u2014f' }
    const emitted = emit({ commit: 'test', codecImport: '#soap/codec.ts', operations: [documented, second], client })
    expect(emitted).toContain(`   * 'a' "b" c-d e-f\n`)
  })

  it('emits an abstract class that calls through an abstract call', () => {
    expect(abstractSource).toContain("import type { CallArguments, CallOptions } from '#device.ts'")
    expect(abstractSource).toContain('export abstract class ServiceOperations {\n  abstract call<Request, Response>(')
    expect(abstractSource).toContain('    return this.call(GetThing, request, options)\n')
    expect(abstractSource).not.toContain('this.#device')
  })

  it('emits methods only for the listed operations', () => {
    const listed = emit({
      commit: 'test',
      codecImport: '#soap/codec.ts',
      operations,
      client: { ...client, operations: ['GetThing'] }
    })
    expect(listed).toContain('  getThing(')
    expect(listed).not.toContain('  setThing(')
    expect(listed).toContain('export const SetThing: Operation<')
  })

  it('rejects a listed operation that is not generated', () => {
    expect(() =>
      emit({ commit: 'test', codecImport: '#soap/codec.ts', operations, client: { ...client, operations: ['Nope'] } })
    ).toThrow('Client ServiceClient lists the unknown operation Nope')
  })

  describe('scoped', () => {
    const scoped = { name: 'ThingClient', method: 'forToken', field: 'Token' }
    const scopedSource = emit({
      commit: 'test',
      codecImport: '#soap/codec.ts',
      operations,
      client: { ...client, scoped }
    })

    it('adds a method that returns the scoped client', () => {
      expect(scopedSource).toContain(
        '  forToken(token: string): ThingClient {\n    return new ThingClient(this.#device, token)\n  }\n'
      )
    })

    it('emits a scoped method only for operations whose request has the element, without it', () => {
      const scopedClass = scopedSource.slice(scopedSource.indexOf('export class ThingClient'))
      expect(scopedClass).toContain(
        "  getThing(request?: Omit<GetThingRequest, 'token'>, options?: CallOptions): Promise<GetThingResponse> {\n" +
          '    return this.#device.call(GetThing, { ...request, token: this.#token }, options)\n'
      )
      expect(scopedClass).toContain('   * @param request - The `GetThing` request without `token`\n')
      expect(scopedClass).not.toContain('setThing(')
    })

    it('fills the element from the constructor over any value in the request', async () => {
      const file = join(scratch, 'scoped.ts')
      writeFileSync(file, scopedSource.replace("'#soap/codec.ts'", `'${pathToFileURL(codecPath).href}'`))
      type Call = (operation: Operation<unknown, unknown>, request?: unknown, options?: unknown) => Promise<unknown>
      const module = (await import(pathToFileURL(file).href)) as {
        GetThing: Operation<unknown, unknown>
        ServiceClient: new (device: { call: Call }) => {
          forToken: (token: string) => { getThing: (request?: unknown) => Promise<unknown> }
        }
      }
      const call = vi.fn<Call>(async () => 'done')
      const scopedClient = new module.ServiceClient({ call }).forToken('t1')
      await scopedClient.getThing()
      await scopedClient.getThing({ token: 'other' })
      expect(call.mock.calls).toEqual([
        [module.GetThing, { token: 't1' }, undefined],
        [module.GetThing, { token: 't1' }, undefined]
      ])
    })

    it('rejects an element no operation has as a string element', () => {
      const build = (field: string) => () =>
        emit({
          commit: 'test',
          codecImport: '#soap/codec.ts',
          operations,
          client: { ...client, scoped: { ...scoped, field } }
        })
      expect(build('Nope')).toThrow('No operation of ThingClient has a request element Nope')
      expect(build('Thing')).toThrow('No operation of ThingClient has a request element Thing')
    })
  })

  it('produces classes that send each operation through the device', async () => {
    const codec = `'${pathToFileURL(codecPath).href}'`
    const concreteFile = join(scratch, 'client.ts')
    const abstractFile = join(scratch, 'operations.ts')
    writeFileSync(concreteFile, source.replace("'#soap/codec.ts'", codec))
    writeFileSync(abstractFile, abstractSource.replace("'#soap/codec.ts'", codec))
    type Call = (operation: Operation<unknown, unknown>, request?: unknown, options?: unknown) => Promise<unknown>
    type Methods = {
      getThing: (request?: unknown, options?: unknown) => Promise<unknown>
      setThing: (request: unknown, options?: unknown) => Promise<unknown>
    }
    const concrete = (await import(pathToFileURL(concreteFile).href)) as {
      GetThing: Operation<unknown, unknown>
      ServiceClient: new (device: { call: Call }) => Methods
    }
    const call = vi.fn<Call>(async () => ({ thing: 'decoded' }))
    const signal = AbortSignal.abort()
    await expect(new concrete.ServiceClient({ call }).getThing(undefined, { signal })).resolves.toEqual({
      thing: 'decoded'
    })
    expect(call).toHaveBeenCalledWith(concrete.GetThing, undefined, { signal })

    const operationsModule = (await import(pathToFileURL(abstractFile).href)) as {
      SetThing: Operation<unknown, unknown>
      ServiceOperations: abstract new () => Methods
    }
    const calls: unknown[][] = []
    class Device extends operationsModule.ServiceOperations {
      async call(...args: Parameters<Call>): Promise<unknown> {
        calls.push(args)
        return 'done'
      }
    }
    await expect(new Device().setThing({ token: 't' })).resolves.toBe('done')
    expect(calls).toEqual([[operationsModule.SetThing, { token: 't' }, undefined]])
  })
})

describe('elements', () => {
  it('emits the types of global elements that no operation uses', () => {
    const registry = new Registry()
    registry.load(join(testDirectory, 'service.wsdl'))
    const notice = new ModelBuilder(registry).element({ namespace: 'urn:test:types', local: 'Notice' })
    const source = emit({ commit: 'test', codecImport: '#soap/codec.ts', operations: [], elements: [notice] })
    expect(source).toMatch(/export type Notice = \{\n {2}detail: Status\n {2}remark\?: Remark\n {2}at: Date\n\}/)
    expect(source).toContain(
      "Notice: { fields: [{ name: 'Detail', property: 'detail', type: 'Status', namespace: ns1 }"
    )
  })
})

describe('mixed content', () => {
  it('decodes the text of a mixed type as its value', async () => {
    const registry = new Registry()
    registry.load(join(testDirectory, 'service.wsdl'))
    const notice = new ModelBuilder(registry).element({ namespace: 'urn:test:types', local: 'Notice' })
    const source = emit({ commit: 'test', codecImport: '#soap/codec.ts', operations: [], elements: [notice] })
    expect(source).toMatch(/export type Remark = \{\n {2}dialect: string\n {2}value: string\n/)
    const file = join(scratch, 'notice.ts')
    writeFileSync(file, source.replace("'#soap/codec.ts'", `'${pathToFileURL(codecPath).href}'`))
    const { schema } = (await import(pathToFileURL(file).href)) as { schema: Schema }
    const xml =
      '<Notice At="2026-01-01T00:00:00Z"><Detail><Code>1</Code></Detail><Remark Dialect="urn:d">a:b/c</Remark></Notice>'
    expect(decode(schema, 'Notice', parseXml(xml)['Notice'] as XmlObject)).toMatchObject({
      remark: { dialect: 'urn:d', value: 'a:b/c' }
    })
  })
})

describe('reserved names', () => {
  it('adds a Type suffix to types that would shadow JavaScript globals', () => {
    const registry = new Registry()
    registry.load(join(testDirectory, 'reserved.wsdl'))
    const [operation] = registry.operations('Service')
    if (!operation) throw new Error('GetDate not found')
    const model = new ModelBuilder(registry).operation(operation)
    const source = emit({ commit: 'test', codecImport: '#soap/codec.ts', operations: [model] })
    expect(source).toMatch(/export type DateType = \{\n {2}year: number\n {2}when: Date\n\}/)
    expect(source).toContain('calendar: DateType')
  })

  it('names the service of an operation that takes the request element of another ONVIF service', () => {
    const registry = new Registry()
    registry.load(join(testDirectory, 'borrowed.wsdl'))
    const builder = new ModelBuilder(registry)
    const models = registry.operations('Service').map((operation) => builder.operation(operation))
    expect(models.map(({ name, service }) => ({ name, service }))).toEqual([
      { name: 'GetPorts', service: undefined },
      { name: 'GetRelays', service: 'http://www.onvif.org/test/io/wsdl' },
      { name: 'Renew', service: undefined }
    ])
    const source = emit({ commit: 'test', codecImport: '#soap/codec.ts', operations: models })
    expect(source.match(/service: \w+/g)).toEqual(['service: ns1'])
    expect(source).toMatch(
      /request: \{ name: 'GetRelays', namespace: ns2, type: 'GetRelaysRequest' \},\n.*\n {2}service: ns1,/
    )
  })
})

describe('resolveQName', () => {
  it('rejects unknown prefixes', () => {
    expect(() => resolveQName('nope:Type', {})).toThrow("Unknown namespace prefix 'nope' in 'nope:Type'")
  })

  it('resolves the xml prefix without a declaration', () => {
    expect(resolveQName('xml:lang', {})).toEqual({ namespace: 'http://www.w3.org/XML/1998/namespace', local: 'lang' })
  })
})

describe('qnames and substitutions', () => {
  const items = 'urn:test:items'
  const builderFor = (qnames?: boolean) => {
    const registry = new Registry()
    registry.load(join(testDirectory, 'items.xsd'))
    return new ModelBuilder(registry, qnames)
  }
  const operationOf = (builder: ModelBuilder, local: string): OperationModel => {
    const type = builder.element({ namespace: items, local })
    return {
      name: `Get${local}`,
      action: `${items}/Get${local}`,
      request: {
        element: { namespace: items, local: 'Plain' },
        type: builder.element({ namespace: items, local: 'Plain' })
      },
      response: { element: { namespace: items, local }, type },
      documentation: undefined
    }
  }

  it('reads xs:QName as a string unless the qname primitive is asked for', () => {
    const type = (builder: ModelBuilder) =>
      builder.element({ namespace: items, local: 'Item' }).fields.find((field) => field.name === 'Type')?.type
    expect(type(builderFor())).toMatchObject({ kind: 'simple', primitive: 'string' })
    expect(type(builderFor(true))).toMatchObject({ kind: 'simple', primitive: 'qname' })
  })

  it('parses the responses that hold a QName with namespaces and types QNames as strings', () => {
    const builder = builderFor(true)
    const source = emit({
      commit: 'test',
      codecImport: '#soap/codec.ts',
      operations: [operationOf(builder, 'Item'), operationOf(builder, 'Extensible'), operationOf(builder, 'Plain')]
    })
    const marked = [...source.matchAll(/name: '(Get\w+)',[^}]*\}[^}]*\},\n {2}namespaces: true/g)].map(
      (match) => match[1]
    )
    expect(marked).toEqual(['GetItem', 'GetExtensible'])
    expect(source).toContain("{ name: 'Type', property: 'type', type: 'qname', attribute: true, optional: true }")
    expect(source).toContain("{ name: 'Kinds', property: 'kinds', type: 'qname[]', namespace: ns1, optional: true }")
    expect(source).toMatch(/export type Item = \{\n {2}name: string\n {2}type\?: string\n/)
  })

  it('adds a typed element for an xs:any, from the global element or else the complex type of its name', () => {
    const builder = builderFor()
    const item = builder.element({ namespace: items, local: 'Item' })
    for (const local of ['Shape', 'Grid', 'Numbers']) builder.substitute(item, { namespace: items, local })
    expect(
      item.fields.slice(2).map(({ name, optional, array, type }) => ({ name, optional, array, kind: type.kind }))
    ).toEqual([
      { name: 'Shape', optional: true, array: false, kind: 'complex' },
      { name: 'Grid', optional: true, array: false, kind: 'complex' },
      { name: 'Numbers', optional: true, array: false, kind: 'simple' }
    ])
    expect(item).toMatchObject({ any: true, anyRequired: true, choice: ['Shape', 'Grid', 'Numbers'] })
    const source = emit({ commit: 'test', codecImport: '#soap/codec.ts', operations: [], elements: [item] })
    expect(source).toMatch(
      /export type Item = \{\n[^}]*shape\?: Shape\n {2}grid\?: Grid\n {2}numbers\?: number\[\]\n {2}\$any/
    )
    expect(source).toContain("any: true, choice: ['shape', 'grid', 'numbers'] }")
  })

  it('adds no choice for an optional xs:any', () => {
    const builder = builderFor()
    const extensible = builder.element({ namespace: items, local: 'Extensible' })
    builder.substitute(extensible, { namespace: items, local: 'Shape' })
    expect(extensible).toMatchObject({ anyRequired: false, choice: [] })
    expect(
      emit({ commit: 'test', codecImport: '#soap/codec.ts', operations: [], elements: [extensible] })
    ).not.toContain('choice')
  })

  it('adds a repeatable element for a repeatable xs:any', () => {
    const builder = builderFor()
    const bag = builder.element({ namespace: items, local: 'Bag' })
    builder.substitute(bag, { namespace: items, local: 'Shape' })
    expect(bag.fields).toMatchObject([{ name: 'Shape', optional: true, array: true }])
    expect(bag).toMatchObject({ anyRequired: false, anyArray: true, choice: [] })
  })

  it('rejects a substitution for a type without xs:any', () => {
    const builder = builderFor()
    const plain = builder.element({ namespace: items, local: 'Plain' })
    expect(() => builder.substitute(plain, { namespace: items, local: 'Shape' })).toThrow(
      'Plain has no xs:any for {urn:test:items}Shape'
    )
  })

  it('adds a choice for a required choice of elements', () => {
    const either = builderFor().element({ namespace: items, local: 'Either' })
    expect(either.fields).toMatchObject([
      { name: 'Text', optional: true },
      { name: 'Numbers', optional: true }
    ])
    expect(either.choice).toEqual(['Text', 'Numbers'])
    expect(emit({ commit: 'test', codecImport: '#soap/codec.ts', operations: [], elements: [either] })).toContain(
      "choice: ['text', 'numbers']"
    )
  })

  it('adds no choice for an optional or repeated choice, or one with an optional element', () => {
    expect(builderFor().element({ namespace: items, local: 'Loose' }).choice).toEqual([])
  })

  it('rejects a type with two required choices', () => {
    expect(() => builderFor().element({ namespace: items, local: 'Twice' })).toThrow(
      'More than one required choice in Twice'
    )
  })
})
