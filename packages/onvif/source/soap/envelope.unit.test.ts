import { describe, expect, it } from 'vitest'
import { fixture } from '../../../../tools/fixtures/corpus.ts'
import { AuthError, ParseError, SoapFaultError } from '#errors.ts'
import { buildEnvelope, parseEnvelope } from '#soap/envelope.ts'

const live = 'live/dvc/dcn-bm2220lpr'

const thrown = (action: () => unknown): unknown => {
  try {
    action()
  } catch (error) {
    return error
  }
  throw new Error('Expected an error')
}
const context = { host: '192.0.2.14', service: 'device', action: 'GetDeviceInformation' }

const soap12Fault = (subcodes: string[], reason: string): string =>
  '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><s:Fault>' +
  '<s:Code><s:Value>s:Sender</s:Value>' +
  subcodes.map((code) => `<s:Subcode><s:Value>${code}</s:Value>`).join('') +
  '</s:Subcode>'.repeat(subcodes.length) +
  `</s:Code><s:Reason><s:Text xml:lang="en">${reason}</s:Text></s:Reason></s:Fault></s:Body></s:Envelope>`

describe('buildEnvelope', () => {
  it('wraps the body and header blocks in a SOAP 1.2 envelope', () => {
    const xml = buildEnvelope({ name: 'GetScopes', attributes: { xmlns: 'urn:device' } }, [{ name: 'h:Token' }])
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">' +
        '<s:Header><h:Token/></s:Header><s:Body><GetScopes xmlns="urn:device"/></s:Body></s:Envelope>'
    )
  })

  it('leaves out an empty header', () => {
    expect(buildEnvelope({ name: 'GetScopes' })).not.toContain('Header')
  })
})

describe('parseEnvelope', () => {
  it('returns header and body of a captured response', () => {
    const { header, body } = parseEnvelope(fixture(`${live}/device.GetDeviceInformation.xml`).xml)
    expect(header).toBeUndefined()
    expect(body).toMatchObject({ GetDeviceInformationResponse: { Manufacturer: 'DVC', Model: 'DCN-BM2220LPR' } })
    expect(parseEnvelope(fixture(`${live}/events.PullMessages.xml`).xml).header).toMatchObject({
      Action: { _: 'http://www.onvif.org/ver10/events/wsdl/PullPointSubscription/PullMessagesResponse' }
    })
  })

  it('returns an empty body for an empty Body element', () => {
    expect(parseEnvelope('<Envelope><Body/></Envelope>')).toEqual({ header: undefined, body: {} })
  })

  it('raises a captured SOAP 1.2 fault with code and subcodes', () => {
    const xml = fixture(`${live}/device.UnknownActionFault.xml`).xml
    const error = thrown(() => parseEnvelope(xml, context))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ code: 'Sender', host: '192.0.2.14', action: 'GetDeviceInformation' })
  })

  it('reads nested subcodes', () => {
    const error = thrown(() => parseEnvelope(soap12Fault(['ter:InvalidArgVal', 'ter:NoProfile'], 'no such profile')))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ code: 'Sender', subcodes: ['InvalidArgVal', 'NoProfile'], reason: 'no such profile' })
  })

  it.each([['ter:NotAuthorized'], ['wsse:FailedAuthentication'], ['wsse:InvalidSecurity']])(
    'raises %s as an AuthError',
    (subcode) => {
      expect(() => parseEnvelope(soap12Fault([subcode], 'Sender not Authorized'), context)).toThrow(AuthError)
    }
  )

  it('bounds fault codes and reasons from the device', () => {
    const error = thrown(() => parseEnvelope(soap12Fault([`ter:${'c'.repeat(100_000)}`], 'r'.repeat(100_000))))
    expect(error).toBeInstanceOf(SoapFaultError)
    const { message, reason, subcodes } = error as SoapFaultError
    expect(reason).toHaveLength(512)
    expect(subcodes[0]).toHaveLength(64)
    expect(message.length).toBeLessThan(700)
    const soap11 = thrown(() =>
      parseEnvelope(
        `<Envelope><Body><Fault><faultcode>${'c'.repeat(100_000)}</faultcode><faultstring>${'r'.repeat(100_000)}</faultstring></Fault></Body></Envelope>`
      )
    )
    expect((soap11 as SoapFaultError).message.length).toBeLessThan(700)
  })

  it('reads SOAP 1.1 faults', () => {
    const xml =
      '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault>' +
      '<faultcode>SOAP-ENV:Client</faultcode><faultstring>bad request</faultstring></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>'
    expect(() => parseEnvelope(xml)).toThrow('SOAP fault Client: bad request')
  })

  it('raises ParseError with context for malformed XML', () => {
    const error = thrown(() => parseEnvelope('<Envelope><Body>', context))
    expect(error).toBeInstanceOf(ParseError)
    expect(error).toMatchObject({ host: '192.0.2.14', reason: "Unclosed element 'Body'" })
  })

  it('raises ParseError when the document is not an envelope', () => {
    expect(() => parseEnvelope('<html><body/></html>')).toThrow('Not a SOAP envelope')
  })

  it('applies parser limits', () => {
    expect(() => parseEnvelope(fixture(`${live}/media.GetProfiles.xml`).xml, {}, { maxNodes: 10 })).toThrow(ParseError)
  })
})
