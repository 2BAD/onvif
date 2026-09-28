import { describe, expect, it } from 'vitest'
import { DecodeError, OnvifError } from '#errors.ts'
import { type Operation, type Schema, decode, encodeRequest } from '#soap/codec.ts'
import { XML_NAMESPACE } from '#soap/namespaces.ts'
import { parseXml, type XmlObject } from '#soap/parse.ts'
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

  it.each([
    ['a missing required element', '<Sample token="t"/>', 'Missing required element Name at Sample'],
    ['a missing required attribute', '<Sample><Name>a</Name></Sample>', 'Missing required attribute token at Sample'],
    [
      'an invalid integer',
      '<Sample token="t"><Name>a</Name><Count>1.5</Count></Sample>',
      "Invalid integer '1.5' at Sample.Count"
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

  it('escapes values so they cannot add elements', () => {
    const element = encodeRequest(operation, {
      Sample: { token: 't', Name: '</tt:Name><tt:Count>9</tt:Count><tt:Name>' }
    })
    expect(parseXml(serialize(element))).toMatchObject({
      SetSample: { Sample: { Name: '</tt:Name><tt:Count>9</tt:Count><tt:Name>' } }
    })
  })
})
