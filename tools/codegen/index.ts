import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { type EmitOptions, emit } from '#tools/codegen/emit.ts'
import { ModelBuilder } from '#tools/codegen/model.ts'
import { Registry, specsDirectory } from '#tools/codegen/registry.ts'

type Target = {
  output: string
  /** `@2bad/onvif/soap` by default. */
  codecImport?: string
  wsdl?: string
  /** Operations to generate, by port type. */
  operations?: Record<string, string[]>
  /** Global elements outside the operations, with the schema that defines them relative to the specs directory. */
  elements?: { schema: string; namespace: string; local: string }[]
  /** Operations whose responses hold endpoint references or QName text and are parsed with namespaces. */
  namespaces?: string[]
  /** Decode `xs:QName` values with the `qname` primitive. */
  qnames?: true
  /**
   * Typed elements that may stand in for the `xs:any` of a type, by type name. Each is typed by the global element of
   * its name, or else by the complex type of its name.
   */
  substitutions?: Record<string, { schema?: string; namespace: string; local: string }[]>
  /** Types whose text holds names with namespace prefixes, such as topic expressions. */
  prefixed?: string[]
  /** Required elements that devices omit or leave empty, as `Response.Element` or `Type.Element`, decoded as optional. */
  optional?: string[]
  /** `typesImport` is `@2bad/onvif` by default. */
  client?: Omit<NonNullable<EmitOptions['client']>, 'typesImport'> & { typesImport?: string }
}

