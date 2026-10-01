import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fixture } from '#tools/fixtures/corpus.ts'
import { successCorpus, workloads } from '#tools/bench/workloads.ts'

type Codec = typeof import('#onvif/soap/codec.ts')
type Envelope = typeof import('#onvif/soap/envelope.ts')
type Parse = typeof import('#onvif/soap/parse.ts')
type Security = typeof import('#onvif/soap/security.ts')
type Events = typeof import('#onvif-events/generated/events.ts')
type Notification = typeof import('#onvif-events/notification.ts')
type Media = typeof import('#onvif-media/generated/media.ts')

const MAX_SLOWDOWN = 0.1
const WARMUP_MS = 300
const SAMPLE_MS = 50
const ROUNDS = 25

const root = join(import.meta.dirname, '../..')
const git = (...args: string[]): Buffer => execFileSync('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024 })

const baseRef = process.argv[2] ?? 'HEAD'
const baseCommit = git('rev-parse', '--verify', `${baseRef}^{commit}`).toString().trim()
const sourceChanged = ((): boolean => {
  try {
    git('diff', '--quiet', baseCommit, '--', ':(glob)packages/*/source/**', ':(glob,exclude)**/*.test.ts')
    return false
  } catch {
    return true
  }
})()

const baseRoot = join(root, 'node_modules/.cache/onvif-bench', baseCommit)
if (sourceChanged && !existsSync(join(baseRoot, 'packages'))) {
  rmSync(baseRoot, { recursive: true, force: true })
  mkdirSync(baseRoot, { recursive: true })
  execFileSync('tar', ['-x', '-C', baseRoot], { input: git('archive', baseCommit, 'packages') })
}

// each tree resolves the core by package name to its own source, not to the workspace build
registerHooks({
  resolve: (specifier, context, nextResolve) => {
    if (specifier !== '@2bad/onvif') return nextResolve(specifier, context)
    const tree = context.parentURL?.startsWith(pathToFileURL(baseRoot).href) ? baseRoot : root
    return nextResolve(pathToFileURL(join(tree, 'packages/onvif/source/index.ts')).href, context)
  }
})

const load = async <Module>(tree: string, path: string): Promise<Module> =>
  (await import(pathToFileURL(join(tree, 'packages', path)).href)) as Module

const workloadsFor = async (tree: string): Promise<Map<string, () => unknown>> => {
  const { parseXml } = await load<Parse>(tree, 'onvif/source/soap/parse.ts')
  const { parseEnvelope, buildEnvelope } = await load<Envelope>(tree, 'onvif/source/soap/envelope.ts')
  const { decode, encodeRequest } = await load<Codec>(tree, 'onvif/source/soap/codec.ts')
  const { usernameToken } = await load<Security>(tree, 'onvif/source/soap/security.ts')
  const { GetProfiles } = await load<Media>(tree, 'media/source/generated/media.ts')
  const { PullMessages } = await load<Events>(tree, 'events/source/generated/events.ts')
  const { decodeNotification } = await load<Notification>(tree, 'events/source/notification.ts')

  const context = { host: 'bench' }
  const profiles = (xml: string) => () => {
    const { body } = parseEnvelope(xml, context)
    return decode(GetProfiles.schema, GetProfiles.response.type, body[GetProfiles.response.name] ?? '', context)
  }
  const notifications = (xml: string) => () => {
    const { body } = parseEnvelope(xml, context, undefined, { namespaces: true })
    const response = decode(PullMessages.schema, PullMessages.response.type, body[PullMessages.response.name] ?? '')
    const { notificationMessage = [] } = response as {
      notificationMessage?: Parameters<typeof decodeNotification>[0][]
    }
    return notificationMessage.map((holder) => decodeNotification(holder, context))
  }
  const corpus = successCorpus.map(({ xml }) => xml)
  const credentials = { username: 'admin', password: 'password' }

  return new Map<string, () => unknown>([
    ...Object.entries(workloads).map(([name, xml]): [string, () => unknown] => [`parse ${name}`, () => parseXml(xml)]),
    ['parse whole corpus', () => corpus.map((xml) => parseXml(xml))],
    ['parse eventBatch with namespaces', () => parseXml(workloads.eventBatch, undefined, { namespaces: true })],
    ['decode GetProfiles dvc capture', profiles(workloads.large)],
    ['decode GetProfiles nvr', profiles(workloads.nvrProfiles)],
    ['decode PullMessages dvc capture', notifications(fixture('live/dvc/dcn-bm2220lpr/events.PullMessages.xml').xml)],
    ['decode PullMessages event batch', notifications(workloads.eventBatch)],
    [
      'build an authenticated GetProfiles request',
      () => buildEnvelope(encodeRequest(GetProfiles, {}), [usernameToken(credentials, new Date())])
    ]
  ])
}

const throughput = (run: () => unknown, durationMs: number): number => {
  let iterations = 0
  const started = performance.now()
  let elapsed = 0
  while (elapsed < durationMs) {
    run()
    iterations += 1
    elapsed = performance.now() - started
  }
  return iterations / elapsed
}

const median = (values: number[]): number => {
  const sorted = values.toSorted((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

const ratioOf = (previous: () => unknown, current: () => unknown): number => {
  throughput(previous, WARMUP_MS)
  throughput(current, WARMUP_MS)
  const ratios = []
  for (let round = 0; round < ROUNDS; round++) {
    const [first, second] = round % 2 === 0 ? [previous, current] : [current, previous]
    const firstThroughput = throughput(first, SAMPLE_MS)
    const secondThroughput = throughput(second, SAMPLE_MS)
    ratios.push(round % 2 === 0 ? secondThroughput / firstThroughput : firstThroughput / secondThroughput)
  }
  return median(ratios)
}

const formatChange = (ratio: number): string => `${ratio >= 1 ? '+' : ''}${((ratio - 1) * 100).toFixed(1)}%`

const compare = (base: Map<string, () => unknown>, head: Map<string, () => unknown>): string[] => {
  console.log(
    `Throughput of the working tree against ${baseCommit.slice(0, 7)}, median of ${ROUNDS} alternating rounds`
  )
  const slower: string[] = []
  for (const [name, current] of head) {
    const previous = base.get(name)
    if (!previous) {
      console.log(`  ${name}: new`)
      continue
    }
    const ratio = ratioOf(previous, current)
    if (ratio >= 1 - MAX_SLOWDOWN) {
      console.log(`  ${name}: ${formatChange(ratio)}`)
      continue
    }
    const repeated = ratioOf(previous, current)
    const regressed = repeated < 1 - MAX_SLOWDOWN
    if (regressed) slower.push(name)
    console.log(
      `  ${name}: ${formatChange(ratio)}, repeated ${formatChange(repeated)}${regressed ? ' REGRESSION' : ''}`
    )
  }
  return slower
}

let base: Map<string, () => unknown> | undefined
if (sourceChanged) {
  try {
    base = await workloadsFor(baseRoot)
  } catch (error) {
    console.log(
      `Base ${baseCommit.slice(0, 7)} cannot run the regression workloads, nothing to compare: ${String(error)}`
    )
  }
} else {
  console.log(`No package source changed since ${baseCommit.slice(0, 7)}, nothing to compare`)
}
const slower = base ? compare(base, await workloadsFor(root)) : []
if (slower.length > 0) {
  console.error(`${slower.length} workloads are more than ${MAX_SLOWDOWN * 100}% slower than ${baseCommit.slice(0, 7)}`)
  process.exitCode = 1
}
