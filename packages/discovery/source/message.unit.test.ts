import { DecodeError, OnvifError, ParseError, parseEnvelope, SoapFaultError } from '@2bad/onvif'
import { describe, expect, it } from 'vitest'
import { fixture } from '../../../tools/fixtures/corpus.ts'
import { buildProbe, readProbeMatches } from '#message.ts'

const NETWORK = 'http://www.onvif.org/ver10/network/wsdl'
const DEVICE = 'http://www.onvif.org/ver10/device/wsdl'
const probeId = 'urn:uuid:3c0b0a62-4b5e-4f0c-9a43-8f6c2f2b1d11'
const probes = new Set([probeId])

const dvcReply = (): string =>
  fixture('live/dvc/dcn-bm2220lpr/discovery.ProbeMatches.xml').xml.replace(/(<wsa:RelatesTo>)[^<]*/, `$1${probeId}`)

const reply = (matches: string, relatesTo = probeId, declarations = ''): string =>
  '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" ' +
  'xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" ' +
  `xmlns:dn="${NETWORK}" xmlns:tds="${DEVICE}"${declarations}>` +
  `<s:Header><a:RelatesTo>${relatesTo}</a:RelatesTo></s:Header>` +
  `<s:Body><d:ProbeMatches>${matches}</d:ProbeMatches></s:Body></s:Envelope>`

const match = (fields: { endpoint?: string; types?: string; scopes?: string; xaddrs?: string } = {}): string => {
  const { endpoint = 'urn:uuid:1', types = 'dn:NetworkVideoTransmitter', scopes, xaddrs } = fields
  return (
    '<d:ProbeMatch>' +
    (endpoint === '' ? '' : `<a:EndpointReference><a:Address>${endpoint}</a:Address></a:EndpointReference>`) +
    (types === '' ? '' : `<d:Types>${types}</d:Types>`) +
    (scopes === undefined ? '' : `<d:Scopes>${scopes}</d:Scopes>`) +
    (xaddrs === undefined ? '' : `<d:XAddrs>${xaddrs}</d:XAddrs>`) +
    '<d:MetadataVersion>1</d:MetadataVersion></d:ProbeMatch>'
  )
}

describe('buildProbe', () => {
  it('builds a probe for network video transmitters with the type prefix declared on the envelope', () => {
    const probe = buildProbe('NetworkVideoTransmitter')
    expect(probe.messageId).toMatch(/^urn:uuid:[0-9a-f-]{36}$/)
    expect(probe.xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?><s:Envelope [^>]*xmlns:dn="[^"]+"/)
    const { header, body } = parseEnvelope(probe.xml)
    expect(header).toMatchObject({
      MessageID: probe.messageId,
      To: 'urn:schemas-xmlsoap-org:ws:2005:04:discovery',
      Action: 'http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe'
    })
    expect(body['Probe']).toEqual({ Types: 'dn:NetworkVideoTransmitter', Scopes: '' })
  })

  it('builds a probe for any ONVIF device with a new message id', () => {
    const first = buildProbe('Device')
    expect(parseEnvelope(first.xml).body['Probe']).toEqual({ Types: 'tds:Device', Scopes: '' })
    expect(buildProbe('Device').messageId).not.toBe(first.messageId)
  })
})

