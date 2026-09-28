import {
  type Arbitrary,
  array,
  assert,
  constant,
  constantFrom,
  integer,
  nat,
  oneof,
  property,
  record,
  string,
  stringMatching,
  tuple,
  uniqueArray
} from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ParseError } from '#onvif/errors.ts'
import { parseXml } from '#onvif/soap/parse.ts'
import { parseXml as fxp } from '#tools/bench/fxp.ts'
import { corpus } from '#tools/fixtures/corpus.ts'

const numRuns = Number(process.env['FUZZ_RUNS'] ?? 2000)
const timeout = Math.max(30_000, numRuns * 20)
const byteOrderMark = String.fromCharCode(0xfeff)
const prototypeKeyCount = Object.getOwnPropertyNames(Object.prototype).length

const parsesOrRejects = (xml: string): void => {
  try {
    parseXml(xml, { maxLength: 1024 * 1024 })
  } catch (error) {
    if (!(error instanceof ParseError)) throw error
  }
  if (Object.getOwnPropertyNames(Object.prototype).length !== prototypeKeyCount || 'polluted' in {}) {
    throw new Error('Object.prototype was modified')
  }
}

const hostileSnippets = [
  '<!DOCTYPE a [<!ENTITY x "xx">]>',
  '&x;',
  '&#0;',
  '&#xD800;',
  '&#99999999999;',
  '<__proto__><polluted>1</polluted></__proto__>',
  '<constructor><prototype><polluted>1</polluted></prototype></constructor>',
  ' __proto__="1"',
  '<?php ?>',
  '<![CDATA[',
  ']]>',
  '<!--',
  '-->',
  '</',
  '/>',
  '"',
  "'",
  '=',
  String.fromCharCode(0),
  byteOrderMark,
  '<a:b:c>',
  '<'.repeat(64)
]

type Mutation =
  | { kind: 'delete'; at: number; length: number }
  | { kind: 'insert'; at: number; text: string }
  | { kind: 'truncate'; at: number }
  | { kind: 'duplicate'; at: number; length: number }

const mutation: Arbitrary<Mutation> = oneof(
  record({ kind: constant('delete' as const), at: nat(), length: integer({ min: 1, max: 64 }) }),
  record({ kind: constant('insert' as const), at: nat(), text: oneof(string(), constantFrom(...hostileSnippets)) }),
  record({ kind: constant('truncate' as const), at: nat() }),
  record({ kind: constant('duplicate' as const), at: nat(), length: integer({ min: 1, max: 512 }) })
)

const applyMutation = (xml: string, change: Mutation): string => {
  const at = change.at % (xml.length + 1)
  switch (change.kind) {
    case 'delete':
      return xml.slice(0, at) + xml.slice(at + change.length)
    case 'insert':
      return xml.slice(0, at) + change.text + xml.slice(at)
    case 'truncate':
      return xml.slice(0, at)
    case 'duplicate':
      return xml.slice(0, at) + xml.slice(at, at + change.length).repeat(2) + xml.slice(at + change.length)
  }
}

const safeName = stringMatching(/^[A-Za-z][A-Za-z0-9]{0,7}$/).filter((name) => name !== 'constructor')
const text = string({ unit: 'grapheme', maxLength: 16 })
// fast-xml-parser trims attribute values, the spec (and our parser) keeps the whitespace
const attributeValue = text.map((value) => value.trim())
const entities: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }
const escape = (value: string): string => value.replace(/[<>&"']/g, (char) => entities[char] ?? char)

type Tree = { name: string; attributes: [string, string][]; text: string; children: Tree[] }

const treeOfDepth = (depth: number): Arbitrary<Tree> =>
  record({
    name: safeName,
    attributes: uniqueArray(tuple(safeName, attributeValue), { maxLength: 3, selector: ([name]) => name }),
    text,
    children: depth === 0 ? constant([]) : array(treeOfDepth(depth - 1), { maxLength: 3 })
  })

const serialize = (node: Tree): string => {
  const attributes = node.attributes.map(([name, value]) => ` ${name}="${escape(value)}"`).join('')
  return `<${node.name}${attributes}>${escape(node.text)}${node.children.map(serialize).join('')}</${node.name}>`
}

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

describe('xml parser fuzzing', () => {
  it(
    'only throws ParseError on arbitrary input',
    () => {
      expect(() => {
        assert(property(string({ unit: 'binary', maxLength: 512 }), parsesOrRejects), { numRuns })
      }).not.toThrow()
    },
    timeout
  )

  it(
    'only throws ParseError on mutated fixtures',
    () => {
      const documents = constantFrom(...corpus.map((entry) => entry.xml))
      const mutations = array(mutation, { minLength: 1, maxLength: 8 })
      expect(() => {
        assert(
          property(documents, mutations, (xml, changes) => parsesOrRejects(changes.reduce(applyMutation, xml))),
          { numRuns }
        )
      }).not.toThrow()
    },
    timeout
  )

  it(
    'matches fast-xml-parser on generated documents',
    () => {
      assert(
        property(treeOfDepth(4), (root) => {
          const xml = serialize(root)
          expect(plain(parseXml(xml))).toEqual(plain(fxp(xml)))
        }),
        { numRuns }
      )
    },
    timeout
  )

  it('rejects oversized input in linear time', () => {
    const inputs = [
      '<'.repeat(1_000_000),
      `<a${' x="1"'.repeat(100_000)}/>`,
      `<a>${'&amp;'.repeat(200_000)}</a>`,
      '<a>'.repeat(200_000),
      `<a>${'<!--x-->'.repeat(100_000)}</a>`
    ]
    for (const input of inputs) {
      const started = performance.now()
      parsesOrRejects(input)
      expect(performance.now() - started).toBeLessThan(500)
    }
  })
})
