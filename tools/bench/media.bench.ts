import { expect, test } from 'vitest'
import { GetProfiles } from '#onvif-media/generated/media.ts'
import { GetProfiles as GetProfiles2 } from '#onvif-media/generated/media2.ts'
import { decode, type Operation } from '#onvif/soap/codec.ts'
import { parseEnvelope } from '#onvif/soap/envelope.ts'
import { fixture } from '#tools/fixtures/corpus.ts'
import { parseXml as fxp } from '#tools/bench/fxp.ts'
import { repeatElement, workloads } from '#tools/bench/workloads.ts'

const media2Profiles = fixture('live/dvc/dcn-bm2220lpr/media2.GetProfiles.xml').xml

const decodeResponse = (operation: Operation<unknown, { profiles?: unknown[] }>, xml: string) => {
  const context = { host: 'bench', service: 'media', action: 'GetProfiles' }
  const { body } = parseEnvelope(xml, context)
  return decode(operation.schema, operation.response.type, body[operation.response.name] ?? '', context) as {
    profiles?: unknown[]
  }
}

const cases = [
  { name: 'dvc capture (3 profiles)', operation: GetProfiles, xml: workloads.large },
  { name: 'nvr (96 profiles)', operation: GetProfiles, xml: workloads.nvrProfiles },
  { name: 'Media2 dvc capture (3 profiles)', operation: GetProfiles2, xml: media2Profiles },
  {
    name: 'Media2 nvr (96 profiles)',
    operation: GetProfiles2,
    xml: repeatElement(media2Profiles, /<trt2:Profiles /, '</trt2:Profiles>', 32)
  }
]

test.for(cases)('GetProfiles $name', async ({ operation, xml }, { bench }) => {
  expect(decodeResponse(operation, xml).profiles?.length).toBeGreaterThan(0)
  const results = await bench.compare(
    bench('fast-xml-parser, parse only', () => {
      fxp(xml)
    }),
    bench('custom, parse and decode to profiles', () => {
      decodeResponse(operation, xml)
    })
  )
  expect(results.get('custom, parse and decode to profiles').throughput.mean).toBeGreaterThan(
    results.get('fast-xml-parser, parse only').throughput.mean
  )
})