describe('readProbeMatches', () => {
  it('reads the DVC camera reply and drops its link-local IPv6 address', () => {
    const { devices, errors } = readProbeMatches(dvcReply(), '192.0.2.14', probes, 'sender')
    expect(errors).toEqual([])
    expect(devices).toEqual([
      {
        endpoint: 'urn:uuid:00000000-0000-4000-8000-000000000008',
        address: '192.0.2.14',
        xaddrs: [new URL('http://192.0.2.14/onvif/device_service')],
        droppedXAddrs: ['http://[fe80::7]:80/onvif/device_service'],
        types: [
          { namespace: NETWORK, name: 'NetworkVideoTransmitter' },
          { namespace: DEVICE, name: 'Device' }
        ],
        scopes: expect.arrayContaining(['onvif://www.onvif.org/Profile/T', 'onvif://www.onvif.org/location/']),
        name: 'DVC',
        hardware: 'DCN-BM2220LPR',
        profiles: ['Streaming', 'T', 'G']
      }
    ])
  })

  it('keeps addresses on other hosts when the policy is any', () => {
    const { devices } = readProbeMatches(dvcReply(), '192.0.2.99', probes, 'any')
    expect(devices[0]?.xaddrs.map(String)).toEqual([
      'http://192.0.2.14/onvif/device_service',
      'http://[fe80::7]/onvif/device_service'
    ])
    expect(devices[0]?.droppedXAddrs).toEqual([])
  })

  it('drops every address of a reply that points to another host', () => {
    const { devices } = readProbeMatches(dvcReply(), '192.0.2.99', probes, 'sender')
    expect(devices[0]?.xaddrs).toEqual([])
    expect(devices[0]?.droppedXAddrs).toHaveLength(2)
  })

  it('reads the upstream mock reply with a uuid: endpoint, ReplyTo and AppSequence', () => {
    const xml = fixture('upstream/Probe.xml').xml.replace('RELATES_TO', probeId)
    const { devices } = readProbeMatches(xml, '192.0.2.1', probes, 'sender')
    expect(devices).toMatchObject([
      {
        endpoint: 'uuid:c9790c3a-701b-464d-a189-0060351c8ada',
        xaddrs: [new URL('http://192.0.2.1/onvif/device_service')],
        name: 'PREDATOR',
        hardware: 'HD_PREDATOR',
        profiles: ['Streaming']
      }
    ])
  })

  it('keeps HTTPS and other ports on the sender and drops link-local, other hosts and non-HTTP addresses', () => {
    const xaddrs = [
      'http://169.254.10.20/onvif/device_service',
      'http://192.0.2.5:10080/onvif/device_service',
      'https://192.0.2.5/onvif/device_service',
      'http://192.0.2.6/onvif/device_service',
      'ftp://192.0.2.5/x',
      'not-a-url',
      'http://[fe80::1]/onvif/device_service'
    ]
    const { devices } = readProbeMatches(reply(match({ xaddrs: xaddrs.join('\n\t ') })), '192.0.2.5', probes, 'sender')
    expect(devices[0]?.xaddrs.map(String)).toEqual([
      'http://192.0.2.5:10080/onvif/device_service',
      'https://192.0.2.5/onvif/device_service'
    ])
    expect(devices[0]?.droppedXAddrs).toEqual([xaddrs[0], xaddrs[3], xaddrs[4], xaddrs[5], xaddrs[6]])
  })

  it('reports a device without XAddrs with an empty list', () => {
    const { devices } = readProbeMatches(reply(match()), '192.0.2.5', probes, 'sender')
    expect(devices[0]).toMatchObject({ xaddrs: [], droppedXAddrs: [], scopes: [], profiles: [] })
    expect(devices[0]?.name).toBeUndefined()
  })

  it('reads every match of a reply that lists several, such as an NVR', () => {
    const matches = match({ endpoint: 'urn:uuid:1' }) + match({ endpoint: 'urn:uuid:2', types: 'tds:Device' })
    const { devices } = readProbeMatches(reply(matches), '192.0.2.5', probes, 'sender')
    expect(devices.map((device) => device.endpoint)).toEqual(['urn:uuid:1', 'urn:uuid:2'])
  })

  it('reports a match without an endpoint address and still returns the others', () => {
    const matches = match({ endpoint: '' }) + match({ endpoint: 'urn:uuid:2' })
    const { devices, errors } = readProbeMatches(reply(matches), '192.0.2.5', probes, 'sender')
    expect(devices.map((device) => device.endpoint)).toEqual(['urn:uuid:2'])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(DecodeError)
    expect(errors[0]).toMatchObject({
      path: 'ProbeMatches/ProbeMatch[0]/EndpointReference/Address',
      host: '192.0.2.5',
      service: 'discovery'
    })
  })

  it('leaves out printers, computers and types whose prefix is not declared', () => {
    const declarations = ' xmlns:wprt="http://schemas.microsoft.com/windows/2006/08/wdp/print"'
    const matches =
      match({ endpoint: 'urn:uuid:printer', types: 'wprt:PrintDeviceType' }) +
      match({ endpoint: 'urn:uuid:undeclared', types: 'x:NetworkVideoTransmitter' }) +
      match({ endpoint: 'urn:uuid:untyped', types: '' })
    const { devices } = readProbeMatches(reply(matches, probeId, declarations), '192.0.2.5', probes, 'sender')
    expect(devices.map((device) => device.endpoint)).toEqual(['urn:uuid:untyped'])
  })

  it('resolves types in the default namespace', () => {
    const matches = `<d:ProbeMatch><a:EndpointReference><a:Address>urn:uuid:1</a:Address></a:EndpointReference><d:Types xmlns="${DEVICE}">Device</d:Types></d:ProbeMatch>`
    const { devices } = readProbeMatches(reply(matches), '192.0.2.5', probes, 'sender')
    expect(devices[0]?.types).toEqual([{ namespace: DEVICE, name: 'Device' }])
  })

  it('decodes percent-encoded scopes and keeps invalid encodings as they are', () => {
    const scopes = [
      'onvif://www.onvif.org/name/AXIS%20M1065-L',
      'onvif://www.onvif.org/hardware/bad%E0%A4%A',
      'ONVIF://www.onvif.org/profile/S',
      'onvif://www.onvif.org/Profile/',
      'onvif://www.onvif.org/name/second'
    ].join(' ')
    const { devices } = readProbeMatches(reply(match({ scopes })), '192.0.2.5', probes, 'sender')
    expect(devices[0]).toMatchObject({ name: 'AXIS M1065-L', hardware: 'bad%E0%A4%A', profiles: ['S'] })
  })

  it('accepts a SOAP 1.1 envelope', () => {
    const xml = reply(match()).replaceAll(
      'http://www.w3.org/2003/05/soap-envelope',
      'http://schemas.xmlsoap.org/soap/envelope/'
    )
    expect(readProbeMatches(xml, '192.0.2.5', probes, 'sender').devices).toHaveLength(1)
  })

  it('rejects a reply to another probe', () => {
    const read = () => readProbeMatches(reply(match(), 'urn:uuid:other'), '192.0.2.5', probes, 'sender')
    expect(read).toThrow(OnvifError)
    expect(read).toThrow('Reply does not answer this probe')
  })

  it('rejects a reply without RelatesTo', () => {
    const xml = reply(match()).replace(/<s:Header>.*<\/s:Header>/, '')
    expect(() => readProbeMatches(xml, '192.0.2.5', probes, 'sender')).toThrow('Reply does not answer this probe')
  })

  it('rejects a Hello and a ProbeMatches in another namespace', () => {
    const hello = reply(match()).replace(/ProbeMatches>/g, 'Hello>')
    expect(() => readProbeMatches(hello, '192.0.2.5', probes, 'sender')).toThrow('not a WS-Discovery ProbeMatches')
    const foreign = reply(match()).replace('http://schemas.xmlsoap.org/ws/2005/04/discovery', 'urn:other')
    expect(() => readProbeMatches(foreign, '192.0.2.5', probes, 'sender')).toThrow('not a WS-Discovery ProbeMatches')
  })

  it('raises faults, malformed XML and DOCTYPE with the sender', () => {
    const fault =
      '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><s:Fault><s:Code><s:Value>s:Sender</s:Value></s:Code>' +
      '<s:Reason><s:Text>no</s:Text></s:Reason></s:Fault></s:Body></s:Envelope>'
    expect(() => readProbeMatches(fault, '192.0.2.5', probes, 'sender')).toThrow(SoapFaultError)
    expect(() => readProbeMatches('<s:Envelope', '192.0.2.5', probes, 'sender')).toThrow(ParseError)
    const doctype = `<!DOCTYPE a [<!ENTITY x "x">]>${reply(match())}`
    expect(() => readProbeMatches(doctype, '192.0.2.5', probes, 'sender')).toThrow(
      expect.objectContaining({ name: 'ParseError', host: '192.0.2.5', action: 'ProbeMatches' })
    )
  })
})
