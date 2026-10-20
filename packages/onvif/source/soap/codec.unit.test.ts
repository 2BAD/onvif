import { describe, expect, it } from 'vitest'
import { DecodeError, OnvifError } from '#errors.ts'
import { type Operation, type Schema, decode, encodeRequest } from '#soap/codec.ts'
import { XML_NAMESPACE } from '#soap/namespaces.ts'
import { namespaceInfo, parseXml, type XmlObject, type XmlValue } from '#soap/parse.ts'
import { serialize } from '#soap/serialize.ts'

const tt = 'http://www.onvif.org/ver10/schema'
const tds = 'http://www.onvif.org/ver10/device/wsdl'
const custom = 'urn:example:custom'

const schema: Schema = {
  Sample: {
    fields: [
      { name: 'token', type: 'string', attribute: true },
      { name: 'fixed', type: 'boolean', attribute: true, optional: true },
      { name: 'Name', type: 'string', namespace: tt },
      { name: 'Count', type: 'integer', namespace: tt, optional: true },
      { name: 'Ratio', type: 'decimal', namespace: tt, optional: true },
      { name: 'Enabled', type: 'boolean', namespace: tt, optional: true },
      { name: 'When', type: 'dateTime', namespace: tt, optional: true },
      { name: 'Blob', type: 'base64', namespace: tt, optional: true },
      { name: 'Levels', type: 'integer[]', namespace: tt, optional: true },
      { name: 'Item', type: 'Item', namespace: tt, optional: true, array: true },
      { name: 'Text', type: 'Text', namespace: tt, optional: true },
      { name: 'Raw', type: 'any', namespace: tt, optional: true }
    ],
    any: true
  },
  Item: { fields: [{ name: 'Value', type: 'integer', namespace: tt }] },
  Renamed: {
    fields: [
      { name: 'Id', property: 'id', type: 'integer', attribute: true },
      { name: 'HwAddress', property: 'hwAddress', type: 'string', namespace: tt }
    ]
  },
  Text: {
    fields: [{ name: 'lang', type: 'string', attribute: true, namespace: XML_NAMESPACE, optional: true }],
    text: 'string'
  },
  Request: {
    fields: [
      { name: 'Sample', type: 'Sample', namespace: tds },
      { name: 'Extra', type: 'string', namespace: custom, optional: true }
    ]
  }
}

const operation: Operation<Record<string, unknown>, unknown> = {
  name: 'SetSample',
  action: `${tds}/SetSample`,
  request: { name: 'SetSample', namespace: tds, type: 'Request' },
  response: { name: 'SetSampleResponse', type: 'Item' },
  schema
}

const parsed = (xml: string): XmlObject => parseXml(xml)['Sample'] as XmlObject

const thrown = (action: () => unknown): unknown => {
  try {
    action()
  } catch (error) {
    return error
  }
  throw new Error('Expected an error')
}

