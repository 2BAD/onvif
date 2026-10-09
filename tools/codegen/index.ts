import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { type EmitOptions, emit } from '#tools/codegen/emit.ts'
import { ModelBuilder } from '#tools/codegen/model.ts'
import { Registry, specsDirectory } from '#tools/codegen/registry.ts'

type Target = {
  output: string
  codecImport: string
  wsdl?: string
  portTypes?: { namespace: string; local: string; operations: string[] }[]
  /** Global elements outside the operations, with the schema that defines them relative to the specs directory. */
  elements?: { schema: string; namespace: string; local: string }[]
  /** Operations whose responses hold QNames or endpoint references and are parsed with namespaces. */
  namespaces?: string[]
  client?: EmitOptions['client']
}

const root = join(import.meta.dirname, '../..')

const targets: Target[] = [
  {
    output: 'packages/onvif/source/generated/device.ts',
    codecImport: '#soap/codec.ts',
    client: { name: 'DeviceOperations', typesImport: '#device.ts', abstract: true },
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
  },
  {
    output: 'packages/management/source/generated/management.ts',
    codecImport: '@2bad/onvif/soap',
    client: { name: 'ManagementClient', typesImport: '@2bad/onvif' },
    wsdl: 'ver10/device/wsdl/devicemgmt.wsdl',
    portTypes: [
      {
        namespace: 'http://www.onvif.org/ver10/device/wsdl',
        local: 'Device',
        operations: [
          'SetNetworkInterfaces',
          'GetNetworkDefaultGateway',
          'SetNetworkDefaultGateway',
          'GetUsers',
          'CreateUsers',
          'SetUser',
          'DeleteUsers',
          'GetNTP',
          'SetNTP',
          'GetDynamicDNS',
          'SetDynamicDNS',
          'GetZeroConfiguration',
          'SetZeroConfiguration',
          'GetIPAddressFilter',
          'SetIPAddressFilter',
          'AddIPAddressFilter',
          'RemoveIPAddressFilter',
          'GetRelayOutputs',
          'SetRelayOutputSettings',
          'SetRelayOutputState'
        ]
      }
    ]
  },
  {
    output: 'packages/events/source/generated/events.ts',
    codecImport: '@2bad/onvif/soap',
    client: {
      name: 'EventsClient',
      typesImport: '@2bad/onvif',
      operations: ['GetServiceCapabilities', 'GetEventProperties']
    },
    wsdl: 'ver10/events/wsdl/event.wsdl',
    portTypes: [
      {
        namespace: 'http://www.onvif.org/ver10/events/wsdl',
        local: 'EventPortType',
        operations: ['GetServiceCapabilities', 'CreatePullPointSubscription', 'GetEventProperties']
      },
      {
        namespace: 'http://www.onvif.org/ver10/events/wsdl',
        local: 'PullPointSubscription',
        operations: ['PullMessages', 'SetSynchronizationPoint', 'Unsubscribe']
      },
      { namespace: 'http://docs.oasis-open.org/wsn/bw-2', local: 'SubscriptionManager', operations: ['Renew'] }
    ],
    elements: [
      { schema: 'onvif/ver10/schema/onvif.xsd', namespace: 'http://www.onvif.org/ver10/schema', local: 'Message' }
    ],
    namespaces: ['CreatePullPointSubscription', 'PullMessages']
  },
  {
    output: 'packages/discovery/source/generated/discovery.ts',
    codecImport: '@2bad/onvif/soap',
    elements: [
      {
        schema: 'external/schemas.xmlsoap.org/ws/2005/04/discovery/ws-discovery.xsd',
        namespace: 'http://schemas.xmlsoap.org/ws/2005/04/discovery',
        local: 'ProbeMatches'
      }
    ]
  },
  {
    output: 'packages/media/source/generated/media.ts',
    codecImport: '@2bad/onvif/soap',
    client: { name: 'MediaClient', typesImport: '@2bad/onvif' },
    wsdl: 'ver10/media/wsdl/media.wsdl',
    portTypes: [
      {
        namespace: 'http://www.onvif.org/ver10/media/wsdl',
        local: 'Media',
        operations: [
          'GetProfiles',
          'GetStreamUri',
          'GetSnapshotUri',
          'GetVideoSourceConfigurations',
          'GetVideoEncoderConfigurations',
          'GetVideoEncoderConfigurationOptions',
          'SetVideoEncoderConfiguration'
        ]
      }
    ]
  },
  {
    output: 'packages/media/source/generated/media2.ts',
    codecImport: '@2bad/onvif/soap',
    client: { name: 'Media2Client', typesImport: '@2bad/onvif' },
    wsdl: 'ver20/media/wsdl/media.wsdl',
    portTypes: [
      {
        namespace: 'http://www.onvif.org/ver20/media/wsdl',
        local: 'Media2',
        operations: [
          'GetProfiles',
          'GetStreamUri',
          'GetSnapshotUri',
          'GetVideoSourceConfigurations',
          'GetVideoEncoderConfigurations',
          'GetVideoEncoderConfigurationOptions',
          'SetVideoEncoderConfiguration'
        ]
      }
    ]
  },
  {
    output: 'packages/ptz/source/generated/ptz.ts',
    codecImport: '@2bad/onvif/soap',
    client: {
      name: 'PTZClient',
      typesImport: '@2bad/onvif',
      scoped: { name: 'PTZProfileClient', method: 'forProfile', field: 'ProfileToken' }
    },
    wsdl: 'ver20/ptz/wsdl/ptz.wsdl',
    portTypes: [
      {
        namespace: 'http://www.onvif.org/ver20/ptz/wsdl',
        local: 'PTZ',
        operations: [
          'GetServiceCapabilities',
          'GetNodes',
          'GetNode',
          'GetConfigurations',
          'GetConfiguration',
          'GetConfigurationOptions',
          'SetConfiguration',
          'GetStatus',
          'ContinuousMove',
          'RelativeMove',
          'AbsoluteMove',
          'Stop',
          'GetPresets',
          'SetPreset',
          'RemovePreset',
          'GotoPreset',
          'GotoHomePosition',
          'SetHomePosition',
          'SendAuxiliaryCommand'
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
  if (target.wsdl) registry.load(join(specsDirectory, 'onvif', target.wsdl))
  const builder = new ModelBuilder(registry)
  const operations = (target.portTypes ?? []).flatMap((portType) => {
    const available = new Map(registry.operations(portType).map((operation) => [operation.name, operation]))
    return portType.operations.map((name) => {
      const operation = available.get(name)
      if (!operation) throw new Error(`Operation ${name} not found in ${portType.local} of ${target.wsdl}`)
      return builder.operation(operation)
    })
  })
  const elements = (target.elements ?? []).map(({ schema, ...element }) => {
    registry.load(join(specsDirectory, schema))
    return builder.element(element)
  })
  return emit({
    commit,
    codecImport: target.codecImport,
    operations,
    elements,
    namespaces: target.namespaces ?? [],
    client: target.client
  })
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
