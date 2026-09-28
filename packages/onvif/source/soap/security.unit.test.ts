import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseXml, type XmlObject } from './parse.ts'
import { usernameToken } from './security.ts'
import { serialize } from './serialize.ts'

const tokenOf = (xml: string) => (parseXml(xml)['Security'] as XmlObject)['UsernameToken'] as XmlObject
const textOf = (value: unknown): string => (value as XmlObject)['_'] as string

describe('usernameToken', () => {
  const created = new Date('2026-09-28T03:37:03.250Z')

  it('computes the password digest over nonce, created and password as UTF-8', () => {
    const token = tokenOf(serialize(usernameToken({ username: 'admin', password: 'pässwörd' }, created)))
    const nonce = Buffer.from(textOf(token['Nonce']), 'base64')
    const expected = createHash('sha1')
      .update(Buffer.concat([nonce, Buffer.from(created.toISOString()), Buffer.from('pässwörd', 'utf8')]))
      .digest('base64')
    expect(token['Username']).toBe('admin')
    expect(token['Created']).toBe('2026-09-28T03:37:03.250Z')
    expect(textOf(token['Password'])).toBe(expected)
  })

  it('uses a fresh 16 byte nonce every time', () => {
    const nonces = new Set(
      Array.from({ length: 100 }, () =>
        textOf(tokenOf(serialize(usernameToken({ username: 'a', password: 'b' }, created)))['Nonce'])
      )
    )
    expect(nonces.size).toBe(100)
    expect(Buffer.from([...nonces][0] ?? '', 'base64')).toHaveLength(16)
  })

  it('escapes the username', () => {
    const token = tokenOf(serialize(usernameToken({ username: '</Username><x>', password: 'p' }, created)))
    expect(token['Username']).toBe('</Username><x>')
  })

  it('does not include the plain password', () => {
    expect(serialize(usernameToken({ username: 'admin', password: 'secret-value' }, created))).not.toContain(
      'secret-value'
    )
  })
})
