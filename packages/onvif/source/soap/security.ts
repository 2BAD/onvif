import { createHash, randomBytes } from 'node:crypto'
import type { XmlElement } from './serialize.ts'

const WSSE = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd'
const WSU = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd'
const PASSWORD_DIGEST =
  'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest'
const BASE64_BINARY = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary'

export type Credentials = {
  username: string
  password: string
}

/**
 * Build a WS-Security UsernameToken header with a password digest (WS-Security UsernameToken Profile 1.0).
 *
 * @param credentials - Username and password
 * @param created - Timestamp in device time, i.e. local time corrected by the measured clock skew
 * @returns The `wsse:Security` header block
 */
export function usernameToken(credentials: Credentials, created: Date): XmlElement {
  const nonce = randomBytes(16)
  const timestamp = created.toISOString()
  const digest = createHash('sha1')
    .update(nonce)
    .update(timestamp, 'utf8')
    .update(credentials.password, 'utf8')
    .digest('base64')

  return {
    name: 'wsse:Security',
    attributes: { 's:mustUnderstand': '1', 'xmlns:wsse': WSSE, 'xmlns:wsu': WSU },
    children: [
      {
        name: 'wsse:UsernameToken',
        children: [
          { name: 'wsse:Username', children: [credentials.username] },
          { name: 'wsse:Password', attributes: { Type: PASSWORD_DIGEST }, children: [digest] },
          { name: 'wsse:Nonce', attributes: { EncodingType: BASE64_BINARY }, children: [nonce.toString('base64')] },
          { name: 'wsu:Created', children: [timestamp] }
        ]
      }
    ]
  }
}
