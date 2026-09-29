import { expect, test } from 'vitest'
import { GetProfiles } from '#onvif-media/generated/media.ts'
import { decode } from '#onvif/soap/codec.ts'
import { parseEnvelope } from '#onvif/soap/envelope.ts'
import { parseXml as fxp } from '#tools/bench/fxp.ts'
import { workloads } from '#tools/bench/workloads.ts'

const context = { host: 'bench', service: 'trt', action: 'GetProfiles' }

const decodeResponse = (xml: string) => {
  const { body } = parseEnvelope(xml, context)
  return decode(GetProfiles.schema, GetProfiles.response.type, body[GetProfiles.response.name] ?? '', context) as {
    profiles?: unknown[]
  }
}

const cases = [
  { name: 'dvc capture (3 profiles)', xml: workloads.large },
  { name: 'nvr (96 profiles)', xml: workloads.nvrProfiles }
]

test.for(cases)('GetProfiles $name', async ({ xml }, { bench }) => {
  expect(decodeResponse(xml).profiles?.length).toBeGreaterThan(0)
  const results = await bench.compare(
    bench('fast-xml-parser, parse only', () => {
      fxp(xml)
    }),
    bench('custom, parse and decode to profiles', () => {
      decodeResponse(xml)
    })
  )
  expect(results.get('custom, parse and decode to profiles').throughput.mean).toBeGreaterThan(
    results.get('fast-xml-parser, parse only').throughput.mean
  )
})
