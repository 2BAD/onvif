import { join } from 'node:path'
import { DecodeError, SoapFaultError } from '@2bad/onvif'
import { parseEnvelope, type XmlObject } from '@2bad/onvif/soap'
import { describe, expect, it } from 'vitest'
import { capturesOf, decodeCapture, operationsOf } from '../../../tools/fixtures/corpus.ts'
import {
  answer,
  cam,
  connectMock,
  dahua,
  hik,
  rawRequestOf,
  rejection,
  requestOf,
  simulator
} from '../../../tools/mock-camera/harness.ts'
import type { MockCameraOptions } from '../../../tools/mock-camera/server.ts'
import { media, Media2 } from '#index.ts'

const connect = async (options?: MockCameraOptions) => {
  const { mock, device } = await connectMock(options)
  return { mock, v2: device.use(media).media.v2 }
}

const operations = operationsOf(Media2)

const topics = 'http://www.onvif.org/ver10/topics'
const concreteSet = 'http://www.onvif.org/ver10/tev/topicExpression/ConcreteSet'

const ezviz = join(import.meta.dirname, '../../../fixtures/live/ezviz/ds-2de2c400ig-w-w')

const envelope = (body: string): string =>
  '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tt="http://www.onvif.org/ver10/schema" ' +
  `xmlns:tr2="http://www.onvif.org/ver20/media/wsdl"><s:Body>${body}</s:Body></s:Envelope>`

// the DCN-BM2220LPR answers with xsi:nil for the required options
const nilMaskOptions = 'live/dvc/dcn-bm2220lpr/media2.GetMaskOptions.xml'

// operations that no lab camera answers with a result
const withoutCapture = [
  'SetVideoSourceMode',
  'GetMulticastAudioDecoderConfigurations',
  'GetMulticastAudioDecoderConfigurationOptions',
  'SetMulticastAudioDecoderConfiguration',
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

describe('generated media2 operations', () => {
  const fixtures = capturesOf('media2', operations)

  it('cover a camera capture for every operation a camera answers', () => {
    const captured = new Set(
      fixtures.filter(({ name }) => name.startsWith('live/')).map(({ operation }) => operation.name)
    )
    expect(operations.map(({ name }) => name).filter((name) => !captured.has(name))).toEqual(withoutCapture)
  })

  it('parse only the metadata configurations with namespaces', () => {
    expect(operations.filter((operation) => operation.namespaces === true).map(({ name }) => name)).toEqual([
      'GetMetadataConfigurations'
    ])
  })

  it.each(fixtures.filter(({ name }) => !name.endsWith(nilMaskOptions)).map((entry) => [entry.name, entry] as const))(
    'decode %s',
    (_name, capture) => {
      expect(() => decodeCapture(capture)).not.toThrow()
    }
  )
})

describe('media.v2 configurations', () => {
  it('has a method for every operation', async () => {
    const { v2 } = await connect()
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(v2)).filter((name) => name !== 'constructor')
    expect(methods.toSorted()).toEqual(
      operations.map(({ name }) => `${name.charAt(0).toLowerCase()}${name.slice(1)}`).toSorted()
    )
  })

  it('adds a metadata and an analytics configuration to a profile and removes them again', async () => {
    const { mock, v2 } = await connect()
    const [metadata] = (await v2.getMetadataConfigurations()).configurations ?? []
    const [analytics] = (await v2.getAnalyticsConfigurations()).configurations ?? []
    const profileToken = 'profile1'
    const configuration = [
      { type: 'Metadata', token: metadata?.token ?? '' },
      { type: 'Analytics', token: analytics?.token ?? '' }
    ]
    await expect(v2.addConfiguration({ profileToken, configuration })).resolves.toEqual({})
    await expect(
      v2.removeConfiguration({ profileToken, configuration: [{ type: 'Metadata' }, { type: 'Analytics' }] })
    ).resolves.toEqual({})
    expect(requestOf(mock, 'AddConfiguration')).toEqual({
      AddConfiguration: {
        ProfileToken: profileToken,
        Configuration: [
          { Type: 'Metadata', Token: 'Metadata_token_1' },
          { Type: 'Analytics', Token: 'VideoAnalytics0' }
        ]
      }
    })
    expect(rawRequestOf(mock, 'RemoveConfiguration')).toContain(
      '<tr2:RemoveConfiguration xmlns:tr2="http://www.onvif.org/ver20/media/wsdl"><tr2:ProfileToken>profile1' +
        '</tr2:ProfileToken><tr2:Configuration><tr2:Type>Metadata</tr2:Type></tr2:Configuration><tr2:Configuration>' +
        '<tr2:Type>Analytics</tr2:Type></tr2:Configuration></tr2:RemoveConfiguration>'
    )
  })

  it('reads the metadata options for a configuration or a profile', async () => {
    const { mock, v2 } = await connect()
    const { options } = await v2.getMetadataConfigurationOptions({ profileToken: 'profile1' })
    expect(options.ptzStatusFilterOptions).toEqual({
      panTiltStatusSupported: false,
      zoomStatusSupported: true,
      panTiltPositionSupported: false,
      zoomPositionSupported: true
    })
    expect(requestOf(mock, 'GetMetadataConfigurationOptions')).toEqual({
      GetMetadataConfigurationOptions: { ProfileToken: 'profile1' }
    })
  })

  it('sends a metadata configuration back exactly as the camera reported it', async () => {
    const { mock, v2 } = await connect()
    const [configuration] = (await v2.getMetadataConfigurations()).configurations ?? []
    if (!configuration) throw new Error('no metadata configuration')
    await v2.setMetadataConfiguration({ configuration })
    const reported = parseEnvelope(cam('media2.GetMetadataConfigurations')).body
    expect(requestOf(mock, 'SetMetadataConfiguration')).toEqual({
      SetMetadataConfiguration: {
        Configuration: (reported['GetMetadataConfigurationsResponse'] as XmlObject)['Configurations']
      }
    })
  })

  it('reads the analytics modules and rules of an analytics configuration', async () => {
    const { v2 } = await connect()
    const [configuration] = (await v2.getAnalyticsConfigurations()).configurations ?? []
    expect(configuration?.analyticsEngineConfiguration?.analyticsModule?.map(({ name, type }) => [name, type])).toEqual(
      [['CellMotionModule', 'tt:CellMotionEngine']]
    )
    expect(configuration?.ruleEngineConfiguration?.rule?.map(({ name, type }) => [name, type])).toEqual([
      ['MotionDetectorRule0', 'tt:CellMotionDetector']
    ])
  })
})

