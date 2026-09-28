import { describe, expect, it } from 'vitest'
import { parseXml } from '#onvif/soap/parse.ts'
import { corpus } from '#tools/fixtures/corpus.ts'
import { parseXml as fxp } from '#tools/bench/fxp.ts'

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

describe('conformance with fast-xml-parser', () => {
  it.each(corpus.map((entry) => [entry.name, entry.xml]))('%s', (_name, xml) => {
    expect(plain(parseXml(xml))).toEqual(plain(fxp(xml)))
  })
})
