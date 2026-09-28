import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { emit } from '#tools/codegen/emit.ts'
import { ModelBuilder } from '#tools/codegen/model.ts'
import { Registry, specsDirectory } from '#tools/codegen/registry.ts'

type Target = {
  output: string
  codecImport: string
  wsdl: string
  portType: { namespace: string; local: string }
  operations: string[]
}

const root = join(import.meta.dirname, '../..')

const targets: Target[] = [
  {
    output: 'packages/onvif/source/generated/device.ts',
    codecImport: '#soap/codec.ts',
    wsdl: 'ver10/device/wsdl/devicemgmt.wsdl',
    portType: { namespace: 'http://www.onvif.org/ver10/device/wsdl', local: 'Device' },
    operations: [
      'GetSystemDateAndTime',
      'GetServices',
      'GetServiceCapabilities',
      'GetCapabilities',
      'GetDeviceInformation',
      'GetScopes',
      'GetHostname',
      'GetNetworkInterfaces',
      'SystemReboot'
    ]
  }
]

const commit = readFileSync(join(specsDirectory, 'onvif', 'COMMIT'), 'utf8')
  .trim()
  .slice(0, 7)

const generate = (target: Target): string => {
  const registry = new Registry()
  registry.load(join(specsDirectory, 'onvif', target.wsdl))
  const available = new Map(registry.operations(target.portType).map((operation) => [operation.name, operation]))
  const builder = new ModelBuilder(registry)
  const operations = target.operations.map((name) => {
    const operation = available.get(name)
    if (!operation?.output) throw new Error(`Operation ${name} not found in ${target.wsdl}`)
    return builder.operation(name, operation.action, operation.input, operation.output)
  })
  return emit({ commit, codecImport: target.codecImport, operations })
}

const format = (files: string[]): void => {
  execFileSync(join(root, 'node_modules/.bin/oxfmt'), files, { cwd: root, stdio: 'ignore' })
}

const check = process.argv.includes('--check')
const scratch = mkdtempSync(join(tmpdir(), 'onvif-codegen-'))
let stale = 0

try {
  for (const target of targets) {
    const destination = join(root, target.output)
    const candidate = join(scratch, relative(root, destination))
    mkdirSync(dirname(candidate), { recursive: true })
    writeFileSync(candidate, generate(target))
    format([candidate])
    const generated = readFileSync(candidate, 'utf8')
    if (check) {
      let current = ''
      try {
        current = readFileSync(destination, 'utf8')
      } catch {
        current = ''
      }
      if (current !== generated) {
        stale++
        console.error(`${target.output} is out of date, run pnpm codegen`)
      }
    } else {
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, generated)
      console.log(`wrote ${target.output}`)
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

if (stale > 0) process.exitCode = 1