describe('media.v2 metadata event filters', () => {
  const dahuaMetadata = () =>
    connect({ overrides: { 'media2.GetMetadataConfigurations': answer(dahua('media2.GetMetadataConfigurations')) } })

  it('reads the topic expression of the event filter', async () => {
    const { v2 } = await dahuaMetadata()
    const [configuration] = (await v2.getMetadataConfigurations()).configurations ?? []
    expect(configuration?.events?.filter?.topicExpression).toEqual([
      { dialect: concreteSet, value: 'tns1:RuleEngine/CellMotionDetector/Motion' }
    ])
  })

  it('sends the event filter back with its topic namespace declared', async () => {
    const { mock, v2 } = await dahuaMetadata()
    const [configuration] = (await v2.getMetadataConfigurations()).configurations ?? []
    if (!configuration) throw new Error('no metadata configuration')
    await v2.setMetadataConfiguration({ configuration })
    const raw = rawRequestOf(mock, 'SetMetadataConfiguration')
    expect(raw).toContain(
      `<tt:Events><tt:Filter><wsnt:TopicExpression Dialect="${concreteSet}">` +
        'tns1:RuleEngine/CellMotionDetector/Motion</wsnt:TopicExpression></tt:Filter></tt:Events>'
    )
    expect(raw).toContain(`xmlns:tns1="${topics}"`)
    expect(raw).toContain('xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2"')
  })

  it('reads a topic prefix the device picked as tns1', async () => {
    const xml = dahua('media2.GetMetadataConfigurations')
      .replace(`xmlns:tns1="${topics}"`, `xmlns:ev="${topics}"`)
      .replace('>tns1:RuleEngine', '>ev:RuleEngine')
    const { v2 } = await connect({ overrides: { 'media2.GetMetadataConfigurations': answer(xml) } })
    const [configuration] = (await v2.getMetadataConfigurations()).configurations ?? []
    expect(configuration?.events?.filter?.topicExpression?.[0]?.value).toBe('tns1:RuleEngine/CellMotionDetector/Motion')
  })

  it('sends a topic in a vendor namespace with its namespace declared', async () => {
    const { mock, v2 } = await connect()
    const [configuration] = (await v2.getMetadataConfigurations()).configurations ?? []
    if (!configuration) throw new Error('no metadata configuration')
    const value = '{urn:example:vendor}Zone/Intrusion|tns1:VideoSource/MotionAlarm'
    await v2.setMetadataConfiguration({
      configuration: { ...configuration, events: { filter: { topicExpression: [{ dialect: concreteSet, value }] } } }
    })
    const raw = rawRequestOf(mock, 'SetMetadataConfiguration')
    const prefix = /(\w+):Zone\/Intrusion/.exec(raw)?.[1] ?? ''
    expect(raw).toContain(`xmlns:${prefix}="urn:example:vendor"`)
    expect(raw).toContain(`>${prefix}:Zone/Intrusion|tns1:VideoSource/MotionAlarm</wsnt:TopicExpression>`)
  })

  it('rejects a topic with a prefix it cannot declare before sending anything', async () => {
    const { mock, v2 } = await connect()
    const [configuration] = (await v2.getMetadataConfigurations()).configurations ?? []
    if (!configuration) throw new Error('no metadata configuration')
    const filter = { topicExpression: [{ dialect: concreteSet, value: 'hik:Zone' }] }
    await expect(
      v2.setMetadataConfiguration({ configuration: { ...configuration, events: { filter } } })
    ).rejects.toThrow(
      'Unknown prefix hik at SetMetadataConfiguration.configuration.events.filter.topicExpression[0].value'
    )
    expect(mock.requests.some(({ action }) => action === 'SetMetadataConfiguration')).toBe(false)
  })

  it('keeps the topic of a profile read without namespaces as the device sent it', async () => {
    const { v2 } = await connect({ overrides: { 'media2.GetProfiles': answer(dahua('media2.GetProfiles')) } })
    const { profiles = [] } = await v2.getProfiles({ type: ['All'] })
    const filters = profiles.flatMap(
      ({ configurations }) => configurations?.metadata?.events?.filter?.topicExpression ?? []
    )
    expect(filters.map(({ value }) => value)).toEqual(filters.map(() => 'tns1:RuleEngine/CellMotionDetector/Motion'))
  })
})