describe('decode', () => {
  it('converts values to their schema types', () => {
    const node = parsed(
      '<Sample token="t1" fixed="1"><Name>cam</Name><Count>-42</Count><Ratio>1.5e2</Ratio><Enabled>false</Enabled>' +
        '<When>2026-09-28T03:37:03Z</When><Blob>AQID</Blob><Levels> 1  2 3 </Levels><Item><Value>7</Value></Item>' +
        '<Text xml:lang="en">hello</Text><Raw><Any a="b">x</Any></Raw></Sample>'
    )
    expect(decode(schema, 'Sample', node)).toEqual({
      token: 't1',
      fixed: true,
      Name: 'cam',
      Count: -42,
      Ratio: 150,
      Enabled: false,
      When: new Date('2026-09-28T03:37:03Z'),
      Blob: new Uint8Array([1, 2, 3]),
      Levels: [1, 2, 3],
      Item: [{ Value: 7 }],
      Text: { lang: 'en', value: 'hello' },
      Raw: parseXml('<Raw><Any a="b">x</Any></Raw>')['Raw']
    })
  })

  it('always returns arrays for repeatable elements and leaves out absent optional fields', () => {
    const one = decode(
      schema,
      'Sample',
      parsed('<Sample token="t"><Name>a</Name><Item><Value>1</Value></Item></Sample>')
    )
    const two = decode(
      schema,
      'Sample',
      parsed('<Sample token="t"><Name>a</Name><Item><Value>1</Value></Item><Item><Value>2</Value></Item></Sample>')
    )
    expect(one).toEqual({ token: 't', Name: 'a', Item: [{ Value: 1 }] })
    expect(two).toMatchObject({ Item: [{ Value: 1 }, { Value: 2 }] })
    expect(Object.keys(one as object)).not.toContain('Count')
  })

  it('keeps unknown elements under $any when the type allows extensions', () => {
    const result = decode(
      schema,
      'Sample',
      parsed('<Sample token="t"><Name>a</Name><Vendor><X>1</X></Vendor></Sample>')
    )
    expect(result).toMatchObject({ $any: { Vendor: { X: '1' } } })
    expect(decode(schema, 'Item', parseXml('<Item><Value>1</Value><Vendor/></Item>')['Item'] as XmlObject)).toEqual({
      Value: 1
    })
  })

  it('accepts INF, -INF and NaN for decimals', () => {
    const decimals = ['INF', '-INF', 'NaN'].map(
      (value) =>
        (
          decode(schema, 'Sample', parsed(`<Sample token="t"><Name>a</Name><Ratio>${value}</Ratio></Sample>`)) as {
            Ratio: number
          }
        ).Ratio
    )
    expect(decimals).toEqual([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN])
  })

  it('reads text content of an element that only has text', () => {
    expect(decode(schema, 'Text', 'plain')).toEqual({ value: 'plain' })
  })

  it('reads a dateTime without a zone as UTC and keeps explicit offsets', () => {
    const when = (value: string) =>
      (
        decode(schema, 'Sample', parsed(`<Sample token="t"><Name>a</Name><When>${value}</When></Sample>`)) as {
          When: Date
        }
      ).When.toISOString()
    expect(when('2026-09-28T04:01:39')).toBe('2026-09-28T04:01:39.000Z')
    expect(when(' 2026-09-28T04:01:39.25 ')).toBe('2026-09-28T04:01:39.250Z')
    expect(when('2026-09-28T06:01:39+02:00')).toBe('2026-09-28T04:01:39.000Z')
  })

  it.each(['1', 'March 7, 2020', '2026-09-28', '2026-02-31T00:00:00Z', '2026-09-28 04:01:39Z', '2026-13-01T00:00:00Z'])(
    'rejects %j as a dateTime',
    (value) => {
      const xml = `<Sample token="t"><Name>a</Name><When>${value}</When></Sample>`
      expect(() => decode(schema, 'Sample', parsed(xml))).toThrow(`Invalid dateTime '${value}' at Sample.When`)
    }
  )

  it('reads base64 with line breaks and padding', () => {
    const blob = (value: string) =>
      (
        decode(schema, 'Sample', parsed(`<Sample token="t"><Name>a</Name><Blob>${value}</Blob></Sample>`)) as {
          Blob: Uint8Array
        }
      ).Blob
    expect(blob('AQ\n ID')).toEqual(new Uint8Array([1, 2, 3]))
    expect(blob('AQ==')).toEqual(new Uint8Array([1]))
    expect(blob('')).toEqual(new Uint8Array([]))
  })

  it.each([
    ['without padding', 'AQ'],
    ['with bits set past the end', 'AR=='],
    ['with an incomplete group', 'AQI'],
    ['with data after the padding', 'AQ=I'],
    ['in the URL alphabet', 'AQ-_'],
    ['with a non-ASCII space', 'AQ\u00a0ID']
  ])('rejects base64 %s', (_name, value) => {
    const xml = `<Sample token="t"><Name>a</Name><Blob>${value}</Blob></Sample>`
    expect(() => decode(schema, 'Sample', parsed(xml))).toThrow('Invalid base64 value at Sample.Blob')
  })

  it('carries the namespaces of an element parsed with namespaces to the decoded object', () => {
    const root = parseXml(
      '<t:Sample xmlns:t="urn:t" xmlns:tns1="urn:topics" token="x"><t:Name>a</t:Name><t:Text>tns1:A</t:Text></t:Sample>',
      undefined,
      { namespaces: true }
    )
    const result = decode(schema, 'Sample', root['Sample'] as XmlObject) as { Text: object }
    expect(namespaceInfo(result)).toMatchObject({ namespace: 'urn:t', namespaces: { tns1: 'urn:topics' } })
    expect(namespaceInfo(result.Text)?.namespace).toBe('urn:t')
    expect(
      namespaceInfo(decode(schema, 'Sample', parsed('<Sample token="t"><Name>a</Name></Sample>')) as object)
    ).toBeUndefined()
  })

  it.each([
    ['a missing required element', '<Sample token="t"/>', 'Missing required element Name at Sample'],
    ['a missing required attribute', '<Sample><Name>a</Name></Sample>', 'Missing required attribute token at Sample'],
    [
      'an invalid integer',
      '<Sample token="t"><Name>a</Name><Count>1.5</Count></Sample>',
      "Invalid integer '1.5' at Sample.Count"
    ],
    [
      'an integer outside the safe range',
      '<Sample token="t"><Name>a</Name><Count>18446744073709551615</Count></Sample>',
      "Invalid integer '18446744073709551615' at Sample.Count"
    ],
    [
      'invalid base64',
      '<Sample token="t"><Name>a</Name><Blob>!!!not base64!!!</Blob></Sample>',
      'Invalid base64 value at Sample.Blob'
    ],
    [
      'an invalid number',
      '<Sample token="t"><Name>a</Name><Ratio>abc</Ratio></Sample>',
      "Invalid number 'abc' at Sample.Ratio"
    ],
    [
      'an invalid boolean',
      '<Sample token="t"><Name>a</Name><Enabled>yes</Enabled></Sample>',
      "Invalid boolean 'yes' at Sample.Enabled"
    ],
    [
      'an invalid date',
      '<Sample token="t"><Name>a</Name><When>soon</When></Sample>',
      "Invalid dateTime 'soon' at Sample.When"
    ],
    [
      'an invalid list item',
      '<Sample token="t"><Name>a</Name><Levels>1 x</Levels></Sample>',
      "Invalid integer 'x' at Sample.Levels[1]"
    ],
    [
      'a nested error',
      '<Sample token="t"><Name>a</Name><Item><Value>1</Value></Item><Item/></Sample>',
      'Missing required element Value at Sample.Item[1]'
    ]
  ])('rejects %s with the path', (_name, xml, message) => {
    const error = thrown(() => decode(schema, 'Sample', parsed(xml), { host: 'camera' }))
    expect(error).toBeInstanceOf(DecodeError)
    expect(error).toMatchObject({ message, host: 'camera' })
  })

  it('uses the first occurrence when an element that should occur once is repeated', () => {
    const xml = '<Sample token="t"><Name>a</Name><Name>b</Name><Levels>1</Levels><Levels>2</Levels></Sample>'
    expect(decode(schema, 'Sample', parsed(xml))).toMatchObject({ Name: 'a', Levels: [1] })
  })

  it('stores fields under their property names and reports errors with spec names', () => {
    const node = parseXml('<Renamed Id="3"><HwAddress>02:00:00:00:00:01</HwAddress></Renamed>')['Renamed'] as XmlObject
    expect(decode(schema, 'Renamed', node)).toEqual({ id: 3, hwAddress: '02:00:00:00:00:01' })
    expect(() => decode(schema, 'Renamed', parseXml('<Renamed Id="3"/>')['Renamed'] as XmlObject)).toThrow(
      'Missing required element HwAddress at Renamed'
    )
  })

  it('decodes the first item of a list given to decode, and an empty list as an empty value', () => {
    expect(decode(schema, 'Item', [parseXml('<Item><Value>1</Value></Item>')['Item'] ?? '', '<x/>'])).toEqual({
      Value: 1
    })
    expect(decode(schema, 'string', [])).toBe('')
  })

  it('rejects unknown schema types', () => {
    expect(() => decode(schema, 'Missing', '')).toThrow(OnvifError)
  })
})

