import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { build } from 'tsdown'

const BUDGET_BYTES = 60_000

const outDir = mkdtempSync(join(tmpdir(), 'onvif-size-'))
try {
  await build({
    entry: { index: join(import.meta.dirname, '../../packages/onvif/source/index.ts') },
    outDir,
    format: 'es',
    platform: 'node',
    minify: true,
    dts: false,
    config: false,
    logLevel: 'silent'
  })
  const bundle = readFileSync(join(outDir, 'index.mjs'))
  const summary = `@2bad/onvif: ${bundle.length} bytes minified, ${gzipSync(bundle).length} gzipped, budget ${BUDGET_BYTES} minified`
  if (bundle.length > BUDGET_BYTES) {
    console.error(`${summary}: over budget`)
    process.exitCode = 1
  } else {
    console.log(summary)
  }
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
