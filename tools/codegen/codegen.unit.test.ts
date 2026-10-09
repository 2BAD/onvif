import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { type Operation, type Schema, decode, encodeRequest } from '#onvif/soap/codec.ts'
import { parseXml, type XmlObject } from '#onvif/soap/parse.ts'
import { serialize } from '#onvif/soap/serialize.ts'
import { emit } from '#tools/codegen/emit.ts'
import { ModelBuilder } from '#tools/codegen/model.ts'
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
})

describe('resolveQName', () => {
  it('rejects unknown prefixes', () => {
    expect(() => resolveQName('nope:Type', {})).toThrow("Unknown namespace prefix 'nope' in 'nope:Type'")
  })

  it('resolves the xml prefix without a declaration', () => {
    expect(resolveQName('xml:lang', {})).toEqual({ namespace: 'http://www.w3.org/XML/1998/namespace', local: 'lang' })
  })
})
