import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export type Fixture = { name: string; xml: string; status: number }

const root = join(import.meta.dirname, '../../fixtures')

const collect = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return collect(path)
    return entry.name.endsWith('.xml') ? [path] : []
  })

const statusOf = (path: string): number => {
  const directory = join(path, '..')
  try {
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as {
      responses: Record<string, { status: number }>
    }
    return manifest.responses[relative(directory, path).replace(/\.xml$/, '')]?.status ?? 200
  } catch {
    return /(?:Error|Fault)\.xml$/.test(path) ? 500 : 200
  }
}

export const corpus: Fixture[] = collect(root).map((path) => ({
  name: relative(root, path).split(sep).join('/'),
  xml: readFileSync(path, 'utf8'),
  status: statusOf(path)
}))

export const fixture = (name: string): Fixture => {
  const found = corpus.find((entry) => entry.name === name)
  if (!found) throw new Error(`Unknown fixture ${name}`)
  return found
}
