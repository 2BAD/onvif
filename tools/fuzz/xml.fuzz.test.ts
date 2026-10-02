import {
  type Arbitrary,
  array,
  assert,
  constant,
  constantFrom,
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
import { applyMutation, mutation } from '#tools/fuzz/mutation.ts'

const numRuns = Number(process.env['FUZZ_RUNS'] ?? 2000)
const timeout = Math.max(30_000, numRuns * 20)
const prototypeKeyCount = Object.getOwnPropertyNames(Object.prototype).length

const parsesOrRejects = (xml: string): void => {
  for (const namespaces of [false, true]) {
    try {
      parseXml(xml, { maxLength: 1024 * 1024 }, { namespaces })
    } catch (error) {
      if (!(error instanceof ParseError)) throw error
    }
  }
  if (Object.getOwnPropertyNames(Object.prototype).length !== prototypeKeyCount || 'polluted' in {}) {
    throw new Error('Object.prototype was modified')
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

// namespace mode keeps text-only elements as objects so they can carry their namespace
const collapseLeaves = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(collapseLeaves)
  if (typeof value !== 'object' || value === null) return value
  const keys = Object.keys(value)
  if (keys.length === 0) return ''
  if (keys.length === 1 && keys[0] === '_') return (value as { _: string })._
  return Object.fromEntries(
    keys.map((key) => [
      key,
      key === '$' ? (value as Record<string, unknown>)[key] : collapseLeaves((value as Record<string, unknown>)[key])
    ])
  )
}

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

  it(
    'parses to the same values with and without namespaces',
    () => {
      assert(
        property(treeOfDepth(4), (root) => {
          const xml = serialize(root)
          expect(collapseLeaves(plain(parseXml(xml, undefined, { namespaces: true })))).toEqual(plain(parseXml(xml)))
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
