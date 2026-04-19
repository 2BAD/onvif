import { describe, expect, it } from 'vitest'
import { linerase } from './xml.ts'

describe('linerase coercion', () => {
  it('parses ISO-8601 UTC timestamps into Date', () => {
    expect(linerase('2023-04-01T12:00:00Z')).toBeInstanceOf(Date)
    expect(linerase('2023-04-01T12:00:00.123Z')).toBeInstanceOf(Date)
  })

  it('does not treat malformed timestamps as Date', () => {
    // Guards against the unescaped `.` in dateRe matching any single char.
    expect(linerase('2023-04-01T12:00:00xZ')).toBe('2023-04-01T12:00:00xZ')
  })

  it('parses plain integer and decimal strings as numbers', () => {
    expect(linerase('0')).toBe(0)
    expect(linerase('42')).toBe(42)
    expect(linerase('-17')).toBe(-17)
    expect(linerase('3.14')).toBeCloseTo(3.14)
  })

  it('leaves numeric-looking strings with leading zeros as strings', () => {
    // Leading-zero values (serial numbers, MACs, tokens) must not be coerced.
    expect(linerase('007')).toBe('007')
    expect(linerase('0123456789')).toBe('0123456789')
  })

  it('coerces the string "true" / "false" but leaves other casings alone', () => {
    expect(linerase('true')).toBe(true)
    expect(linerase('false')).toBe(false)
    expect(linerase('True')).toBe('True')
  })
})
