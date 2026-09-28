import { describe, expect, it } from 'vitest'
import { OnvifError } from '#errors.ts'
import { parseXml } from '#soap/parse.ts'
import { escapeAttribute, escapeText, serialize } from '#soap/serialize.ts'

describe('serialize', () => {
  it('writes elements, attributes and text', () => {
    const xml = serialize({
      name: 'tds:SetHostname',
      attributes: { 'xmlns:tds': 'http://www.onvif.org/ver10/device/wsdl' },
      children: [{ name: 'tds:Name', children: ['camera-1'] }, { name: 'tds:Empty' }]
    })
    expect(xml).toBe(
      '<tds:SetHostname xmlns:tds="http://www.onvif.org/ver10/device/wsdl">' +
        '<tds:Name>camera-1</tds:Name><tds:Empty/></tds:SetHostname>'
    )
  })

  it('escapes markup in text and attributes so values cannot inject elements', () => {
    const hostile = `</Username><Password>x</Password><a b="'&`
    const xml = serialize({ name: 'Username', attributes: { note: hostile }, children: [hostile] })
    expect(parseXml(xml)).toEqual({ Username: { $: { note: hostile }, _: hostile } })
  })

  it('keeps whitespace in attribute values through a parse', () => {
    const value = ' a\tb\nc\r '
    expect(parseXml(serialize({ name: 'a', attributes: { v: value } }))).toEqual({ a: { $: { v: value } } })
  })

  it('escapes carriage returns in text', () => {
    expect(escapeText('a\r\nb')).toBe('a&#13;\nb')
  })

  it('accepts characters outside the basic plane', () => {
    expect(escapeAttribute('\u{1F600}')).toBe('\u{1F600}')
  })

  it.each([
    ['NUL', String.fromCharCode(0)],
    ['a control character', String.fromCharCode(0x1b)],
    ['an unpaired surrogate', String.fromCharCode(0xd800)],
    ['U+FFFE', String.fromCharCode(0xfffe)]
  ])('rejects %s', (_name, value) => {
    expect(() => serialize({ name: 'a', children: [value] })).toThrow(OnvifError)
    expect(() => serialize({ name: 'a', attributes: { v: value } })).toThrow(/cannot represent/)
  })
})
