import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { digestAuthorization, parseChallenge } from './digest.ts'

const fieldsOf = (header: string): Record<string, string> =>
  Object.fromEntries(
    [...header.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)].map(([, key, quoted, token]) => [key, quoted ?? token])
  )

describe('parseChallenge', () => {
  it('reads the challenge of the DVC camera', () => {
    expect(
      parseChallenge(['Digest realm="Digest", qop="auth,auth-int", nonce="6ab9e2cdca560fae5b55", opaque="74b6460b"'])
    ).toEqual({
      realm: 'Digest',
      nonce: '6ab9e2cdca560fae5b55',
      algorithm: 'MD5',
      qop: 'auth',
      opaque: '74b6460b',
      stale: false
    })
  })

  it('prefers SHA-256 over MD5 across headers and within one header', () => {
    const md5 = 'Digest realm="r", nonce="n1", qop="auth", algorithm=MD5'
    const sha = 'Digest realm="r", nonce="n2", qop="auth", algorithm=SHA-256'
    expect(parseChallenge([md5, sha])?.nonce).toBe('n2')
    expect(parseChallenge([`${md5}, ${sha}`])?.nonce).toBe('n2')
  })

  it('skips Basic, unsupported algorithms and qop without auth', () => {
    expect(parseChallenge(['Basic realm="r"'])).toBeUndefined()
    expect(parseChallenge(['Digest realm="r", nonce="n", algorithm=MD5-sess'])).toBeUndefined()
    expect(parseChallenge(['Digest realm="r", nonce="n", qop="auth-int"'])).toBeUndefined()
    expect(parseChallenge(['Digest realm="r"'])).toBeUndefined()
    expect(parseChallenge([])).toBeUndefined()
  })

  it('reads stale and escaped quotes', () => {
    expect(parseChallenge(['Digest realm="a \\"b\\"", nonce="n", stale=TRUE'])).toMatchObject({
      realm: 'a "b"',
      stale: true,
      qop: undefined
    })
  })
})

describe('digestAuthorization', () => {
  const credentials = { username: 'Mufasa', password: 'Circle of Life' }

  it.each([
    ['MD5', 'md5'],
    ['SHA-256', 'sha256']
  ] as const)('answers a %s challenge with qop=auth (RFC 7616)', (algorithm, hashName) => {
    const challenge = {
      realm: 'http-auth@example.org',
      nonce: 'abc',
      algorithm,
      qop: 'auth',
      opaque: 'xyz',
      stale: false
    } as const
    const fields = fieldsOf(digestAuthorization(challenge, credentials, 'GET', '/dir/index.html', 1))
    const hash = (value: string) => createHash(hashName).update(value).digest('hex')
    const ha1 = hash('Mufasa:http-auth@example.org:Circle of Life')
    const ha2 = hash('GET:/dir/index.html')
    expect(fields).toMatchObject({ username: 'Mufasa', nc: '00000001', qop: 'auth', opaque: 'xyz', algorithm })
    expect(fields['response']).toBe(hash(`${ha1}:abc:00000001:${fields['cnonce']}:auth:${ha2}`))
  })

  it('answers a challenge without qop (RFC 2069)', () => {
    const challenge = {
      realm: 'r',
      nonce: 'n',
      algorithm: 'MD5',
      qop: undefined,
      opaque: undefined,
      stale: false
    } as const
    const header = digestAuthorization(challenge, credentials, 'POST', '/onvif/device_service', 1)
    const md5 = (value: string) => createHash('md5').update(value).digest('hex')
    expect(fieldsOf(header)['response']).toBe(
      md5(`${md5('Mufasa:r:Circle of Life')}:n:${md5('POST:/onvif/device_service')}`)
    )
    expect(header).not.toContain('cnonce')
  })

  it('escapes quotes in the username', () => {
    const challenge = {
      realm: 'r',
      nonce: 'n',
      algorithm: 'MD5',
      qop: 'auth',
      opaque: undefined,
      stale: false
    } as const
    expect(digestAuthorization(challenge, { username: 'a"b\\c', password: 'p' }, 'POST', '/', 2)).toContain(
      'username="a\\"b\\\\c"'
    )
  })
})
