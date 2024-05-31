import { describe, expect, it } from 'vitest'
import { message } from './index.ts'

describe('index', () => {
  it('phrase', () => {
    expect.assertions(2)

    expect(message).toBeTypeOf('string')
    expect(message.length).toBeGreaterThan(0)
  })
})
