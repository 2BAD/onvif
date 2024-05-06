import { describe, expect, it } from 'vitest'

describe('index', () => {
  it('phrase', () => {
    expect.assertions(2)
    const quote = 'Hello, World!'

    expect(quote).toBeTypeOf('string')
    expect(quote.length).toBeGreaterThan(0)
  })
})
