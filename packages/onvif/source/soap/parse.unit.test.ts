import { describe, expect, it } from 'vitest'
import { ParseError } from '#errors.ts'
import { namespaceInfo, parseXml, type XmlObject } from '#soap/parse.ts'

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

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
    expect(() => parseXml(xml)).toThrow(ParseError)
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

describe('parseXml with namespaces', () => {
  const parse = (xml: string) => parseXml(xml, undefined, { namespaces: true })
  const child = (node: unknown, name: string) => (node as XmlObject)[name] as XmlObject

  it('keeps the shape of the default mode, with every element as an object', () => {
    expect(plain(parse('<s:E xmlns:s="urn:s"><s:B a="1">text</s:B><s:C/></s:E>'))).toEqual({
      E: { B: { $: { a: '1' }, _: 'text' }, C: {} }
    })
  })

  it('resolves element namespaces from declarations in scope, including the default namespace', () => {
    const root = parse(
      '<s:E xmlns:s="urn:s" xmlns="urn:d"><s:B><Plain/><x:Own xmlns:x="urn:x">1</x:Own><N xmlns=""/></s:B></s:E>'
    )
    const body = child(child(root, 'E'), 'B')
    expect(namespaceInfo(child(root, 'E'))?.namespace).toBe('urn:s')
    expect(namespaceInfo(child(body, 'Plain'))?.namespace).toBe('urn:d')
    expect(namespaceInfo(child(body, 'Own'))).toMatchObject({
      namespace: 'urn:x',
      namespaces: { s: 'urn:s', '': 'urn:d', x: 'urn:x', xml: 'http://www.w3.org/XML/1998/namespace' }
    })
    expect(namespaceInfo(child(body, 'N'))?.namespace).toBeUndefined()
    expect(namespaceInfo(child(root, 'E'))?.namespaces).not.toHaveProperty('x')
  })

  it('records namespaces of prefixed attributes and leaves undeclared prefixes unresolved', () => {
    const root = parse('<a xmlns:w="urn:w" w:ref="true" plain="1"><u:b u:x="2"/></a>')
    expect(namespaceInfo(child(root, 'a'))?.attributes).toEqual({ ref: 'urn:w' })
    expect(namespaceInfo(child(child(root, 'a'), 'b'))).toMatchObject({
      namespace: undefined,
      attributes: { x: undefined }
    })
  })

  it('decodes entities in declarations and keeps them in objects without a prototype', () => {
    const root = parse('<a xmlns:p="urn:a&amp;b" xmlns:__proto__="urn:bad"><p:b/></a>')
    expect(namespaceInfo(child(child(root, 'a'), 'b'))?.namespace).toBe('urn:a&b')
    expect(Object.getPrototypeOf(namespaceInfo(child(root, 'a'))?.namespaces)).toBeNull()
  })

  it('attaches nothing in the default mode', () => {
    expect(namespaceInfo(parseXml('<a xmlns="urn:a"><b x="1"/></a>'))).toBeUndefined()
    expect(namespaceInfo(child(parseXml('<a xmlns="urn:a"><b x="1"/></a>'), 'a'))).toBeUndefined()
  })
})
