import { createHash, randomBytes } from 'node:crypto'
import type { Credentials } from '../soap/security.ts'

export type DigestChallenge = {
  realm: string
  nonce: string
  algorithm: 'MD5' | 'SHA-256'
  qop: 'auth' | undefined
  opaque: string | undefined
  stale: boolean
}

const hashNames = { MD5: 'md5', 'SHA-256': 'sha256' } as const

const parseParameters = (challenge: string): Record<string, string> => {
  const parameters: Record<string, string> = {}
  for (const [, key, quoted, token] of challenge.matchAll(/([\w-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^,\s]*))/g)) {
    if (key) parameters[key.toLowerCase()] = quoted === undefined ? (token ?? '') : quoted.replace(/\\(.)/g, '$1')
  }
  return parameters
}

/**
 * Pick the strongest supported Digest challenge from `WWW-Authenticate` header values.
 *
 * @param headers - Every `WWW-Authenticate` value of the response
 * @returns The challenge, or undefined when no supported Digest challenge is offered
 */
export function parseChallenge(headers: string[]): DigestChallenge | undefined {
  const challenges = headers
    .flatMap((header) => header.split(/,?\s*(?=\b(?:Digest|Basic|Bearer|Negotiate|NTLM)\s)/i))
    .filter((challenge) => /^Digest\s/i.test(challenge.trim()))
    .map((challenge) => parseParameters(challenge.trim().slice(6)))
    .flatMap((parameters): DigestChallenge[] => {
      const algorithm = (parameters['algorithm'] ?? 'MD5').toUpperCase()
      const qops = parameters['qop']?.split(',').map((value) => value.trim().toLowerCase())
      const { realm, nonce } = parameters
      if ((algorithm !== 'MD5' && algorithm !== 'SHA-256') || realm === undefined || !nonce) return []
      if (qops !== undefined && !qops.includes('auth')) return []
      return [
        {
          realm,
          nonce,
          algorithm,
          qop: qops === undefined ? undefined : 'auth',
          opaque: parameters['opaque'],
          stale: parameters['stale']?.toLowerCase() === 'true'
        }
      ]
    })
  return challenges.find((challenge) => challenge.algorithm === 'SHA-256') ?? challenges[0]
}

const quote = (value: string): string => `"${value.replace(/["\\]/g, '\\$&')}"`

/**
 * Build the `Authorization` header answering a Digest challenge (RFC 7616).
 *
 * @param challenge - The server challenge
 * @param credentials - Username and password
 * @param method - HTTP method
 * @param uri - Request target (path and query)
 * @param count - Nonce count, starting at 1 for each new nonce
 * @returns The header value
 */
export function digestAuthorization(
  challenge: DigestChallenge,
  credentials: Credentials,
  method: string,
  uri: string,
  count: number
): string {
  const hash = (value: string) => createHash(hashNames[challenge.algorithm]).update(value, 'utf8').digest('hex')
  const ha1 = hash(`${credentials.username}:${challenge.realm}:${credentials.password}`)
  const ha2 = hash(`${method}:${uri}`)
  const parts = [
    `username=${quote(credentials.username)}`,
    `realm=${quote(challenge.realm)}`,
    `nonce=${quote(challenge.nonce)}`,
    `uri=${quote(uri)}`,
    `algorithm=${challenge.algorithm}`
  ]
  if (challenge.qop) {
    const nc = count.toString(16).padStart(8, '0')
    const cnonce = randomBytes(16).toString('hex')
    parts.push(
      `qop=${challenge.qop}`,
      `nc=${nc}`,
      `cnonce=${quote(cnonce)}`,
      `response=${quote(hash(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop}:${ha2}`))}`
    )
  } else {
    parts.push(`response=${quote(hash(`${ha1}:${challenge.nonce}:${ha2}`))}`)
  }
  if (challenge.opaque !== undefined) parts.push(`opaque=${quote(challenge.opaque)}`)
  return `Digest ${parts.join(', ')}`
}
