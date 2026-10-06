import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { text } from 'node:stream/consumers'

type Capture = { name: string; status: number; contentType: string; xml: string }

const directory = process.argv[2]
if (!directory) throw new Error('Usage: pnpm fixtures:import <fixture directory> < captures.jsonl')

const manifestPath = join(directory, 'manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { responses: Record<string, unknown> }
for (const line of (await text(process.stdin)).split('\n').filter((entry) => entry.trim() !== '')) {
  const { name, status, contentType, xml } = JSON.parse(line) as Capture
  if (!/^[a-z0-9]+\.\w+$/.test(name)) throw new Error(`Invalid capture name ${name}`)
  manifest.responses[name] = { status, contentType }
  await writeFile(join(directory, `${name}.xml`), xml)
  console.log(JSON.stringify({ name, status, bytes: xml.length }))
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
