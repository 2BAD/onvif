import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { decode, type Operation } from '#onvif/soap/codec.ts'
import { parseEnvelope } from '#onvif/soap/envelope.ts'

export type Fixture = { name: string; xml: string; status: number; fault: boolean }

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

export const corpus: Fixture[] = collect(root).map((path) => {
  const xml = readFileSync(path, 'utf8')
  return {
    name: relative(root, path).split(sep).join('/'),
    xml,
    status: statusOf(path),
    fault: /<(?:[\w-]+:)?Body\b[^>]*>\s*<(?:[\w-]+:)?Fault\b/.test(xml)
  }
})

export const fixture = (name: string): Fixture => {
  const found = corpus.find((entry) => entry.name === name)
  if (!found) throw new Error(`Unknown fixture ${name}`)
  return found
}

export const operationsOf = (module: object): Operation<unknown, unknown>[] =>
  Object.values(module).filter(
    (value): value is Operation<unknown, unknown> => typeof value === 'object' && value !== null && 'response' in value
  )

/**
 * Successful captures of a service, each with the operation it answers. A capture of an operation in another state is
 * named after it, such as `media2.GetProfilesAfterAdd`.
 *
 * @param service - File name prefix of the captures, such as `media2`
 * @param operations - Operations of the service
 * @returns Each capture with its operation
 */
export const capturesOf = <Op extends { name: string }>(
  service: string,
  operations: readonly Op[]
): { name: string; xml: string; operation: Op }[] =>
  corpus.flatMap((entry) => {
    const action = new RegExp(`^(?:live|simulator)/.+/${service}\\.(\\w+)\\.xml$`).exec(entry.name)?.[1]
    if (action === undefined || entry.status !== 200 || entry.fault) return []
    const [operation] = operations
      .filter(({ name }) => action.startsWith(name))
      .toSorted((left, right) => right.name.length - left.name.length)
    return operation ? [{ name: entry.name, xml: entry.xml, operation }] : []
  })

export const decodeCapture = ({ xml, operation }: { xml: string; operation: Operation<unknown, unknown> }): unknown => {
  const { body } = parseEnvelope(xml, {}, undefined, { namespaces: operation.namespaces === true })
  const response = body[operation.response.name]
  if (response === undefined) throw new Error(`No ${operation.response.name} in the capture`)
  return decode(operation.schema, operation.response.type, response)
}