describe('media.v2 on the Dahua DHI-ITC413-PW4D-Z1', () => {
  it('reports a configuration that does not exist, sent with HTTP 200, as a SOAP fault', async () => {
    const { v2 } = await connect({
      overrides: { 'media2.GetMetadataConfigurations': answer(dahua('media2.GetMetadataConfigurationsMissingFault')) }
    })
    const error = await rejection(() => v2.getMetadataConfigurations({ configurationToken: 'missing' }))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: ['InvalidArgVal', 'NoConfig'], action: 'GetMetadataConfigurations' })
  })
})

describe('media.v2 on the Hikvision DS-2DE2C400IG-W-W', () => {
  it('reads a metadata configuration without events and with an empty analytics engine', async () => {
    const { v2 } = await connect({
      overrides: { 'media2.GetMetadataConfigurations': answer(hik('media2.GetMetadataConfigurations')) }
    })
    const [configuration] = (await v2.getMetadataConfigurations()).configurations ?? []
    expect(configuration).toMatchObject({
      token: 'MetaDataToken',
      geoLocation: false,
      ptzStatus: { status: false, position: false },
      sessionTimeout: 'PT5S',
      analyticsEngineConfiguration: {}
    })
    expect(configuration?.events).toBeUndefined()
  })

  it('reports a configuration that does not exist as a SOAP fault with its subcodes', async () => {
    const { v2 } = await connect({
      overrides: {
        'media2.GetMetadataConfigurations': answer(hik('media2.GetMetadataConfigurationsMissingFault'), 500)
      }
    })
    const error = await rejection(() => v2.getMetadataConfigurations({ configurationToken: 'missing' }))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({
      subcodes: ['InvalidArgVal', 'NoConfig'],
      service: 'tr2',
      action: 'GetMetadataConfigurations'
    })
  })
})

