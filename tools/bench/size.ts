import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { build } from 'tsdown'

const BUDGET_BYTES = 75_000

const source = join(import.meta.dirname, '../../packages/onvif/source')
const outDir = mkdtempSync(join(tmpdir(), 'onvif-size-'))
try {
  await build({
    entry: { index: join(source, 'index.ts'), soap: join(source, 'soap/index.ts') },
    outDir,
    format: 'es',
    platform: 'node',
    minify: true,
    dts: false,
    config: false,
    logLevel: 'silent'
  })
  const bundle = Buffer.concat(readdirSync(outDir).map((file) => readFileSync(join(outDir, file))))
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
