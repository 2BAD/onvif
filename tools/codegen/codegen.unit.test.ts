import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { type Operation, decode, encodeRequest } from '../../packages/onvif/source/soap/codec.ts'
import { parseXml, type XmlObject } from '../../packages/onvif/source/soap/parse.ts'
import { serialize } from '../../packages/onvif/source/soap/serialize.ts'
import { emit } from './emit.ts'
import { ModelBuilder } from './model.ts'
import { Registry } from './registry.ts'
import { resolveQName } from './xml.ts'

const testDirectory = join(import.meta.dirname, 'test')
const codecPath = join(import.meta.dirname, '../../packages/onvif/source/soap/codec.ts')
const scratch = mkdtempSync(join(tmpdir(), 'codegen-test-'))

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const build = () => {
  const registry = new Registry()
  registry.load(join(testDirectory, 'service.wsdl'))
  const [operation] = registry.operations({ namespace: 'urn:test:service', local: 'Service' })
  if (!operation?.output) throw new Error('SetThing not found')
  const builder = new ModelBuilder(registry)
  const model = builder.operation(operation.name, operation.action, operation.input, operation.output)
  return { model, builder }
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

  it('puts inherited fields first and flattens attribute groups and attribute refs', () => {
    expect(thing?.fields.map(({ name }) => name)).toEqual([
      'Name',
      'token',
      'shared',
      'Mode',
      'Levels',
      'Mixed',
      'Percent',
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
  const source = emit({ commit: 'test', codecImport: '../soap/codec.ts', operations: [model] })

  it('matches the snapshot', async () => {
    await expect(source).toMatchFileSnapshot('test/__snapshots__/service.ts.snap')
  })

  it('prefixes colliding type names with their namespace', () => {
    expect(source).toMatch(/export type Ns\dStatus = \{\n {2}Code: number/)
    expect(source).toMatch(/export type Ns\dStatus = \{\n {2}Text: string/)
  })

  it('produces a module that encodes and decodes through the codec', async () => {
    const file = join(scratch, 'service.ts')
    writeFileSync(file, source.replace("'../soap/codec.ts'", `'${pathToFileURL(codecPath).href}'`))
    const generated = (await import(pathToFileURL(file).href)) as { SetThing: Operation<unknown, unknown> }
    const request = {
      Thing: {
        Name: 'n',
        token: 't',
        shared: true,
        Mode: 'Auto',
        Levels: [1, 2],
        Shared: new Date('2026-01-01T00:00:00.000Z'),
        Height: 5,
        Pair: ['a', 'b'],
        Label: { lang: 'en', value: 'label' },
        Payload: new Uint8Array([255])
      },
      Enabled: false
    }
    const xml = serialize(encodeRequest(generated.SetThing, request))
    expect(xml).toContain('<ns1:SetThing xmlns:ns1="urn:test:service" xmlns:ns2="urn:test:types">')
    expect(xml).toContain('ns2:shared="true"')
    const element = parseXml(xml)['SetThing'] as XmlObject
    expect(decode(generated.SetThing.schema, generated.SetThing.request.type, element)).toEqual(request)
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
