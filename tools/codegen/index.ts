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
  portTypes: { namespace: string; local: string; operations: string[] }[]
  /** Global elements outside the operations, with the schema that defines them. */
  elements?: { schema: string; namespace: string; local: string }[]
  /** Operations whose responses hold QNames or endpoint references and are parsed with namespaces. */
  namespaces?: string[]
}

const root = join(import.meta.dirname, '../..')

const targets: Target[] = [
  {
    output: 'packages/onvif/source/generated/device.ts',
    codecImport: '#soap/codec.ts',
    wsdl: 'ver10/device/wsdl/devicemgmt.wsdl',
    portTypes: [
      {
        namespace: 'http://www.onvif.org/ver10/device/wsdl',
        local: 'Device',
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
  }
]

const commit = readFileSync(join(specsDirectory, 'onvif', 'COMMIT'), 'utf8')
  .trim()
  .slice(0, 7)

const generate = (target: Target): string => {
  const registry = new Registry()
  registry.load(join(specsDirectory, 'onvif', target.wsdl))
  const builder = new ModelBuilder(registry)
  const operations = target.portTypes.flatMap((portType) => {
    const available = new Map(registry.operations(portType).map((operation) => [operation.name, operation]))
    return portType.operations.map((name) => {
      const operation = available.get(name)
      if (!operation?.output) throw new Error(`Operation ${name} not found in ${portType.local} of ${target.wsdl}`)
      return builder.operation(name, operation.action, operation.input, operation.output)
    })
  })
  const elements = (target.elements ?? []).map(({ schema, ...element }) => {
    registry.load(join(specsDirectory, 'onvif', schema))
    return builder.element(element)
  })
  return emit({ commit, codecImport: target.codecImport, operations, elements, namespaces: target.namespaces ?? [] })
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