describe('encodeRequest', () => {
  const sample = {
    token: 't<1>',
    fixed: false,
    Name: 'cam & co',
    Count: 3,
    Ratio: Number.POSITIVE_INFINITY,
    Enabled: true,
    When: new Date('2026-09-28T03:37:03.250Z'),
    Blob: new Uint8Array([1, 2, 3]),
    Levels: [1, 2],
    Item: [{ Value: 1 }, { Value: 2 }],
    Text: { lang: 'en', value: 'hi' }
  }

  it('writes elements in schema order with prefixes and namespace declarations', () => {
    const xml = serialize(encodeRequest(operation, { Extra: 'x', Sample: sample }))
    expect(xml).toBe(
      `<tds:SetSample xmlns:tds="${tds}" xmlns:tt="${tt}" xmlns:ns3="${custom}"><tds:Sample token="t&lt;1&gt;" fixed="false">` +
        '<tt:Name>cam &amp; co</tt:Name><tt:Count>3</tt:Count><tt:Ratio>INF</tt:Ratio><tt:Enabled>true</tt:Enabled>' +
        '<tt:When>2026-09-28T03:37:03.250Z</tt:When><tt:Blob>AQID</tt:Blob><tt:Levels>1 2</tt:Levels>' +
        '<tt:Item><tt:Value>1</tt:Value></tt:Item><tt:Item><tt:Value>2</tt:Value></tt:Item>' +
        '<tt:Text xml:lang="en">hi</tt:Text></tds:Sample><ns3:Extra>x</ns3:Extra></tds:SetSample>'
    )
  })

  it('round trips through serialize, parse and decode', () => {
    const element = parseXml(serialize(encodeRequest(operation, { Sample: sample })))['SetSample'] as XmlObject
    expect(decode(schema, 'Request', element)).toEqual({ Sample: sample })
  })

  it('writes zero, false and empty values instead of dropping them', () => {
    const empty = {
      token: '',
      fixed: false,
      Name: '',
      Count: 0,
      Ratio: 0,
      Enabled: false,
      Levels: [0],
      Item: [{ Value: 0 }]
    }
    const xml = serialize(encodeRequest(operation, { Sample: empty }))
    expect(xml).toBe(
      `<tds:SetSample xmlns:tds="${tds}" xmlns:tt="${tt}"><tds:Sample token="" fixed="false">` +
        '<tt:Name></tt:Name><tt:Count>0</tt:Count><tt:Ratio>0</tt:Ratio><tt:Enabled>false</tt:Enabled>' +
        '<tt:Levels>0</tt:Levels><tt:Item><tt:Value>0</tt:Value></tt:Item></tds:Sample></tds:SetSample>'
    )
    expect(decode(schema, 'Request', parseXml(xml)['SetSample'] as XmlObject)).toEqual({ Sample: empty })
  })

  it.each([
    ['a missing required value', { Sample: { token: 't' } }, 'Missing required Name at SetSample.Sample'],
    [
      'a wrong primitive type',
      { Sample: { token: 't', Name: 'a', Count: 1.5 } },
      'Invalid integer value at SetSample.Sample.Count'
    ],
    [
      'an invalid date',
      { Sample: { token: 't', Name: 'a', When: new Date('x') } },
      'Invalid dateTime value at SetSample.Sample.When'
    ],
    [
      'a scalar for an array',
      { Sample: { token: 't', Name: 'a', Item: { Value: 1 } } },
      'Expected an array at SetSample.Sample.Item'
    ],
    [
      'a scalar for a list',
      { Sample: { token: 't', Name: 'a', Levels: 1 } },
      'Expected an array at SetSample.Sample.Levels'
    ],
    ['a number for a string', { Sample: { token: 't', Name: 1 } }, 'Invalid string value at SetSample.Sample.Name'],
    [
      'a string for a boolean',
      { Sample: { token: 't', Name: 'a', Enabled: 'true' } },
      'Invalid boolean value at SetSample.Sample.Enabled'
    ],
    [
      'a string for base64',
      { Sample: { token: 't', Name: 'a', Blob: 'AQID' } },
      'Invalid base64 value at SetSample.Sample.Blob'
    ],
    ['an object for any', { Sample: { token: 't', Name: 'a', Raw: {} } }, 'Invalid any value at SetSample.Sample.Raw'],
    ['a string for an object', { Sample: 'x' }, 'Expected an object at SetSample.Sample'],
    ['NaN', { Sample: { token: 't', Name: 'a', Ratio: Number.NaN } }, 'Invalid decimal value at SetSample.Sample.Ratio']
  ])('rejects %s', (_name, request, message) => {
    expect(() => encodeRequest(operation, request)).toThrow(message)
  })

  it('reads fields from their property names and writes spec names', () => {
    const renamed: Operation<Record<string, unknown>, unknown> = {
      ...operation,
      request: { name: 'SetRenamed', namespace: tds, type: 'Renamed' }
    }
    expect(serialize(encodeRequest(renamed, { id: 3, hwAddress: 'a' }))).toBe(
      `<tds:SetRenamed xmlns:tds="${tds}" xmlns:tt="${tt}" Id="3"><tt:HwAddress>a</tt:HwAddress></tds:SetRenamed>`
    )
    expect(() => encodeRequest(renamed, { id: 3 })).toThrow('Missing required hwAddress at SetRenamed')
  })

  it('writes an any value as escaped text', () => {
    const xml = serialize(encodeRequest(operation, { Sample: { token: 't', Name: 'a', Raw: '<b>' } }))
    expect(xml).toContain('<tt:Raw>&lt;b&gt;</tt:Raw>')
  })

  it('rejects a schema with an unknown primitive', () => {
    const broken: Schema = { Request: { fields: [{ name: 'Value', type: 'float[]' }] } }
    const brokenOperation = { ...operation, schema: broken }
    expect(() => encodeRequest(brokenOperation, { Value: [1] })).toThrow('Unknown primitive float')
    expect(() => decode(broken, 'Request', parsed('<Sample><Value>1</Value></Sample>'))).toThrow(
      'Unknown primitive float'
    )
  })

  it('escapes values so they cannot add elements', () => {
    const element = encodeRequest(operation, {
      Sample: { token: 't', Name: '</tt:Name><tt:Count>9</tt:Count><tt:Name>' }
    })
    expect(parseXml(serialize(element))).toMatchObject({
      SetSample: { Sample: { Name: '</tt:Name><tt:Count>9</tt:Count><tt:Name>' } }
    })
  })
})

