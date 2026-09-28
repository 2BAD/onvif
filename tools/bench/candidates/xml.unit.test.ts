import { describe, expect, it } from 'vitest'
import { corpus } from '../../fixtures/corpus.ts'
import { parseXml as fxp } from './fxp.ts'
import { parseXml, XmlParseError } from './xml.ts'

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

describe('conformance with fast-xml-parser', () => {
  it.each(corpus.map((entry) => [entry.name, entry.xml]))('%s', (_name, xml) => {
    expect(plain(parseXml(xml))).toEqual(plain(fxp(xml)))
  })
})

describe('parseXml', () => {
  it('strips namespace prefixes and xmlns declarations', () => {
    expect(
      plain(parseXml('<s:Envelope xmlns:s="urn:s"><s:Body xmlns="urn:x"><Name>a</Name></s:Body></s:Envelope>'))
    ).toEqual({
      Envelope: { Body: { Name: 'a' } }
    })
  })

  it('groups attributes under $ and text under _', () => {
    expect(plain(parseXml('<a x="1" p:y=\'2\'>text<b/></a>'))).toEqual({
      a: { $: { x: '1', y: '2' }, _: 'text', b: '' }
    })
  })

  it('turns repeated elements into arrays', () => {
    expect(plain(parseXml('<a><b>1</b><c/><b>2</b><b>3</b></a>'))).toEqual({ a: { b: ['1', '2', '3'], c: '' } })
  })

  it('decodes predefined entities and character references', () => {
    expect(parseXml('<a v="&quot;&apos;">&lt;&gt;&amp;&#65;&#x42;&#x1F600;</a>')).toEqual({
      a: { $: { v: `"'` }, _: '<>&AB\u{1F600}' }
    })
  })

  it('keeps CDATA unescaped and skips comments', () => {
    expect(parseXml('<a><!-- note --><![CDATA[<b>&amp;</b>]]></a>')).toEqual({ a: '<b>&amp;</b>' })
  })

  it('accepts a byte order mark and an XML declaration', () => {
    expect(parseXml(`${String.fromCharCode(0xfeff)}<?xml version="1.0" encoding="UTF-8"?>\n<a>1</a>\n`)).toEqual({
      a: '1'
    })
  })

  it('keeps element names that exist on Object.prototype', () => {
    const result = parseXml('<a><toString>1</toString><hasOwnProperty>2</hasOwnProperty><toString>3</toString></a>')
    expect(plain(result)).toEqual({ a: { toString: ['1', '3'], hasOwnProperty: '2' } })
  })

  it('returns objects without Object.prototype in their chain', () => {
    const result = parseXml('<a><b>1</b></a>')
    expect(result instanceof Object).toBe(false)
    expect('toString' in result).toBe(false)
  })
})

describe('parseXml rejects', () => {
  it.each([
    ['entity expansion (billion laughs)', '<!DOCTYPE a [<!ENTITY x "xx">]><a>&x;</a>', /DOCTYPE/],
    ['external entities', '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>', /DOCTYPE/],
    ['undeclared entities', '<a>&nbsp;</a>', /Unknown entity/],
    ['unterminated entities', '<a>&amp</a>', /Unterminated entity/],
    ['NUL character references', '<a>&#0;</a>', /Invalid character reference/],
    ['surrogate character references', '<a>&#xD800;</a>', /Invalid character reference/],
    ['out of range character references', '<a>&#x110000;</a>', /Invalid character reference/],
    ['processing instructions', '<a><?php echo 1 ?></a>', /Processing instructions/],
    ['late XML declarations', '<a/><?xml version="1.0"?>', /Processing instructions/],
    ['__proto__ elements', '<a><__proto__><polluted>1</polluted></__proto__></a>', /Forbidden name/],
    ['constructor attributes', '<a constructor="1"/>', /Forbidden name/],
    ['prototype elements with a prefix', '<a><x:prototype/></a>', /Forbidden name/],
    ['invalid names', '<1a/>', /Invalid name/],
    ['mismatched closing tags', '<a><b></a></b>', /Unexpected closing tag/],
    ['unclosed elements', '<a><b>', /Unclosed element/],
    ['multiple root elements', '<a/><b/>', /Multiple root elements/],
    ['text outside the root element', '<a/>junk', /Text outside/],
    ['empty documents', '   ', /No root element/],
    ['duplicate attributes', '<a x="1" x="2"/>', /Duplicate attribute/],
    ['missing whitespace between attributes', '<a x="1"y="2"/>', /Expected whitespace/],
    ['unquoted attribute values', '<a x=1/>', /Expected quoted/],
    ["'<' in attribute values", '<a x="<"/>', /'<' in attribute value/],
    ['unterminated comments', '<a><!-- x</a>', /Unterminated comment/],
    ['unterminated CDATA', '<a><![CDATA[x</a>', /Unterminated CDATA/]
  ] as const)('%s', (_name, xml, message) => {
    expect(() => parseXml(xml)).toThrow(XmlParseError)
    expect(() => parseXml(xml)).toThrow(message)
  })

  it('documents over the length limit', () => {
    expect(() => parseXml('<a>12345</a>', { maxLength: 8 })).toThrow(/exceeds 8 characters/)
  })

  it('documents over the depth limit', () => {
    expect(() => parseXml(`${'<a>'.repeat(65)}${'</a>'.repeat(65)}`)).toThrow(/exceeds depth 64/)
    expect(() => parseXml(`${'<a>'.repeat(64)}${'</a>'.repeat(64)}`)).not.toThrow()
  })

  it('documents over the element limit', () => {
    expect(() => parseXml(`<a>${'<b/>'.repeat(10)}</a>`, { maxNodes: 10 })).toThrow(/exceeds 10 elements/)
  })

  it('elements over the attribute limit', () => {
    const attributes = Array.from({ length: 5 }, (_, index) => `a${index}="1"`).join(' ')
    expect(() => parseXml(`<a ${attributes}/>`, { maxAttributes: 4 })).toThrow(/exceeds 4 attributes/)
  })
})
