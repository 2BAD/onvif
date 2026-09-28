import { expect, test } from 'vitest'
import { parseSOAPString } from '../../source/utils/xml.ts'
import { parseXml as fxp } from './candidates/fxp.ts'
import { parseXml as custom } from './candidates/xml.ts'
import { successCorpus, workloads } from './workloads.ts'

const cases = [
  ...Object.entries(workloads).map(([name, xml]) => ({
    name: `${name} (${(xml.length / 1024).toFixed(1)} KiB)`,
    documents: [xml]
  })),
  { name: `whole corpus (${successCorpus.length} documents)`, documents: successCorpus.map((entry) => entry.xml) }
]

test.for(cases)('$name', async ({ documents }, { bench }) => {
  const results = await bench.compare(
    bench('current pipeline', async () => {
      for (const xml of documents) await parseSOAPString(xml)
    }),
    bench('fast-xml-parser', () => {
      for (const xml of documents) fxp(xml)
    }),
    bench('custom', () => {
      for (const xml of documents) custom(xml)
    })
  )
  expect(results.get('custom').throughput.mean).toBeGreaterThan(results.get('fast-xml-parser').throughput.mean)
})