describe('qname', () => {
  const tan = 'http://www.onvif.org/ver20/analytics/wsdl'
  const qnames: Schema = {
    Rule: {
      fields: [
        { name: 'Type', type: 'qname', attribute: true },
        { name: 'Kinds', type: 'qname[]', attribute: true, optional: true },
        { name: 'Topic', type: 'qname', namespace: tt, optional: true }
      ]
    },
    Request: { fields: [{ name: 'Rule', type: 'Rule', namespace: tan, array: true }] }
  }
  const createRules: Operation<Record<string, unknown>, unknown> = {
    name: 'CreateRules',
    action: `${tan}/CreateRules`,
    request: { name: 'CreateRules', namespace: tan, type: 'Request' },
    response: { name: 'CreateRulesResponse', type: 'Request' },
    schema: qnames
  }
  const rule = (xml: string): XmlObject => parseXml(xml, undefined, { namespaces: true })['Rule'] as XmlObject

  it.each([
    ['the standard prefix', '<a:Rule xmlns:a="urn:a" xmlns:tt="http://www.onvif.org/ver10/schema" Type="tt:Cell"/>'],
    [
      'a device prefix for a known namespace',
      '<a:Rule xmlns:a="urn:a" xmlns:ns2="http://www.onvif.org/ver10/schema" Type="ns2:Cell"/>'
    ],
    ['the default namespace', '<Rule xmlns="http://www.onvif.org/ver10/schema" Type="Cell"/>']
  ])('reads a QName with %s as the standard prefix', (_name, xml) => {
    expect(decode(qnames, 'Rule', rule(xml))).toEqual({ Type: 'tt:Cell' })
  })

  it('reads a QName in an unknown namespace in {namespace}local form', () => {
    expect(decode(qnames, 'Rule', rule('<Rule xmlns:v="urn:vendor" Type=" v:Line "/>'))).toEqual({
      Type: '{urn:vendor}Line'
    })
  })

  it('reads an unprefixed QName without a default namespace as its local name', () => {
    expect(decode(qnames, 'Rule', rule('<Rule Type="Cell"/>'))).toEqual({ Type: 'Cell' })
    expect(decode(qnames, 'Rule', rule('<a:Rule xmlns:a="urn:a" xmlns="" Type="Cell"/>'))).toEqual({ Type: 'Cell' })
  })

  it('resolves QName lists and element text with the declarations in scope at the element', () => {
    const xml =
      '<Rule xmlns:p="http://www.onvif.org/ver10/schema" Type="p:A" Kinds="p:B xs:C">' +
      '<p:Topic xmlns:p="http://www.onvif.org/ver20/analytics">p:D</p:Topic></Rule>'
    const withXs = xml.replace('<Rule ', '<Rule xmlns:xs="http://www.w3.org/2001/XMLSchema" ')
    expect(decode(qnames, 'Rule', rule(withXs))).toEqual({ Type: 'tt:A', Kinds: ['tt:B', 'xs:C'], Topic: 'axt:D' })
  })

  it.each([
    ['an undeclared prefix', '<Rule Type="v:Line"/>', "Undeclared prefix in QName 'v:Line' at Rule.Type"],
    ['an empty QName', '<Rule Type=" "/>', "Invalid QName '' at Rule.Type"],
    ['a QName with two colons', '<Rule xmlns:a="urn:a" Type="a:b:c"/>', "Invalid QName 'a:b:c' at Rule.Type"]
  ])('rejects %s', (_name, xml, message) => {
    const error = thrown(() => decode(qnames, 'Rule', rule(xml), { host: 'camera' }))
    expect(error).toBeInstanceOf(DecodeError)
    expect(error).toMatchObject({ message, host: 'camera' })
  })

  it('needs a response parsed with namespaces', () => {
    const element = parseXml('<Rule Type="tt:Cell"/>')['Rule'] as XmlObject
    const error = thrown(() => decode(qnames, 'Rule', element))
    expect(error).toBeInstanceOf(OnvifError)
    expect(error).not.toBeInstanceOf(DecodeError)
    expect(error).toMatchObject({ message: 'The QName at Rule.Type needs a response parsed with namespaces' })
  })

  it('declares the namespace of every prefix it writes', () => {
    const xml = serialize(
      encodeRequest(createRules, {
        Rule: [{ Type: 'tt:Cell', Kinds: ['axt:Region', '{urn:vendor}Line', 'Plain'], Topic: '{}Local' }]
      })
    )
    expect(xml).toBe(
      `<tan:CreateRules xmlns:tan="${tan}" xmlns:tt="${tt}" xmlns:axt="http://www.onvif.org/ver20/analytics" ` +
        'xmlns:ns4="urn:vendor"><tan:Rule Type="tt:Cell" Kinds="axt:Region ns4:Line Plain">' +
        '<tt:Topic>Local</tt:Topic></tan:Rule></tan:CreateRules>'
    )
  })

  it('round trips a QName in an unknown namespace', () => {
    const request = { Rule: [{ Type: '{urn:vendor}Line' }] }
    const element = parseXml(serialize(encodeRequest(createRules, request)), undefined, { namespaces: true })
    expect(decode(qnames, 'Request', element['CreateRules'] as XmlValue)).toEqual(request)
  })

  it.each([
    ['an unknown prefix', 'v:Line', 'Unknown prefix v in the QName at CreateRules.Rule[0].Type'],
    ['a QName with spaces', 'tt:A B', 'Invalid QName at CreateRules.Rule[0].Type'],
    ['a number', 1, 'Invalid qname value at CreateRules.Rule[0].Type']
  ])('rejects %s on encode', (_name, type, message) => {
    expect(() => encodeRequest(createRules, { Rule: [{ Type: type }] })).toThrow(message)
  })
})

