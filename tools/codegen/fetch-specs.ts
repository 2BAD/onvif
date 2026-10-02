import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { specsDirectory } from './registry.ts'

type TreeEntry = { path: string; type: string; sha: string }

const defaultCommit = 'b0ae7de3dc3ca9b5ca27629385f48167cacc715a'

const externalSchemas = [
  'http://docs.oasis-open.org/wsn/b-2.xsd',
  'http://docs.oasis-open.org/wsn/t-1.xsd',
  'http://docs.oasis-open.org/wsn/bw-2.wsdl',
  'http://docs.oasis-open.org/wsrf/rw-2.wsdl',
  'http://docs.oasis-open.org/wsrf/r-2.xsd',
  'http://docs.oasis-open.org/wsrf/bf-2.xsd',
  'http://www.w3.org/2005/08/addressing/ws-addr.xsd',
  'http://schemas.xmlsoap.org/ws/2005/04/discovery/ws-discovery.xsd',
  'http://schemas.xmlsoap.org/ws/2004/08/addressing',
  'http://www.w3.org/2001/xml.xsd',
  'https://www.w3.org/2005/05/xmlmime',
  'https://www.w3.org/2004/08/xop/include',
  'https://www.w3.org/2003/05/soap-envelope'
]

const download = async (url: string, accept?: string): Promise<Buffer> => {
  const response = await fetch(url, accept ? { headers: { Accept: accept } } : {})
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

const gitBlobSha = (content: Buffer): string =>
  createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex')

const inBatches = async <T, R>(items: T[], size: number, task: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = []
  for (let start = 0; start < items.length; start += size) {
    results.push(...(await Promise.all(items.slice(start, start + size).map(task))))
  }
  return results
}

const commit = process.argv[2] ?? defaultCommit
const files = new Map<string, Buffer>()

const tree = JSON.parse(
  (await download(`https://api.github.com/repos/onvif/specs/git/trees/${commit}?recursive=1`)).toString('utf8')
) as { tree: TreeEntry[]; truncated: boolean }
if (tree.truncated) throw new Error('The onvif/specs tree listing is truncated')

const specs = tree.tree.filter(
  (entry) => entry.type === 'blob' && entry.path.startsWith('wsdl/') && /\.(?:wsdl|xsd)$/.test(entry.path)
)
await inBatches(specs, 8, async (entry) => {
  const content = await download(`https://raw.githubusercontent.com/onvif/specs/${commit}/${entry.path}`)
  if (gitBlobSha(content) !== entry.sha) throw new Error(`Checksum mismatch for ${entry.path}`)
  files.set(join('onvif', entry.path.slice('wsdl/'.length)), content)
})
files.set(join('onvif', 'COMMIT'), Buffer.from(`${commit}\n`))

await inBatches(externalSchemas, 8, async (url) => {
  files.set(join('external', url.replace(/^https?:\/\//, '')), await download(url, 'application/xml, */*;q=0.1'))
})

await rm(join(specsDirectory, 'onvif'), { recursive: true, force: true })
await rm(join(specsDirectory, 'external'), { recursive: true, force: true })
for (const [path, content] of files) {
  const destination = join(specsDirectory, path)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, content)
}
console.log(`wrote ${files.size} files from onvif/specs@${commit.slice(0, 7)}`)
