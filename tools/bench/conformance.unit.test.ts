import { describe, expect, it } from 'vitest'
import { ParseError } from '#onvif/errors.ts'
import { parseXml } from '#onvif/soap/parse.ts'
import { corpus } from '#tools/fixtures/corpus.ts'
import { parseXml as fxp } from '#tools/bench/fxp.ts'

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
const hasDoctype = (xml: string): boolean => /^\s*<!DOCTYPE/i.test(xml)

describe('conformance with fast-xml-parser', () => {
  it.each(corpus.filter((entry) => !hasDoctype(entry.xml)).map((entry) => [entry.name, entry.xml]))(
    '%s',
    (_name, xml) => {
      expect(plain(parseXml(xml))).toEqual(plain(fxp(xml)))
    }
  )

  it.each(corpus.filter((entry) => hasDoctype(entry.xml)).map((entry) => [entry.name, entry.xml]))(
    'rejects the DOCTYPE in %s',
    (_name, xml) => {
      expect(() => parseXml(xml)).toThrow(ParseError)
    }
  )
})