describe('media.v2 profiles and sources', () => {
  it('reads the service capabilities, video source modes and encoder instances', async () => {
    const { v2 } = await connect()
    const { capabilities } = await v2.getServiceCapabilities()
    expect(capabilities).toMatchObject({ OSD: true, mask: false, videoSourceMode: true, snapshotUri: true })
    expect(capabilities.profileCapabilities.configurationsSupported).toContain('AudioDecoder')
    const { videoSourceModes = [] } = await v2.getVideoSourceModes({ videoSourceToken: 'VideoSource_1' })
    expect(videoSourceModes.map(({ token, enabled }) => [token, enabled])).toEqual([
      ['NTSC', false],
      ['PAL', true]
    ])
    const { info } = await v2.getVideoEncoderInstances({ configurationToken: 'VideoSource_token_1' })
    expect(info).toEqual({
      codec: [
        { encoding: 'H264', number: 3 },
        { encoding: 'H265', number: 3 },
        { encoding: 'JPEG', number: 2 }
      ],
      total: 3
    })
  })

  it('reads an empty list of video source modes', async () => {
    const { v2 } = await connect({ fixtureDirectory: ezviz })
    expect(await v2.getVideoSourceModes({ videoSourceToken: 'VideoSource_1' })).toEqual({})
  })

  it('creates a profile, streams it to its multicast address, sets a synchronization point and deletes it', async () => {
    const { mock, v2 } = await connect()
    const { token: profileToken } = await v2.createProfile({ name: 'onviftest' })
    await expect(v2.startMulticastStreaming({ profileToken })).resolves.toEqual({})
    await expect(v2.stopMulticastStreaming({ profileToken })).resolves.toEqual({})
    await expect(v2.setSynchronizationPoint({ profileToken })).resolves.toEqual({})
    await expect(v2.deleteProfile({ token: profileToken })).resolves.toEqual({})
    expect(requestOf(mock, 'StartMulticastStreaming')).toEqual({
      StartMulticastStreaming: { ProfileToken: profileToken }
    })
    expect(requestOf(mock, 'SetSynchronizationPoint')).toEqual({
      SetSynchronizationPoint: { ProfileToken: profileToken }
    })
  })
})

describe('media.v2 configurations', () => {
  const kinds = ['VideoSource', 'AudioSource', 'AudioEncoder', 'AudioOutput', 'AudioDecoder'] as const

  it.each(kinds)('sends a %s configuration back exactly as the camera reported it', async (kind) => {
    const { mock, v2 } = await connect()
    const get = v2[`get${kind}Configurations`].bind(v2) as () => Promise<{ configurations?: never[] }>
    const set = v2[`set${kind}Configuration`].bind(v2) as (request: { configuration: never }) => Promise<unknown>
    const [configuration] = (await get()).configurations ?? []
    if (!configuration) throw new Error(`no ${kind} configuration`)
    await expect(set({ configuration })).resolves.toEqual({})
    const reported = parseEnvelope(cam(`media2.Get${kind}Configurations`)).body
    const [first] = [(reported[`Get${kind}ConfigurationsResponse`] as XmlObject)['Configurations']].flat()
    expect(requestOf(mock, `Set${kind}Configuration`)).toEqual({
      [`Set${kind}Configuration`]: { Configuration: first }
    })
  })

  it('reads the options of each audio configuration kind', async () => {
    const { mock, v2 } = await connect()
    const configurationToken = 'any'
    const { options: source } = await v2.getAudioSourceConfigurationOptions({ configurationToken })
    expect(source.inputTokensAvailable.length).toBeGreaterThan(0)
    const { options: encoder = [] } = await v2.getAudioEncoderConfigurationOptions({ configurationToken })
    expect(encoder.map(({ encoding }) => encoding).length).toBeGreaterThan(0)
    const { options: output } = await v2.getAudioOutputConfigurationOptions({ configurationToken })
    expect(output.outputTokensAvailable).toEqual(['AudioOutput_token_1'])
    const { options: decoder } = await v2.getAudioDecoderConfigurationOptions({ configurationToken })
    expect(decoder).toBeDefined()
    const { options: videoSource } = await v2.getVideoSourceConfigurationOptions({ configurationToken })
    expect(videoSource.boundsRange.widthRange.max).toBeGreaterThan(0)
    expect(requestOf(mock, 'GetAudioDecoderConfigurationOptions')).toEqual({
      GetAudioDecoderConfigurationOptions: { ConfigurationToken: 'any' }
    })
  })
})

