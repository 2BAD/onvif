import { randomUUID } from 'node:crypto'
import type { XmlElement } from '#soap/serialize.ts'

const WSA = 'http://www.w3.org/2005/08/addressing'

/**
 * Build WS-Addressing 1.0 header blocks for a request.
 *
 * @param action - Action URI of the operation
 * @param to - Address the message is sent to
 * @returns `wsa:MessageID`, `wsa:To` and `wsa:Action` header blocks
 */
export function addressingHeaders(action: string, to: string): XmlElement[] {
  const attributes = { 'xmlns:wsa': WSA }
  return [
    { name: 'wsa:MessageID', attributes, children: [`urn:uuid:${randomUUID()}`] },
    { name: 'wsa:To', attributes: { ...attributes, 's:mustUnderstand': '1' }, children: [to] },
    { name: 'wsa:Action', attributes: { ...attributes, 's:mustUnderstand': '1' }, children: [action] }
  ]
}