const root = join(import.meta.dirname, '../..')
const tt = 'http://www.onvif.org/ver10/schema'
const axt = 'http://www.onvif.org/ver20/analytics'
const wsnt = 'http://docs.oasis-open.org/wsn/b-2'
const filters = [
  { namespace: wsnt, local: 'TopicExpression' },
  { namespace: wsnt, local: 'MessageContent' }
]
const topicExpressions = ['TopicExpressionType', 'QueryExpressionType']
const elementItems = [
  { namespace: tt, local: 'CellLayout' },
  { namespace: tt, local: 'Polygon' },
  { namespace: tt, local: 'Polyline' },
  { schema: 'onvif/ver20/analytics/rules.xsd', namespace: axt, local: 'MotionRegionConfig' }
]

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
    client: { name: 'ManagementClient' },
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
        'SetRelayOutputState',
        'GetDNS',
        'SetDNS',
        'SetHostname',
        'SetHostnameFromDHCP',
        'GetNetworkProtocols',
        'SetNetworkProtocols',
        'GetDiscoveryMode',
        'SetDiscoveryMode',
        'GetRemoteDiscoveryMode',
        'SetRemoteDiscoveryMode',
        'GetDPAddresses',
        'SetDPAddresses',
        'GetEndpointReference',
        'GetDot11Capabilities',
        'GetDot11Status',
        'ScanAvailableDot11Networks',
        'SetScopes',
        'AddScopes',
        'RemoveScopes',
        'SetSystemDateAndTime',
        'SetSystemFactoryDefault',
        'GetSystemLog',
        'GetSystemSupportInformation',
        'GetWsdlUrl',
        'SendAuxiliaryCommand',
        'GetGeoLocation',
        'SetGeoLocation',
        'DeleteGeoLocation',
        'GetStorageConfigurations',
        'CreateStorageConfiguration',
        'GetStorageConfiguration',
        'SetStorageConfiguration',
        'DeleteStorageConfiguration',
        'GetUserRoles',
        'SetUserRole',
        'DeleteUserRole',
        'GetRemoteUser',
        'SetRemoteUser',
        'GetPasswordComplexityOptions',
        'GetPasswordComplexityConfiguration',
        'SetPasswordComplexityConfiguration',
        'GetPasswordHistoryConfiguration',
        'SetPasswordHistoryConfiguration',
        'GetAuthFailureWarningOptions',
        'GetAuthFailureWarningConfiguration',
        'SetAuthFailureWarningConfiguration',
        'GetAccessPolicy',
        'SetAccessPolicy',
        'SetHashingAlgorithm',
        'CreateCertificate',
        'GetCertificates',
        'GetCertificatesStatus',
        'SetCertificatesStatus',
        'DeleteCertificates',
        'GetPkcs10Request',
        'LoadCertificates',
        'GetClientCertificateMode',
        'SetClientCertificateMode',
        'GetCACertificates',
        'LoadCertificateWithPrivateKey',
        'GetCertificateInformation',
        'LoadCACertificates',
        'CreateDot1XConfiguration',
        'SetDot1XConfiguration',
        'GetDot1XConfiguration',
        'GetDot1XConfigurations',
        'DeleteDot1XConfiguration',
        'GetSystemUris',
        'StartFirmwareUpgrade',
        'StartSystemRestore',
        'UpgradeFirmware'
      ]
    }
  },
  {
    output: 'packages/events/source/generated/events.ts',
    client: {
      name: 'EventsClient',
      operations: ['GetServiceCapabilities', 'GetEventProperties']
    },
    wsdl: 'ver10/events/wsdl/event.wsdl',
    operations: {
      EventPortType: ['GetServiceCapabilities', 'CreatePullPointSubscription', 'GetEventProperties'],
      PullPointSubscription: ['PullMessages', 'SetSynchronizationPoint', 'Unsubscribe'],
      SubscriptionManager: ['Renew']
    },
    elements: [
      { schema: 'onvif/ver10/schema/onvif.xsd', namespace: 'http://www.onvif.org/ver10/schema', local: 'Message' },
      {
        schema: 'onvif/ver10/events/wsdl/event.wsdl',
        namespace: 'http://www.onvif.org/ver10/events/wsdl',
        local: 'PullMessagesFaultResponse'
      }
    ],
    namespaces: ['CreatePullPointSubscription', 'PullMessages'],
    substitutions: { FilterType: filters },
    prefixed: topicExpressions
  },
  {
    output: 'packages/discovery/source/generated/discovery.ts',
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
    client: { name: 'MediaClient' },
    wsdl: 'ver10/media/wsdl/media.wsdl',
    optional: ['GetVideoSourceModesResponse.VideoSourceModes'],
    operations: {
      Media: [
        'GetServiceCapabilities',
        'GetProfiles',
        'GetProfile',
        'CreateProfile',
        'DeleteProfile',
        'GetStreamUri',
        'GetSnapshotUri',
        'StartMulticastStreaming',
        'StopMulticastStreaming',
        'GetVideoSources',
        'GetVideoSourceConfigurations',
        'GetVideoSourceConfiguration',
        'GetCompatibleVideoSourceConfigurations',
        'GetVideoSourceConfigurationOptions',
        'SetVideoSourceConfiguration',
        'AddVideoSourceConfiguration',
        'RemoveVideoSourceConfiguration',
        'GetVideoEncoderConfigurations',
        'GetVideoEncoderConfiguration',
        'GetCompatibleVideoEncoderConfigurations',
        'GetVideoEncoderConfigurationOptions',
        'SetVideoEncoderConfiguration',
        'AddVideoEncoderConfiguration',
        'RemoveVideoEncoderConfiguration',
        'GetAudioSources',
        'GetAudioSourceConfigurations',
        'GetAudioSourceConfiguration',
        'GetCompatibleAudioSourceConfigurations',
        'GetAudioSourceConfigurationOptions',
        'SetAudioSourceConfiguration',
        'AddAudioSourceConfiguration',
        'RemoveAudioSourceConfiguration',
        'GetAudioEncoderConfigurations',
        'GetAudioEncoderConfiguration',
        'GetCompatibleAudioEncoderConfigurations',
        'GetAudioEncoderConfigurationOptions',
        'SetAudioEncoderConfiguration',
        'AddAudioEncoderConfiguration',
        'RemoveAudioEncoderConfiguration',
        'GetMetadataConfigurations',
        'GetMetadataConfiguration',
        'GetCompatibleMetadataConfigurations',
        'GetMetadataConfigurationOptions',
        'SetMetadataConfiguration',
        'AddMetadataConfiguration',
        'RemoveMetadataConfiguration',
        'AddPTZConfiguration',
        'RemovePTZConfiguration',
        'GetVideoSourceModes',
        'SetVideoSourceMode',
        'GetGuaranteedNumberOfVideoEncoderInstances',
        'SetSynchronizationPoint',
        'GetVideoAnalyticsConfigurations',
        'GetVideoAnalyticsConfiguration',
        'GetCompatibleVideoAnalyticsConfigurations',
        'SetVideoAnalyticsConfiguration',
        'AddVideoAnalyticsConfiguration',
        'RemoveVideoAnalyticsConfiguration',
        'GetAudioOutputs',
        'GetAudioOutputConfigurations',
        'GetAudioOutputConfiguration',
        'GetCompatibleAudioOutputConfigurations',
        'GetAudioOutputConfigurationOptions',
        'SetAudioOutputConfiguration',
        'AddAudioOutputConfiguration',
        'RemoveAudioOutputConfiguration',
        'GetAudioDecoderConfigurations',
        'GetAudioDecoderConfiguration',
        'GetCompatibleAudioDecoderConfigurations',
        'GetAudioDecoderConfigurationOptions',
        'SetAudioDecoderConfiguration',
        'AddAudioDecoderConfiguration',
        'RemoveAudioDecoderConfiguration',
        'GetOSDs',
        'GetOSD',
        'GetOSDOptions',
        'CreateOSD',
        'SetOSD',
        'DeleteOSD'
      ]
    },
    namespaces: ['GetMetadataConfigurations', 'GetMetadataConfiguration', 'GetCompatibleMetadataConfigurations'],
    substitutions: { FilterType: filters, ItemListElementItem: elementItems },
    prefixed: topicExpressions
  },
  {
    output: 'packages/media/source/generated/media2.ts',
    client: { name: 'Media2Client' },
    wsdl: 'ver20/media/wsdl/media.wsdl',
    optional: ['GetVideoSourceModesResponse.VideoSourceModes'],
    operations: {
      Media2: [
        'GetServiceCapabilities',
        'GetProfiles',
        'CreateProfile',
        'DeleteProfile',
        'AddConfiguration',
        'RemoveConfiguration',
        'GetStreamUri',
        'GetSnapshotUri',
        'StartMulticastStreaming',
        'StopMulticastStreaming',
        'SetSynchronizationPoint',
        'GetVideoSourceModes',
        'SetVideoSourceMode',
        'GetVideoEncoderInstances',
        'GetVideoSourceConfigurations',
        'GetVideoSourceConfigurationOptions',
        'SetVideoSourceConfiguration',
        'GetVideoEncoderConfigurations',
        'GetVideoEncoderConfigurationOptions',
        'SetVideoEncoderConfiguration',
        'GetAudioSourceConfigurations',
        'GetAudioSourceConfigurationOptions',
        'SetAudioSourceConfiguration',
        'GetAudioEncoderConfigurations',
        'GetAudioEncoderConfigurationOptions',
        'SetAudioEncoderConfiguration',
        'GetAudioOutputConfigurations',
        'GetAudioOutputConfigurationOptions',
        'SetAudioOutputConfiguration',
        'GetAudioDecoderConfigurations',
        'GetAudioDecoderConfigurationOptions',
        'SetAudioDecoderConfiguration',
        'GetMulticastAudioDecoderConfigurations',
        'GetMulticastAudioDecoderConfigurationOptions',
        'SetMulticastAudioDecoderConfiguration',
        'GetMetadataConfigurations',
        'GetMetadataConfigurationOptions',
        'SetMetadataConfiguration',
        'GetAnalyticsConfigurations',
        'GetOSDs',
        'GetOSDOptions',
        'CreateOSD',
        'SetOSD',
        'DeleteOSD',
        'GetMasks',
        'GetMaskOptions',
        'CreateMask',
        'SetMask',
        'DeleteMask',
        'GetAudioClips',
        'AddAudioClip',
        'AddTTSAudioClip',
        'SetAudioClip',
        'DeleteAudioClip',
        'PlayAudioClip',
        'GetPlayingAudioClips',
        'SetEQPresetConfiguration',
        'GetWebRTCConfigurations',
        'SetWebRTCConfigurations'
      ]
    },
    namespaces: ['GetMetadataConfigurations'],
    substitutions: { FilterType: filters },
    prefixed: topicExpressions
  },
  {
    output: 'packages/ptz/source/generated/ptz.ts',
    client: {
      name: 'PTZClient',
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
        'SendAuxiliaryCommand',
        'GetCompatibleConfigurations',
        'GeoMove',
        'MoveAndStartTracking',
        'GetPresetTours',
        'GetPresetTour',
        'GetPresetTourOptions',
        'CreatePresetTour',
        'ModifyPresetTour',
        'OperatePresetTour',
        'RemovePresetTour'
      ]
    }
  },
  {
    output: 'packages/imaging/source/generated/imaging.ts',
    client: {
      name: 'ImagingClient',
      scoped: { name: 'ImagingVideoSourceClient', method: 'forVideoSource', field: 'VideoSourceToken' }
    },
    wsdl: 'ver20/imaging/wsdl/imaging.wsdl',
    optional: ['GetPresetsResponse.Preset'],
    operations: {
      ImagingPort: [
        'GetServiceCapabilities',
        'GetImagingSettings',
        'SetImagingSettings',
        'GetOptions',
        'Move',
        'GetMoveOptions',
        'Stop',
        'GetStatus',
        'GetPresets',
        'GetCurrentPreset',
        'SetCurrentPreset'
      ]
    }
  },
  {
    output: 'packages/recording/source/generated/recording.ts',
    client: {
      name: 'RecordingClient',
      scoped: { name: 'RecordingTokenClient', method: 'forRecording', field: 'RecordingToken' }
    },
    wsdl: 'ver10/recording.wsdl',
    operations: {
      RecordingPort: [
        'GetServiceCapabilities',
        'GetRecordings',
        'CreateRecording',
        'DeleteRecording',
        'GetRecordingConfiguration',
        'SetRecordingConfiguration',
        'GetRecordingOptions',
        'CreateTrack',
        'DeleteTrack',
        'GetTrackConfiguration',
        'SetTrackConfiguration',
        'GetRecordingJobs',
        'CreateRecordingJob',
        'DeleteRecordingJob',
        'GetRecordingJobConfiguration',
        'SetRecordingJobConfiguration',
        'SetRecordingJobMode',
        'GetRecordingJobState'
      ]
    }
  },
  {
    output: 'packages/recording/source/generated/search.ts',
    client: { name: 'SearchClient' },
    wsdl: 'ver10/search.wsdl',
    operations: {
      SearchPort: [
        'GetServiceCapabilities',
        'GetRecordingSummary',
        'GetRecordingInformation',
        'GetMediaAttributes',
        'FindRecordings',
        'GetRecordingSearchResults',
        'FindEvents',
        'GetEventSearchResults',
        'GetSearchState',
        'EndSearch'
      ]
    },
    namespaces: ['GetEventSearchResults'],
    optional: ['TrackInformation.DataFrom', 'TrackInformation.DataTo'],
    substitutions: {
      FilterType: filters,
      EventFilter: filters,
      NotificationMessageHolderTypeMessage: [{ namespace: tt, local: 'Message' }]
    },
    prefixed: topicExpressions
  },
  {
    output: 'packages/recording/source/generated/replay.ts',
    client: { name: 'ReplayClient' },
    wsdl: 'ver10/replay.wsdl',
    operations: {
      ReplayPort: ['GetServiceCapabilities', 'GetReplayUri', 'GetReplayConfiguration', 'SetReplayConfiguration']
    }
  },
  {
    output: 'packages/analytics/source/generated/analytics.ts',
    client: {
      name: 'AnalyticsClient',
      scoped: { name: 'AnalyticsConfigurationClient', method: 'forConfiguration', field: 'ConfigurationToken' }
    },
    wsdl: 'ver20/analytics/wsdl/analytics.wsdl',
    qnames: true,
    operations: {
      AnalyticsEnginePort: [
        'GetServiceCapabilities',
        'GetSupportedAnalyticsModules',
        'GetAnalyticsModules',
        'CreateAnalyticsModules',
        'ModifyAnalyticsModules',
        'DeleteAnalyticsModules',
        'GetAnalyticsModuleOptions',
        'GetSupportedMetadata'
      ],
      RuleEnginePort: ['GetSupportedRules', 'GetRules', 'CreateRules', 'ModifyRules', 'DeleteRules', 'GetRuleOptions']
    },
    substitutions: {
      ItemListElementItem: elementItems,
      ConfigOptions: [
        { namespace: tt, local: 'IntRange' },
        { namespace: tt, local: 'IntList' },
        { namespace: tt, local: 'FloatRange' },
        { namespace: tt, local: 'FloatList' },
        { namespace: tt, local: 'DurationRange' },
        { namespace: tt, local: 'StringList' },
        { namespace: tt, local: 'StringItems' },
        { namespace: tt, local: 'IntRectangleRange' },
        { schema: 'onvif/ver20/analytics/rules.xsd', namespace: axt, local: 'MotionRegionConfigOptions' }
      ]
    }
  },
  {
    output: 'packages/deviceio/source/generated/deviceio.ts',
    client: { name: 'DeviceIOClient' },
    wsdl: 'ver10/deviceio.wsdl',
    operations: {
      DeviceIOPort: [
        'GetServiceCapabilities',
        'GetRelayOutputOptions',
        'GetAudioSources',
        'GetAudioOutputs',
        'GetVideoSources',
        'GetVideoOutputs',
        'GetVideoSourceConfiguration',
        'GetVideoOutputConfiguration',
        'GetAudioSourceConfiguration',
        'GetAudioOutputConfiguration',
        'SetVideoSourceConfiguration',
        'SetVideoOutputConfiguration',
        'SetAudioSourceConfiguration',
        'SetAudioOutputConfiguration',
        'GetVideoSourceConfigurationOptions',
        'GetVideoOutputConfigurationOptions',
        'GetAudioSourceConfigurationOptions',
        'GetAudioOutputConfigurationOptions',
        'GetRelayOutputs',
        'SetRelayOutputSettings',
        'SetRelayOutputState',
        'GetDigitalInputs',
        'GetDigitalInputConfigurationOptions',
        'SetDigitalInputConfigurations',
        'GetSerialPorts',
        'GetSerialPortConfiguration',
        'SetSerialPortConfiguration',
        'GetSerialPortConfigurationOptions',
        'SendReceiveSerialCommand'
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
  const builder = new ModelBuilder(registry, target.qnames === true)
  const operations = Object.entries(target.operations ?? {}).flatMap(([portType, names]) => {
    const available = new Map(registry.operations(portType).map((operation) => [operation.name, operation]))
    return names.map((name) => {
      const operation = available.get(name)
      if (!operation) throw new Error(`Operation ${name} not found in ${portType} of ${target.wsdl}`)
      return builder.operation(operation)
    })
  })
  for (const path of target.optional ?? []) {
    const [owner, name] = path.split('.')
    const type =
      operations.find((operation) => operation.response.element.local === owner)?.response.type ??
      builder.complexTypes.find((model) => model.suggestedName === owner)
    const field = type?.fields.find((candidate) => candidate.name === name && !candidate.attribute)
    if (!field) throw new Error(`Element ${path} not found in ${target.wsdl}`)
    field.optional = true
  }
  for (const [typeName, substitutes] of Object.entries(target.substitutions ?? {})) {
    const models = builder.complexTypes.filter((model) => model.suggestedName === typeName)
    const [model] = models
    if (!model || models.length > 1) throw new Error(`Expected one type ${typeName} in ${target.output}`)
    for (const { schema, ...name } of substitutes) {
      if (schema) registry.load(join(specsDirectory, schema))
      builder.substitute(model, name)
    }
  }
  for (const typeName of target.prefixed ?? []) {
    const models = builder.complexTypes.filter((model) => model.suggestedName === typeName)
    if (models.length === 0 || models.some((model) => !model.text)) {
      throw new Error(`Expected types ${typeName} with text in ${target.output}`)
    }
    for (const model of models) if (model.text) model.text = { ...model.text, primitive: 'prefixed' }
  }
  const elements = (target.elements ?? []).map(({ schema, ...element }) => {
    registry.load(join(specsDirectory, schema))
    return builder.element(element)
  })
  const { codecImport, namespaces, client } = target
  return emit({
    commit,
    codecImport: codecImport ?? '@2bad/onvif/soap',
    operations,
    elements,
    namespaces: namespaces ?? [],
    client: client && { typesImport: '@2bad/onvif', ...client }
  })
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
