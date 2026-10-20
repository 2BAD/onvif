import { assert, constantFrom, oneof, property, string, stringMatching } from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DecodeError } from '#onvif/errors.ts'
import { type Operation, type Schema, decode, encodeRequest } from '#onvif/soap/codec.ts'
import { prefixes } from '#onvif/soap/namespaces.ts'
import { parseXml, type XmlObject } from '#onvif/soap/parse.ts'
import { serialize } from '#onvif/soap/serialize.ts'

const numRuns = Number(process.env['FUZZ_RUNS'] ?? 2000)
const timeout = Math.max(30_000, numRuns * 20)

const tan = 'http://www.onvif.org/ver20/analytics/wsdl'
const schema: Schema = {
  Rule: { fields: [{ name: 'Type', type: 'qname', attribute: true }] },
  Request: { fields: [{ name: 'Rule', type: 'Rule', namespace: tan }] },
  Topic: { fields: [], text: 'prefixed' },
  Filter: { fields: [{ name: 'Topic', type: 'Topic', namespace: tan }] }
}
const setFilter: Operation<Record<string, unknown>, unknown> = {
  name: 'SetFilter',
  action: `${tan}/SetFilter`,
  request: { name: 'SetFilter', namespace: tan, type: 'Filter' },
  response: { name: 'SetFilterResponse', type: 'Filter' },
  schema
}
const operation: Operation<Record<string, unknown>, unknown> = {
  name: 'CreateRules',
  action: `${tan}/CreateRules`,
  request: { name: 'CreateRules', namespace: tan, type: 'Request' },
  response: { name: 'CreateRulesResponse', type: 'Request' },
  schema
}

const escape = (value: string): string => value.replace(/[<>&"]/g, (char) => `&#${char.charCodeAt(0)};`)
const local = stringMatching(/^[A-Za-z_][\w.-]{0,15}$/)
const namespace = oneof(
  constantFrom(...Object.keys(prefixes)),
  string({ unit: 'grapheme', maxLength: 32 }).filter((uri) => !/[{}]/.test(uri) && uri.trim() === uri)
)

const decodeRule = (xml: string): unknown =>
  decode(schema, 'Rule', parseXml(xml, undefined, { namespaces: true })['Rule'] as XmlObject)

describe('codec fuzzing', () => {
  it(
    'only throws DecodeError on arbitrary QNames and resolves the rest to a known prefix, a namespace or a local name',
    () => {
      const declarations =
        ' xmlns:a="urn:example:a" xmlns:tt="http://www.onvif.org/ver10/schema" xmlns="urn:example:default"'
      assert(
        property(string({ unit: 'grapheme', maxLength: 32 }), (value) => {
          let decoded: unknown
          try {
            decoded = decodeRule(`<Rule${declarations} Type="${escape(value)}"/>`)
          } catch (error) {
            if (!(error instanceof DecodeError)) throw error
            return
          }
          expect((decoded as { Type: string }).Type).toMatch(/^(?:tt:|\{urn:example:(?:a|default)\})[^\s:{}]+$/)
        }),
        { numRuns }
      )
    },
    timeout
  )

  it(
    'reads back every QName it writes',
    () => {
      assert(
        property(namespace, local, (uri, name) => {
          const element = parseXml(
            serialize(encodeRequest(operation, { Rule: { Type: `{${uri}}${name}` } })),
            undefined,
            {
              namespaces: true
            }
          )
          const known = prefixes[uri]
          const expected = uri === '' ? name : known === undefined ? `{${uri}}${name}` : `${known}:${name}`
          expect(decode(schema, 'Request', element['CreateRules'] as XmlObject)).toEqual({ Rule: { Type: expected } })
        }),
        { numRuns }
      )
    },
    timeout
  )

  it(
    'reads back every topic expression it writes',
    () => {
      const segment = oneof(
        local,
        local.map((name) => `tns1:${name}`),
        namespace.chain((uri) => local.map((name) => `{${uri}}${name}`))
      )
      const separator = constantFrom('/', '//', '|')
      const expression = segment.chain((first) =>
        oneof(
          constantFrom(first),
          separator.chain((joint) => segment.map((second) => `${first}${joint}${second}`))
        )
      )
      assert(
        property(expression, (value) => {
          const xml = serialize(encodeRequest(setFilter, { Topic: { value } }))
          const element = parseXml(xml, undefined, { namespaces: true })['SetFilter'] as XmlObject
          const normalized = value.replace(/\{([^{}]*)\}/g, (match, uri: string) => {
            const known = prefixes[uri]
            return uri === '' ? '' : known === undefined ? match : `${known}:`
          })
          expect(decode(schema, 'Filter', element)).toEqual({ Topic: { value: normalized.trim() } })
        }),
        { numRuns }
      )
    },
    timeout
  )

  it(
    'never throws on arbitrary topic text',
    () => {
      assert(
        property(string({ unit: 'grapheme', maxLength: 48 }), (value) => {
          const xml = `<Topic xmlns:a="urn:example:a" xmlns:tt="http://www.onvif.org/ver10/schema">${escape(value)}</Topic>`
          decode(schema, 'Topic', parseXml(xml, undefined, { namespaces: true })['Topic'] as XmlObject)
        }),
        { numRuns }
      )
    },
    timeout
  )
})