describe('media.v2 OSDs and masks', () => {
  it('creates, changes and deletes a text OSD', async () => {
    const { mock, v2 } = await connect()
    const { osds = [] } = await v2.getOSDs({ configurationToken: 'VideoSource_token_1' })
    expect(osds.map(({ token }) => token)).toEqual(['OSD_DATE_TIME', 'OSD_DEVICE_NAME'])
    const { osdOptions } = await v2.getOSDOptions({ configurationToken: 'VideoSource_token_1' })
    expect(osdOptions.positionOption).toEqual(['Custom'])
    const osd = {
      token: 'onviftest',
      videoSourceConfigurationToken: { value: 'VideoSource_token_1' },
      type: 'Text',
      position: { type: 'Custom', pos: { x: 0, y: 0 } },
      textString: { type: 'Plain', plainText: 'onviftest' }
    }
    const { osdToken } = await v2.createOSD({ OSD: osd })
    await expect(v2.setOSD({ OSD: { ...osd, token: osdToken } })).resolves.toEqual({})
    await expect(v2.deleteOSD({ osdToken })).resolves.toEqual({})
    expect(rawRequestOf(mock, 'CreateOSD')).toContain(
      '<tr2:OSD token="onviftest"><tt:VideoSourceConfigurationToken>VideoSource_token_1'
    )
    expect(requestOf(mock, 'DeleteOSD')).toEqual({ DeleteOSD: { OSDToken: 'OSD_ITEM_0' } })
  })

  it('creates, reads, changes and deletes a privacy mask', async () => {
    const fromSimulator = (action: string, name = action) => [`media2.${action}`, answer(simulator(`media2.${name}`))]
    const { mock, v2 } = await connect({
      overrides: Object.fromEntries([
        fromSimulator('GetMaskOptions'),
        fromSimulator('CreateMask'),
        fromSimulator('GetMasks', 'GetMasksCreated'),
        fromSimulator('SetMask'),
        fromSimulator('DeleteMask')
      ])
    })
    const { options } = await v2.getMaskOptions({ configurationToken: 'VideoSourceConfigurationToken_1' })
    expect(options).toMatchObject({ maxMasks: 10, maxPoints: 10, types: ['Color', 'Pixelated', 'Blurred'] })
    const mask = {
      configurationToken: 'VideoSourceConfigurationToken_1',
      polygon: {
        point: [
          { x: 0, y: 0 },
          { x: 0, y: 0.1 },
          { x: 0.1, y: 0.1 },
          { x: 0.1, y: 0 }
        ]
      },
      type: 'Color',
      enabled: false
    }
    const { token } = await v2.createMask({ mask })
    const [created] = (await v2.getMasks({ token })).masks ?? []
    expect(created).toEqual({ ...mask, token: 'MaskToken_1' })
    await expect(v2.setMask({ mask: { ...mask, token, enabled: true } })).resolves.toEqual({})
    await expect(v2.deleteMask({ token })).resolves.toEqual({})
    expect(rawRequestOf(mock, 'CreateMask')).toContain(
      '<tr2:Mask><tr2:ConfigurationToken>VideoSourceConfigurationToken_1</tr2:ConfigurationToken><tr2:Polygon>' +
        '<tt:Point x="0" y="0"/><tt:Point x="0" y="0.1"/><tt:Point x="0.1" y="0.1"/><tt:Point x="0.1" y="0"/>' +
        '</tr2:Polygon><tr2:Type>Color</tr2:Type><tr2:Enabled>false</tr2:Enabled></tr2:Mask>'
    )
    expect(requestOf(mock, 'SetMask')).toMatchObject({
      SetMask: { Mask: { $: { token: 'MaskToken_1' }, Enabled: 'true' } }
    })
  })
})

