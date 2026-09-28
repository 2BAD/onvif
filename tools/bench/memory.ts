import { GCProfiler } from 'node:v8'
import { parseXml as custom } from '../../packages/onvif/source/soap/parse.ts'
import { parseXml as fxp } from './fxp.ts'
import { successCorpus, workloads } from './workloads.ts'

const collectGarbage = globalThis.gc
if (!collectGarbage) throw new Error('Run with node --expose-gc')

const candidates = { 'fast-xml-parser': fxp, custom }
const documents = [...successCorpus.map((entry) => entry.xml), workloads.nvrProfiles, workloads.eventBatch]
const totalKiB = documents.reduce((sum, xml) => sum + xml.length, 0) / 1024
const iterations = 50
const retainedCopies = 20

const rows = []
for (const [name, parse] of Object.entries(candidates)) {
  for (const xml of documents) parse(xml)
  collectGarbage()

  const profiler = new GCProfiler()
  profiler.start()
  const started = performance.now()
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (const xml of documents) parse(xml)
  }
  const elapsed = performance.now() - started
  const gcMs = (profiler.stop()?.statistics ?? []).reduce((sum, event) => sum + event.cost, 0) / 1000

  collectGarbage()
  const before = process.memoryUsage().heapUsed
  const kept = []
  for (let copy = 0; copy < retainedCopies; copy++) kept.push(documents.map((xml) => parse(xml)))
  collectGarbage()
  const retained = (process.memoryUsage().heapUsed - before) / retainedCopies
  kept.length = 0

  rows.push({
    candidate: name,
    'MiB/s': Number(((totalKiB * iterations) / 1024 / (elapsed / 1000)).toFixed(1)),
    'GC ms': Number(gcMs.toFixed(1)),
    'GC time %': Number(((gcMs / elapsed) * 100).toFixed(1)),
    'retained KiB per corpus': Number((retained / 1024).toFixed(0)),
    'retained / input': Number((retained / 1024 / totalKiB).toFixed(2))
  })
}

console.log(`corpus: ${documents.length} documents, ${totalKiB.toFixed(0)} KiB, ${iterations} iterations`)
console.table(rows)
