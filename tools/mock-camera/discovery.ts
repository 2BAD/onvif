import { createSocket, type RemoteInfo } from 'node:dgram'
import { once } from 'node:events'
import { setImmediate as nextTurn } from 'node:timers/promises'

export type ReceivedProbe = {
  messageId: string
  types: string
  xml: string
  from: RemoteInfo
}

export type MockResponderOptions = {
  /** Listen on 3702 and join the discovery multicast group on loopback instead of a random loopback port. */
  multicast?: boolean
  /** Datagrams sent back for a probe, one `probeMatches()` by default. */
  reply?: (probe: ReceivedProbe) => (string | Buffer)[]
}

export type MockResponder = {
  /** `127.0.0.1:<port>`, for the `hosts` option. */
  host: string
  probes: ReceivedProbe[]
  close: () => Promise<void>
}

export type MockMatch = {
  endpoint?: string
  /** Host of the XAddrs. */
  host?: string
}

const textOf = (xml: string, element: string): string =>
  new RegExp(`<(?:[\\w-]+:)?${element}>([^<]*)<`).exec(xml)?.[1] ?? ''

const probeMatch = ({ endpoint = 'urn:uuid:00000000-0000-4000-8000-000000000008', host = '127.0.0.1' }: MockMatch) =>
  `<d:ProbeMatch><a:EndpointReference><a:Address>${endpoint}</a:Address></a:EndpointReference>` +
  '<d:Types>dn:NetworkVideoTransmitter tds:Device</d:Types>' +
  '<d:Scopes>onvif://www.onvif.org/Profile/Streaming onvif://www.onvif.org/hardware/DCN-BM2220LPR onvif://www.onvif.org/name/DVC</d:Scopes>' +
  `<d:XAddrs>http://${host}:80/onvif/device_service http://[fe80::7]:80/onvif/device_service</d:XAddrs>` +
  '<d:MetadataVersion>10</d:MetadataVersion></d:ProbeMatch>'

/**
 * A ProbeMatches shaped like the DVC camera's, small enough for one datagram on any loopback. WSL drops UDP
 * datagrams to 127.0.0.1 that need fragmenting.
 *
 * @param messageId - Message id of the probe it answers
 * @param matches - One ProbeMatch per entry
 * @returns The reply
 */
export const probeMatches = (messageId: string, matches: MockMatch[] = [{}]): string =>
  '<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" ' +
  'xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" ' +
  'xmlns:dn="http://www.onvif.org/ver10/network/wsdl" xmlns:tds="http://www.onvif.org/ver10/device/wsdl">' +
  `<s:Header><a:MessageID>urn:uuid:00000000-0000-4000-8000-000000000008</a:MessageID><a:RelatesTo>${messageId}</a:RelatesTo>` +
  '<a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/ProbeMatches</a:Action></s:Header>' +
  `<s:Body><d:ProbeMatches>${matches.map(probeMatch).join('')}</d:ProbeMatches></s:Body></s:Envelope>`

/**
 * Answer WS-Discovery probes over UDP on loopback.
 *
 * @param options - Where to listen and what to answer
 * @returns The responder
 */
export async function startMockResponder(options: MockResponderOptions = {}): Promise<MockResponder> {
  const { multicast = false, reply = (probe) => [probeMatches(probe.messageId)] } = options
  const socket = createSocket({ type: 'udp4', reuseAddr: multicast })
  const probes: ReceivedProbe[] = []
  let closed = false
  socket.on('message', async (message, from) => {
    const xml = message.toString('utf8')
    const probe = { messageId: textOf(xml, 'MessageID'), types: textOf(xml, 'Types'), xml, from }
    probes.push(probe)
    for (const datagram of reply(probe)) {
      if (closed) return
      await new Promise((resolve) => {
        socket.send(datagram, from.port, from.address, resolve)
      })
      await nextTurn()
    }
  })
  socket.bind(multicast ? { port: 3702 } : { port: 0, address: '127.0.0.1' })
  await once(socket, 'listening')
  if (multicast) socket.addMembership('239.255.255.250', '127.0.0.1')
  return {
    host: `127.0.0.1:${socket.address().port}`,
    probes,
    close: async () => {
      closed = true
      socket.close()
      await once(socket, 'close')
    }
  }
}
