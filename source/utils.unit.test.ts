import { describe, expect, it, vi } from 'vitest'
import xml2js from 'xml2js'
import { guid, linerase, parseSOAPString } from './utils.ts'

describe('linerase', () => {
  it('should parse a simple object', () => {
    expect.assertions(1)
    const input = { name: 'John', age: '30' }
    const result = linerase(input)
    expect(result).toStrictEqual({ name: 'John', age: 30 })
  })

  it('should parse nested objects', () => {
    expect.assertions(1)
    const input = { person: { name: 'John', age: '30' } }
    const result = linerase(input)
    expect(result).toStrictEqual({ person: { name: 'John', age: 30 } })
  })

  it('should parse arrays', () => {
    expect.assertions(1)
    const input = { numbers: ['1', '2', '3'] }
    const result = linerase(input)
    expect(result).toStrictEqual({ numbers: [1, 2, 3] })
  })

  it('should parse boolean values', () => {
    expect.assertions(1)
    const input = { active: 'true', inactive: 'false' }
    const result = linerase(input)
    expect(result).toStrictEqual({ active: true, inactive: false })
  })

  it('should parse dates', () => {
    expect.assertions(2)
    const input = { date: '2023-04-01T12:00:00Z' }
    const result = linerase(input)
    expect(result.date).toBeInstanceOf(Date)
    expect(result.date.toISOString()).toBe('2023-04-01T12:00:00.000Z')
  })

  it('should handle XML attributes', () => {
    expect.assertions(1)
    const input = { $: { id: '123' }, name: 'John' }
    const result = linerase(input)
    expect(result).toStrictEqual({ id: 123, name: 'John' })
  })
})

describe('guid', () => {
  it('should generate a valid GUID', () => {
    expect.assertions(1)
    const result = guid()
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('should generate unique GUIDs', () => {
    expect.assertions(1)
    const guid1 = guid()
    const guid2 = guid()
    expect(guid1).not.toBe(guid2)
  })
})

describe('parseSOAPString', () => {
  it('should parse a valid SOAP response', async () => {
    expect.assertions(2)
    const mockXml = '<envelope><body><result>Success</result></body></envelope>'
    const mockParsedResult = { envelope: { body: [{ result: ['Success'] }] } }

    vi.spyOn(xml2js, 'parseStringPromise').mockResolvedValue(mockParsedResult)

    const [result, xml] = await parseSOAPString(mockXml)
    expect(result).toStrictEqual([{ result: ['Success'] }])
    expect(xml).toBe(mockXml.replace(/xmlns([^=]*?)=(".*?")/g, ''))
  })

  it('should throw an error for invalid SOAP response', async () => {
    expect.assertions(1)
    const mockXml = '<invalid>XML</invalid>'
    vi.spyOn(xml2js, 'parseStringPromise').mockResolvedValue({})

    await expect(parseSOAPString(mockXml)).rejects.toThrow('Wrong ONVIF SOAP response')
  })

  it('should throw an error for SOAP fault', async () => {
    expect.assertions(1)
    const mockXml = '<envelope><body><fault><reason><text>Error occurred</text></reason></fault></body></envelope>'
    const mockParsedResult = {
      envelope: {
        body: [
          {
            fault: [
              {
                reason: [{ text: [{ _: 'Error occurred' }] }]
              }
            ]
          }
        ]
      }
    }

    vi.spyOn(xml2js, 'parseStringPromise').mockResolvedValue(mockParsedResult)

    await expect(parseSOAPString(mockXml)).rejects.toThrow('ONVIF SOAP Fault: Error occurred')
  })
})