describe('media.v2 audio clips, multicast audio decoders, EQ presets and WebRTC', () => {
  const clip = { enabled: true, name: 'chime', type: 'G711', repeatCycles: 1, audioOutputToken: ['AudioOutput_1'] }
  const clipXml =
    '<tr2:Enabled>true</tr2:Enabled><tr2:Name>chime</tr2:Name><tr2:AudioOutputToken>AudioOutput_1</tr2:AudioOutputToken>' +
    '<tr2:Type>G711</tr2:Type><tr2:RepeatCycles>1</tr2:RepeatCycles>'
  const multicast = {
    address: { type: 'IPv4', ipv4Address: '239.0.0.3' },
    port: 5004,
    TTL: 4
  }
  const decoder = {
    name: 'Intercom',
    useCount: 1,
    token: 'MulticastAudioDecoder_1',
    enable: true,
    audioOutputToken: ['AudioOutput_1'],
    encoding: 'PCMU',
    bitrate: 64,
    samplingRate: 8,
    multicast,
    rtpPayloadType: 0,
    priority: 1
  }
  const decoderXml =
    '<tt:Name>Intercom</tt:Name><tt:UseCount>1</tt:UseCount><tt:Enable>true</tt:Enable>' +
    '<tt:AudioOutputToken>AudioOutput_1</tt:AudioOutputToken><tt:Encoding>PCMU</tt:Encoding><tt:Bitrate>64</tt:Bitrate>' +
    '<tt:SamplingRate>8</tt:SamplingRate><tt:Multicast><tt:Address><tt:Type>IPv4</tt:Type>' +
    '<tt:IPv4Address>239.0.0.3</tt:IPv4Address></tt:Address><tt:Port>5004</tt:Port><tt:TTL>4</tt:TTL></tt:Multicast>' +
    '<tt:RTPPayloadType>0</tt:RTPPayloadType><tt:Priority>1</tt:Priority>'
  const preset = {
    token: 'EQPreset_1',
    name: 'Speech',
    isDefault: false,
    isFrequencyDecibelEditable: true,
    frequencyDecibelPair: [{ centerFrequency: 1000, decibel: -3 }]
  }
  const webRtc = {
    signalingServer: 'wss://signaling.example.com/onvif',
    authorizationServer: 'AuthorizationServer_1',
    defaultProfile: 'Profile_1',
    enabled: true,
    connected: false
  }
  const webRtcXml =
    '<tr2:WebRTCConfiguration><tr2:SignalingServer>wss://signaling.example.com/onvif</tr2:SignalingServer>' +
    '<tr2:AuthorizationServer>AuthorizationServer_1</tr2:AuthorizationServer>' +
    '<tr2:DefaultProfile>Profile_1</tr2:DefaultProfile><tr2:Enabled>true</tr2:Enabled>' +
    '<tr2:Connected>false</tr2:Connected></tr2:WebRTCConfiguration>'

  const cases: { method: string; request: object; response: string; result: unknown; sent: string }[] = [
    {
      method: 'getAudioClips',
      request: {},
      response: `<tr2:GetAudioClipsResponse><tr2:AudioClipItem><tr2:Token>Clip_1</tr2:Token><tr2:Configuration>${clipXml}</tr2:Configuration></tr2:AudioClipItem></tr2:GetAudioClipsResponse>`,
      result: { audioClipItem: [{ token: 'Clip_1', configuration: clip }] },
      sent: '<tr2:GetAudioClips xmlns:tr2="http://www.onvif.org/ver20/media/wsdl"/>'
    },
    {
      method: 'addAudioClip',
      request: { configuration: clip },
      response:
        '<tr2:AddAudioClipResponse><tr2:Token>Clip_1</tr2:Token><tr2:UploadUri>http://camera/upload/Clip_1</tr2:UploadUri>' +
        '<tr2:ExpiryTime>2026-10-21T12:00:00Z</tr2:ExpiryTime></tr2:AddAudioClipResponse>',
      result: {
        token: 'Clip_1',
        uploadUri: 'http://camera/upload/Clip_1',
        expiryTime: new Date('2026-10-21T12:00:00Z')
      },
      sent: `<tr2:Configuration>${clipXml}</tr2:Configuration></tr2:AddAudioClip>`
    },
    {
      method: 'addTTSAudioClip',
      request: { configuration: clip, ttsConfiguration: { content: 'Hello', language: 'en', voiceType: 'Female' } },
      response: '<tr2:AddTTSAudioClipResponse><tr2:Token>Clip_2</tr2:Token></tr2:AddTTSAudioClipResponse>',
      result: { token: 'Clip_2' },
      sent:
        '<tr2:TTSConfiguration><tr2:Content>Hello</tr2:Content><tr2:Language>en</tr2:Language>' +
        '<tr2:VoiceType>Female</tr2:VoiceType></tr2:TTSConfiguration></tr2:AddTTSAudioClip>'
    },
    {
      method: 'setAudioClip',
      request: { token: 'Clip_1', configuration: clip },
      response: '<tr2:SetAudioClipResponse/>',
      result: {},
      sent: `<tr2:Token>Clip_1</tr2:Token><tr2:Configuration>${clipXml}</tr2:Configuration>`
    },
    {
      method: 'playAudioClip',
      request: { token: 'Clip_1', audioOutputToken: ['AudioOutput_1'], play: true, repeatCycles: 2 },
      response: '<tr2:PlayAudioClipResponse/>',
      result: {},
      sent:
        '<tr2:Token>Clip_1</tr2:Token><tr2:AudioOutputToken>AudioOutput_1</tr2:AudioOutputToken>' +
        '<tr2:Play>true</tr2:Play><tr2:RepeatCycles>2</tr2:RepeatCycles>'
    },
    {
      method: 'getPlayingAudioClips',
      request: {},
      response:
        '<tr2:GetPlayingAudioClipsResponse><tr2:PlayingAudioClips><tr2:Token>Clip_1</tr2:Token><tr2:Name>chime</tr2:Name>' +
        '<tr2:AudioOutputToken>AudioOutput_1</tr2:AudioOutputToken><tr2:AudioOutputLevel>5</tr2:AudioOutputLevel>' +
        '<tr2:RepeatsLeft>1</tr2:RepeatsLeft></tr2:PlayingAudioClips></tr2:GetPlayingAudioClipsResponse>',
      result: {
        playingAudioClips: [
          { token: 'Clip_1', name: 'chime', audioOutputToken: ['AudioOutput_1'], audioOutputLevel: 5, repeatsLeft: 1 }
        ]
      },
      sent: '<tr2:GetPlayingAudioClips xmlns:tr2="http://www.onvif.org/ver20/media/wsdl"/>'
    },
    {
      method: 'deleteAudioClip',
      request: { token: 'Clip_1' },
      response: '<tr2:DeleteAudioClipResponse/>',
      result: {},
      sent: '<tr2:Token>Clip_1</tr2:Token></tr2:DeleteAudioClip>'
    },
    {
      method: 'getMulticastAudioDecoderConfigurations',
      request: {},
      response: `<tr2:GetMulticastAudioDecoderConfigurationsResponse><tr2:Configurations token="MulticastAudioDecoder_1">${decoderXml}</tr2:Configurations></tr2:GetMulticastAudioDecoderConfigurationsResponse>`,
      result: { configurations: [decoder] },
      sent: '<tr2:GetMulticastAudioDecoderConfigurations xmlns:tr2="http://www.onvif.org/ver20/media/wsdl"/>'
    },
    {
      method: 'getMulticastAudioDecoderConfigurationOptions',
      request: { configurationToken: 'MulticastAudioDecoder_1' },
      response:
        '<tr2:GetMulticastAudioDecoderConfigurationOptionsResponse><tr2:Options><tt:EncodingOptions>' +
        '<tt:Encoding>PCMU</tt:Encoding><tt:BitrateList><tt:Items>64</tt:Items></tt:BitrateList>' +
        '<tt:SampleRateList><tt:Items>8</tt:Items></tt:SampleRateList></tt:EncodingOptions>' +
        '<tt:PriorityRange><tt:Min>0</tt:Min><tt:Max>10</tt:Max></tt:PriorityRange></tr2:Options>' +
        '</tr2:GetMulticastAudioDecoderConfigurationOptionsResponse>',
      result: {
        options: [
          {
            encodingOptions: { encoding: 'PCMU', bitrateList: { items: [64] }, sampleRateList: { items: [8] } },
            priorityRange: { min: 0, max: 10 }
          }
        ]
      },
      sent: '<tr2:ConfigurationToken>MulticastAudioDecoder_1</tr2:ConfigurationToken>'
    },
    {
      method: 'setMulticastAudioDecoderConfiguration',
      request: { configuration: decoder },
      response: '<tr2:SetMulticastAudioDecoderConfigurationResponse/>',
      result: {},
      sent: `<tr2:Configuration token="MulticastAudioDecoder_1">${decoderXml}</tr2:Configuration>`
    },
    {
      method: 'setEQPresetConfiguration',
      request: { configuration: preset },
      response: '<tr2:SetEQPresetConfigurationResponse/>',
      result: {},
      sent:
        '<tr2:Configuration><tt:Token>EQPreset_1</tt:Token><tt:Name>Speech</tt:Name><tt:isDefault>false</tt:isDefault>' +
        '<tt:isFrequencyDecibelEditable>true</tt:isFrequencyDecibelEditable><tt:FrequencyDecibelPair>' +
        '<tt:CenterFrequency>1000</tt:CenterFrequency><tt:Decibel>-3</tt:Decibel></tt:FrequencyDecibelPair></tr2:Configuration>'
    },
    {
      method: 'getWebRTCConfigurations',
      request: {},
      response: `<tr2:GetWebRTCConfigurationsResponse>${webRtcXml}</tr2:GetWebRTCConfigurationsResponse>`,
      result: { webRTCConfiguration: [webRtc] },
      sent: '<tr2:GetWebRTCConfigurations xmlns:tr2="http://www.onvif.org/ver20/media/wsdl"/>'
    },
    {
      method: 'setWebRTCConfigurations',
      request: { webRTCConfiguration: [webRtc] },
      response: '<tr2:SetWebRTCConfigurationsResponse/>',
      result: {},
      sent: webRtcXml
    },
    {
      method: 'setVideoSourceMode',
      request: { videoSourceToken: 'VideoSource_1', videoSourceModeToken: 'PAL' },
      response: '<tr2:SetVideoSourceModeResponse><tr2:Reboot>false</tr2:Reboot></tr2:SetVideoSourceModeResponse>',
      result: { reboot: false },
      sent: '<tr2:VideoSourceToken>VideoSource_1</tr2:VideoSourceToken><tr2:VideoSourceModeToken>PAL</tr2:VideoSourceModeToken>'
    }
  ]

  it('has a case for every operation without a camera capture', () => {
    expect(cases.map(({ method }) => `${method.charAt(0).toUpperCase()}${method.slice(1)}`).toSorted()).toEqual(
      withoutCapture.filter((name) => !['SetMask', 'DeleteMask'].includes(name)).toSorted()
    )
  })

  it.each(cases.map((entry) => [entry.method, entry] as const))(
    '%s',
    async (method, { request, response, result, sent }) => {
      const action = `${method.charAt(0).toUpperCase()}${method.slice(1)}`
      const { mock, v2 } = await connect({ overrides: { [`media2.${action}`]: answer(envelope(response)) } })
      const call = v2[method as keyof typeof v2] as (request: object) => Promise<unknown>
      await expect(call.call(v2, request)).resolves.toEqual(result)
      expect(rawRequestOf(mock, action)).toContain(sent)
    }
  )
})

