import { describe, expect, it } from 'vitest'
import { OnvifError } from '#errors.ts'
import { addressingHeaders, type EndpointReference, referenceParameterHeaders } from '#soap/addressing.ts'
import { type Schema, decode } from '#soap/codec.ts'
import { parseXml, type XmlObject } from '#soap/parse.ts'
import { serialize } from '#soap/serialize.ts'

const wsa = 'http://www.w3.org/2005/08/addressing'

const schema: Schema = {
  EndpointReferenceType: {
    fields: [
      { name: 'Address', property: 'address', type: 'AttributedURIType', namespace: wsa },
      {
        name: 'ReferenceParameters',
        property: 'referenceParameters',
        type: 'ReferenceParametersType',
        namespace: wsa,
        optional: true
      }
    ],
    any: true
  },
  AttributedURIType: { fields: [], text: 'string' },
  ReferenceParametersType: { fields: [], any: true }
}

const reference = (parameters: string, namespaces = true): EndpointReference => {
  const xml =
    `<tev:SubscriptionReference xmlns:tev="urn:tev" xmlns:wsa5="${wsa}" xmlns:dom0="http://www.axis.com/2009/event">` +
    `<wsa5:Address>http://camera/onvif/services</wsa5:Address>` +
    `<wsa5:ReferenceParameters>${parameters}</wsa5:ReferenceParameters></tev:SubscriptionReference>`
  const element = parseXml(xml, undefined, { namespaces })['SubscriptionReference'] as XmlObject
  return decode(schema, 'EndpointReferenceType', element) as EndpointReference
}

describe('addressingHeaders', () => {
  it('sends a message id, the address and the action', () => {
    const [id, to, action] = addressingHeaders('urn:action', 'http://camera/sub?x=1').map((header) => serialize(header))
    expect(id).toMatch(/^<wsa:MessageID xmlns:wsa="[^"]+">urn:uuid:[0-9a-f-]{36}<\/wsa:MessageID>$/)
    expect(to).toContain('s:mustUnderstand="1">http://camera/sub?x=1</wsa:To>')
    expect(action).toContain('>urn:action</wsa:Action>')
  })
})

describe('referenceParameterHeaders', () => {
  it('echoes an Axis subscription id with its namespace as a reference parameter header', () => {
    const headers = referenceParameterHeaders(reference('<dom0:SubscriptionId>42</dom0:SubscriptionId>'))
    expect(headers.map((header) => serialize(header))).toEqual([
      `<rp0:SubscriptionId xmlns:wsa="${wsa}" wsa:IsReferenceParameter="true" ` +
        'xmlns:rp0="http://www.axis.com/2009/event">42</rp0:SubscriptionId>'
    ])
  })

  it('copies nested elements, attributes, repeats and unqualified names of any vendor', () => {
    const headers = referenceParameters(
      '<v:Session xmlns:v="urn:vendor" v:kind="pull" plain="1" xml:lang="en">' +
        '<v:Id>7</v:Id><Local>x</Local><v:Id>8</v:Id></v:Session><v:Session xmlns:v="urn:vendor">2</v:Session>'
    )
    expect(headers).toEqual([
      `<rp0:Session xmlns:wsa="${wsa}" wsa:IsReferenceParameter="true" xmlns:rp0="urn:vendor" rp0:kind="pull" ` +
        'plain="1" xml:lang="en"><rp0:Id>7</rp0:Id><rp0:Id>8</rp0:Id><Local>x</Local></rp0:Session>',
      `<rp0:Session xmlns:wsa="${wsa}" wsa:IsReferenceParameter="true" xmlns:rp0="urn:vendor">2</rp0:Session>`
    ])
  })

  it('escapes echoed values so a device cannot add elements to the request', () => {
    const [header] = referenceParameters('<dom0:SubscriptionId a="&quot;/&gt;">&lt;x/&gt;</dom0:SubscriptionId>')
    expect(header).toContain('a="&quot;/&gt;">&lt;x/&gt;</rp0:SubscriptionId>')
  })

  it('sends nothing without reference parameters', () => {
    expect(referenceParameterHeaders({ address: { value: 'http://camera/' } })).toEqual([])
  })

  it('refuses references parsed without namespaces or with undeclared prefixes', () => {
    expect(() => referenceParameterHeaders(reference('<dom0:SubscriptionId>1</dom0:SubscriptionId>', false))).toThrow(
      OnvifError
    )
    expect(() => referenceParameterHeaders(reference('<dom0:Id u:x="1">1</dom0:Id>'))).toThrow(
      'Reference parameter attribute x has an undeclared prefix'
    )
    expect(() => referenceParameterHeaders(reference(`<dom0:Id u:${'x'.repeat(100_000)}="1">1</dom0:Id>`))).toThrow(
      /^.{1,200}$/
    )
  })
})

function referenceParameters(parameters: string): string[] {
  return referenceParameterHeaders(reference(parameters)).map((header) => serialize(header))
}