describe('choice', () => {
  const choices: Schema = {
    Item: {
      fields: [
        { name: 'Name', property: 'name', type: 'string', attribute: true },
        { name: 'CellLayout', property: 'cellLayout', type: 'Layout', namespace: tt, optional: true },
        { name: 'Polygon', property: 'polygon', type: 'Layout', namespace: tt, optional: true }
      ],
      any: true,
      choice: ['cellLayout', 'polygon']
    },
    Layout: { fields: [{ name: 'Columns', type: 'integer', attribute: true }] },
    Request: { fields: [{ name: 'Item', property: 'item', type: 'Item', namespace: tt, array: true }] }
  }
  const setItems: Operation<Record<string, unknown>, unknown> = {
    name: 'SetItems',
    action: `${tds}/SetItems`,
    request: { name: 'SetItems', namespace: tds, type: 'Request' },
    response: { name: 'SetItemsResponse', type: 'Request' },
    schema: choices
  }

  it('writes the one element of the choice', () => {
    expect(serialize(encodeRequest(setItems, { item: [{ name: 'Layout', cellLayout: { Columns: 22 } }] }))).toBe(
      `<tds:SetItems xmlns:tds="${tds}" xmlns:tt="${tt}"><tt:Item Name="Layout">` +
        '<tt:CellLayout Columns="22"/></tt:Item></tds:SetItems>'
    )
  })

  it.each([
    ['none of the choice', { name: 'Layout' }],
    ['only content it read and cannot write', { name: 'Layout', $any: { VendorShape: { _: '1' } } }],
    ['two elements of the choice', { name: 'Layout', cellLayout: { Columns: 1 }, polygon: { Columns: 2 } }]
  ])('rejects an item with %s', (_name, item) => {
    expect(() => encodeRequest(setItems, { item: [item] })).toThrow(
      'Expected one of cellLayout, polygon at SetItems.item[0]'
    )
  })

  it('reads an item without an element of the choice', () => {
    const element = parseXml('<Request><Item Name="Layout"><VendorShape>1</VendorShape></Item></Request>')
    expect(decode(choices, 'Request', element['Request'] as XmlValue)).toEqual({
      item: [{ name: 'Layout', $any: { VendorShape: '1' } }]
    })
  })
})

