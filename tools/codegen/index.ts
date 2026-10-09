import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { type EmitOptions, emit } from '#tools/codegen/emit.ts'
import { ModelBuilder } from '#tools/codegen/model.ts'
import { Registry, specsDirectory } from '#tools/codegen/registry.ts'

type Target = {
  output: string
  codecImport: string
  wsdl?: string
  /** Operations to generate, by port type. */
  operations?: Record<string, string[]>
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
    operations: {
      Device: [
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
  },
  {
    output: 'packages/management/source/generated/management.ts',
    codecImport: '@2bad/onvif/soap',
    client: { name: 'ManagementClient', typesImport: '@2bad/onvif' },
    wsdl: 'ver10/device/wsdl/devicemgmt.wsdl',
    operations: {
      Device: [
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
    operations: {
      EventPortType: ['GetServiceCapabilities', 'CreatePullPointSubscription', 'GetEventProperties'],
      PullPointSubscription: ['PullMessages', 'SetSynchronizationPoint', 'Unsubscribe'],
      SubscriptionManager: ['Renew']
    },
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
    operations: {
      Media: [
        'GetProfiles',
        'GetStreamUri',
        'GetSnapshotUri',
        'GetVideoSourceConfigurations',
        'GetVideoEncoderConfigurations',
        'GetVideoEncoderConfigurationOptions',
        'SetVideoEncoderConfiguration'
      ]
    }
  },
  {
    output: 'packages/media/source/generated/media2.ts',
    codecImport: '@2bad/onvif/soap',
    client: { name: 'Media2Client', typesImport: '@2bad/onvif' },
    wsdl: 'ver20/media/wsdl/media.wsdl',
    operations: {
      Media2: [
        'GetProfiles',
        'GetStreamUri',
        'GetSnapshotUri',
        'GetVideoSourceConfigurations',
        'GetVideoEncoderConfigurations',
        'GetVideoEncoderConfigurationOptions',
        'SetVideoEncoderConfiguration'
      ]
    }
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
    operations: {
      PTZ: [
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
  }
]

const commit = readFileSync(join(specsDirectory, 'onvif', 'COMMIT'), 'utf8')
  .trim()
  .slice(0, 7)

const generate = (target: Target): string => {
  const registry = new Registry()
  if (target.wsdl) registry.load(join(specsDirectory, 'onvif', target.wsdl))
  const builder = new ModelBuilder(registry)
  const operations = Object.entries(target.operations ?? {}).flatMap(([portType, names]) => {
    const available = new Map(registry.operations(portType).map((operation) => [operation.name, operation]))
    return names.map((name) => {
      const operation = available.get(name)
      if (!operation) throw new Error(`Operation ${name} not found in ${portType} of ${target.wsdl}`)
      return builder.operation(operation)
    })
  })
  const elements = (target.elements ?? []).map(({ schema, ...element }) => {
    registry.load(join(specsDirectory, schema))
    return builder.element(element)
  })
  const { codecImport, namespaces, client } = target
  return emit({ commit, codecImport, operations, elements, namespaces: namespaces ?? [], client })
}

const check = process.argv.includes('--check')
const scratch = mkdtempSync(join(tmpdir(), 'onvif-codegen-'))
try {
  const files = targets.map((target) => ({ target, path: join(scratch, target.output) }))
  for (const { target, path } of files) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, generate(target))
  }
  execFileSync(
    join(root, 'node_modules/.bin/oxfmt'),
    files.map(({ path }) => path),
    { cwd: root, stdio: 'ignore' }
  )
  for (const { target, path } of files) {
    const generated = readFileSync(path, 'utf8')
    const destination = join(root, target.output)
    if (!check) {
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, generated)
      console.log(`wrote ${target.output}`)
    } else if (!existsSync(destination) || readFileSync(destination, 'utf8') !== generated) {
      console.error(`${target.output} is out of date, run pnpm codegen`)
      process.exitCode = 1
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
