import { expect, test } from 'vitest'
import { parseXml as custom } from '#onvif/soap/parse.ts'
import { parseXml as fxp } from '#tools/bench/fxp.ts'
import { successCorpus, workloads } from '#tools/bench/workloads.ts'

const cases = [
  ...Object.entries(workloads).map(([name, xml]) => ({
    name: `${name} (${(xml.length / 1024).toFixed(1)} KiB)`,
    documents: [xml]
  })),
  { name: `whole corpus (${successCorpus.length} documents)`, documents: successCorpus.map((entry) => entry.xml) }
]

test.for(cases)('$name', async ({ documents }, { bench }) => {
  const results = await bench.compare(
    bench('fast-xml-parser', () => {
      for (const xml of documents) fxp(xml)
    }),
    bench('custom', () => {
      for (const xml of documents) custom(xml)
    })
  )
  expect(results.get('custom').throughput.mean).toBeGreaterThan(results.get('fast-xml-parser').throughput.mean)
})