describe('qname namespaces named like Object.prototype members', () => {
  const schema: Schema = { Rule: { fields: [{ name: 'Type', type: 'qname', attribute: true }] } }
  const createRule: Operation<Record<string, unknown>, unknown> = {
    name: 'CreateRule',
    action: `${tds}/CreateRule`,
    request: { name: 'CreateRule', namespace: tds, type: 'Rule' },
    response: { name: 'CreateRuleResponse', type: 'Rule' },
    schema
  }

  it.each(['constructor', 'valueOf', '__proto__', 'toString'])(
    'reads and writes a QName in the namespace %s',
    (uri) => {
      const rule = parseXml(`<Rule xmlns:v="${uri}" Type="v:Line"/>`, undefined, { namespaces: true })['Rule']
      expect(decode(schema, 'Rule', rule as XmlObject)).toEqual({ Type: `{${uri}}Line` })
      expect(serialize(encodeRequest(createRule, { Type: `{${uri}}Line` }))).toBe(
        `<tds:CreateRule xmlns:tds="${tds}" xmlns:ns2="${uri}" Type="ns2:Line"/>`
      )
    }
  )
})

describe('prefixed', () => {
  const topics = 'http://www.onvif.org/ver10/topics'
  const schema: Schema = {
    Filter: { fields: [{ name: 'Dialect', type: 'string', attribute: true }], text: 'prefixed' },
    Request: { fields: [{ name: 'Filter', type: 'Filter', namespace: tt }] }
  }
  const setFilter: Operation<Record<string, unknown>, unknown> = {
    name: 'SetFilter',
    action: `${tds}/SetFilter`,
    request: { name: 'SetFilter', namespace: tds, type: 'Request' },
    response: { name: 'SetFilterResponse', type: 'Request' },
    schema
  }
  const filter = (xml: string, namespaces = true) => {
    const element = parseXml(xml, undefined, { namespaces })['Filter'] as XmlObject
    return (decode(schema, 'Filter', element) as { value: string }).value
  }

  it('reads every declared prefix as the standard prefix or {namespace}', () => {
    expect(
      filter(
        `<Filter xmlns:t="${topics}" xmlns:v="urn:example:vendor" Dialect="d">` +
          't:RuleEngine/CellMotionDetector/Motion|v:Zone//.|t:Device/*</Filter>'
      )
    ).toBe('tns1:RuleEngine/CellMotionDetector/Motion|{urn:example:vendor}Zone//.|tns1:Device/*')
    expect(
      filter(`<Filter xmlns:p="${tt}" Dialect="d">boolean(//p:SimpleItem[@Name="Token" and @Value="a:b"])</Filter>`)
    ).toBe('boolean(//tt:SimpleItem[@Name="Token" and @Value="a:b"])')
  })

  it('keeps undeclared prefixes and the text of a response parsed without namespaces', () => {
    expect(filter('<Filter Dialect="d">tns1:RuleEngine/x:Motion</Filter>')).toBe('tns1:RuleEngine/x:Motion')
    expect(filter(`<Filter xmlns:t="${topics}" Dialect="d">t:RuleEngine</Filter>`, false)).toBe('t:RuleEngine')
  })

  it('declares the namespace of every prefix it writes', () => {
    const value = 'tns1:RuleEngine/CellMotionDetector/Motion|{urn:example:vendor}Zone|{}Plain|tt:Device'
    expect(serialize(encodeRequest(setFilter, { Filter: { Dialect: 'd', value } }))).toBe(
      `<tds:SetFilter xmlns:tds="${tds}" xmlns:tt="${tt}" xmlns:tns1="${topics}" xmlns:ns4="urn:example:vendor">` +
        '<tt:Filter Dialect="d">tns1:RuleEngine/CellMotionDetector/Motion|ns4:Zone|Plain|tt:Device</tt:Filter>' +
        '</tds:SetFilter>'
    )
  })

  it('reads back what it writes', () => {
    const request = { Filter: { Dialect: 'd', value: 'tns1:RuleEngine//.|{urn:example:vendor}Zone' } }
    const element = parseXml(serialize(encodeRequest(setFilter, request)), undefined, { namespaces: true })
    expect(decode(schema, 'Request', element['SetFilter'] as XmlValue)).toEqual(request)
  })

  it('rejects an unknown prefix on encode', () => {
    expect(() => encodeRequest(setFilter, { Filter: { Dialect: 'd', value: 'v:Zone' } })).toThrow(
      'Unknown prefix v at SetFilter.Filter.value'
    )
  })
})