describe('media.v2 on the DCN-BM2220LPR', () => {
  it('reads the nil token of a mask the camera did not create as an empty token', async () => {
    const { v2 } = await connect()
    const mask = { configurationToken: 'VideoSource_token_1', polygon: { point: [] }, type: 'Color', enabled: false }
    await expect(v2.createMask({ mask })).resolves.toEqual({ token: '' })
  })

  it('rejects the nil mask options with the path of the element', async () => {
    const { v2 } = await connect()
    const error = await rejection(() => v2.getMaskOptions({ configurationToken: 'VideoSource_token_1' }))
    expect(error).toBeInstanceOf(DecodeError)
    expect(error).toMatchObject({ path: 'GetMaskOptionsResponse.Options', action: 'GetMaskOptions' })
  })

  it('reports the audio clip calls it does not implement as a SOAP fault', async () => {
    const { v2 } = await connect()
    const error = await rejection(() => v2.getAudioClips({}))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ action: 'GetAudioClips', service: 'tr2' })
  })
})

describe('media.v2 masks on the Hikvision DS-2DE2C400IG-W-W', () => {
  it('reports masks as an action it does not support', async () => {
    const { v2 } = await connect({ fixtureDirectory: ezviz })
    const error = await rejection(() => v2.getMasks({}))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: ['ActionNotSupported', 'InvalidOperation'], action: 'GetMasks' })
  })
})
