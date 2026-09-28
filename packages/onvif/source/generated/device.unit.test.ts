import { describe, expect, it } from 'vitest'
import { corpus } from '../../../../tools/fixtures/corpus.ts'
import { decode } from '../soap/codec.ts'
import { parseEnvelope } from '../soap/envelope.ts'
import * as device from './device.ts'

const operations = [
  device.GetSystemDateAndTime,
  device.GetServices,
  device.GetServiceCapabilities,
  device.GetCapabilities,
  device.GetDeviceInformation,
  device.GetScopes,
  device.GetHostname,
  device.GetNetworkInterfaces,
  device.SystemReboot
]

const fixtures = corpus.flatMap((entry) => {
  const match = /^(?:live\/.+\/device\.|upstream\/(?:device\.)?)(\w+)\.xml$/.exec(entry.name)
  const operation = operations.find((candidate) => candidate.name === match?.[1])
  return operation ? [{ name: entry.name, xml: entry.xml, operation }] : []
})

describe('generated device operations', () => {
  it('cover a fixture for every operation', () => {
    expect(new Set(fixtures.map(({ operation }) => operation.name))).toEqual(
      new Set(operations.map(({ name }) => name))
    )
  })

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))('decode %s', (_name, { xml, operation }) => {
    const { body } = parseEnvelope(xml)
    const response = body[operation.response.name]
    expect(response).toBeDefined()
    expect(() => decode(operation.schema, operation.response.type, response ?? '')).not.toThrow()
  })

  it('decode the captured device information into typed values', () => {
    const fixture = fixtures.find(({ name }) => name === 'live/dvc/dcn-bm2220lpr/device.GetSystemDateAndTime.xml')
    const { body } = parseEnvelope(fixture?.xml ?? '')
    const result = decode(
      device.schema,
      'GetSystemDateAndTimeResponse',
      body['GetSystemDateAndTimeResponse'] ?? ''
    ) as device.GetSystemDateAndTimeResponse
    expect(result.SystemDateAndTime.DaylightSavings).toBe(false)
    expect(result.SystemDateAndTime.UTCDateTime?.Date.Year).toBeTypeOf('number')
  })
})
