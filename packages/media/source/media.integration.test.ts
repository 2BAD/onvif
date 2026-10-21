import { Device } from '@2bad/onvif'
import { describe, expect, it } from 'vitest'
import {
  defaultProfile,
  fetchSnapshot,
  getProfiles,
  getSnapshotUri,
  getStreamUri,
  getVideoEncoderConfigurationOptions,
  getVideoEncoderConfigurations,
  setVideoEncoderConfiguration,
  getVideoSourceConfigurations,
  media
} from '#index.ts'

const hostname = process.env['ONVIF_TEST_HOST']
const username = process.env['ONVIF_TEST_USER']
const password = process.env['ONVIF_TEST_PASS']

describe.skipIf(!hostname)('Media on a live camera', () => {
  it('lists profiles, fetches a snapshot of the default profile and asks for its stream', async () => {
    const device = await Device.connect({
      hostname: hostname ?? '',
      username: username ?? '',
      password: password ?? ''
    })
    try {
      const profiles = await getProfiles(device)
      const profile = defaultProfile(profiles)
      if (!profile) throw new Error('The camera reported no profiles')
      expect(profile.videoEncoder).toBeDefined()

      const snapshot = await getSnapshotUri(device, profile)
      expect(snapshot.uri.origin).toBe(device.address.origin)
      const image = await fetchSnapshot(device, snapshot.uri)
      expect(image.length).toBeGreaterThan(1_000)

      const stream = await getStreamUri(device, profile)
      expect(stream.uri.protocol).toBe('rtsp:')
      expect(stream.uri.hostname).toBe(device.address.hostname)

      expect((await getVideoSourceConfigurations(device)).length).toBeGreaterThan(0)
      expect((await getVideoEncoderConfigurations(device)).map(({ service }) => service)).toContain(profile.service)
    } finally {
      device.close()
    }
  })

  it('calls every Media and Media2 operation through media.v1 and media.v2', async () => {
    const connected = await Device.connect({
      hostname: hostname ?? '',
      username: username ?? '',
      password: password ?? ''
    })
    const device = connected.use(media)
    try {
      const { v1, v2 } = device.media
      const { profiles: [profile] = [] } = await v1.getProfiles()
      if (!profile) throw new Error('The camera reported no Media profiles')
      const profileToken = profile.token
      const streamSetup = { stream: 'RTP-Unicast', transport: { protocol: 'RTSP' } }
      expect((await v1.getStreamUri({ profileToken, streamSetup })).mediaUri.uri).toMatch(/^rtsp:/)
      expect((await v1.getSnapshotUri({ profileToken })).mediaUri.uri).toMatch(/^https?:/)
      expect((await v1.getVideoSourceConfigurations()).configurations?.length).toBeGreaterThan(0)
      const { configurations: [encoder] = [] } = await v1.getVideoEncoderConfigurations()
      if (!encoder) throw new Error('The camera reported no Media encoder')
      expect(
        (await v1.getVideoEncoderConfigurationOptions({ configurationToken: encoder.token })).options
      ).toBeDefined()
      await v1.setVideoEncoderConfiguration({ configuration: encoder, forcePersistence: true })
      const { configurations: v1After = [] } = await v1.getVideoEncoderConfigurations()
      expect(v1After.find(({ token }) => token === encoder.token)).toEqual(encoder)

      if (!device.services.has('http://www.onvif.org/ver20/media/wsdl')) return
      const { profiles: [profile2] = [] } = await v2.getProfiles({ type: ['All'] })
      if (!profile2) throw new Error('The camera reported no Media2 profiles')
      expect((await v2.getStreamUri({ protocol: 'RTSP', profileToken: profile2.token })).uri).toMatch(/^rtsp:/)
      expect((await v2.getSnapshotUri({ profileToken: profile2.token })).uri).toMatch(/^https?:/)
      expect((await v2.getVideoSourceConfigurations()).configurations?.length).toBeGreaterThan(0)
      const { configurations: [encoder2] = [] } = await v2.getVideoEncoderConfigurations()
      if (!encoder2) throw new Error('The camera reported no Media2 encoder')
      expect(
        (await v2.getVideoEncoderConfigurationOptions({ configurationToken: encoder2.token })).options?.length
      ).toBeGreaterThan(0)
      await v2.setVideoEncoderConfiguration({ configuration: encoder2 })
      const { configurations: v2After = [] } = await v2.getVideoEncoderConfigurations()
      expect(v2After.find(({ token }) => token === encoder2.token)).toEqual(encoder2)
    } finally {
      device.close()
    }
  })

  it('reads the encoder options and sends the encoder configuration back unchanged', async () => {
    const device = await Device.connect({
      hostname: hostname ?? '',
      username: username ?? '',
      password: password ?? ''
    })
    try {
      const encoder = defaultProfile(await getProfiles(device))?.videoEncoder
      if (!encoder) throw new Error('The camera reported no encoder')
      const options = await getVideoEncoderConfigurationOptions(device, encoder)
      expect(options.map(({ encoding }) => encoding)).toContain(encoder.encoding)

      const sent = await setVideoEncoderConfiguration(device, encoder, {})
      const [read] = (await getVideoEncoderConfigurations(device)).filter(({ token }) => token === encoder.token)
      expect(read?.reported).toEqual(sent.reported)
    } finally {
      device.close()
    }
  })

  it('builds a Media profile from compatible configurations and deletes it', async () => {
    const connected = await Device.connect({
      hostname: hostname ?? '',
      username: username ?? '',
      password: password ?? ''
    })
    const { v1 } = connected.use(media).media
    const { profile } = await v1.createProfile({ name: 'onviftest' })
    const profileToken = profile.token
    let deleted = false
    try {
      const [source] = (await v1.getCompatibleVideoSourceConfigurations({ profileToken })).configurations ?? []
      if (!source) throw new Error('The camera reported no compatible video source configuration')
      await v1.addVideoSourceConfiguration({ profileToken, configurationToken: source.token })
      const [encoder] = (await v1.getCompatibleVideoEncoderConfigurations({ profileToken })).configurations ?? []
      if (!encoder) throw new Error('The camera reported no compatible video encoder configuration')
      await v1.addVideoEncoderConfiguration({ profileToken, configurationToken: encoder.token })
      const { profile: built } = await v1.getProfile({ profileToken })
      expect(built.videoSourceConfiguration?.token).toBe(source.token)
      expect(built.videoEncoderConfiguration?.token).toBe(encoder.token)
      await v1.removeVideoEncoderConfiguration({ profileToken })
      await v1.removeVideoSourceConfiguration({ profileToken })
      await v1.deleteProfile({ profileToken })
      deleted = true
      const { profiles = [] } = await v1.getProfiles()
      expect(profiles.map(({ token }) => token)).not.toContain(profileToken)
    } finally {
      if (!deleted) await v1.deleteProfile({ profileToken })
      connected.close()
    }
  })

  it('reads the Media2 metadata configuration and its options and sends it back unchanged', async () => {
    const connected = await Device.connect({
      hostname: hostname ?? '',
      username: username ?? '',
      password: password ?? ''
    })
    try {
      const { v2 } = connected.use(media).media
      const { configurations = [] } = await v2.getMetadataConfigurations()
      const [configuration] = configurations
      if (!configuration) throw new Error('The camera reported no metadata configuration')
      await v2.getMetadataConfigurationOptions({ configurationToken: configuration.token })
      const { profiles: [profile] = [] } = await v2.getProfiles()
      if (profile) await v2.getMetadataConfigurationOptions({ profileToken: profile.token })
      await v2.getAnalyticsConfigurations()
      await v2.setMetadataConfiguration({ configuration })
      expect((await v2.getMetadataConfigurations()).configurations).toEqual(configurations)
    } finally {
      connected.close()
    }
  })

  it('adds metadata and analytics configurations to a profile through Media2 and removes them', async () => {
    const connected = await Device.connect({
      hostname: hostname ?? '',
      username: username ?? '',
      password: password ?? ''
    })
    const { v1, v2 } = connected.use(media).media
    const { profile } = await v1.createProfile({ name: 'onviftest' })
    const profileToken = profile.token
    try {
      const [source] = (await v2.getVideoSourceConfigurations()).configurations ?? []
      const [metadata] = (await v2.getMetadataConfigurations()).configurations ?? []
      const [analytics] = (await v2.getAnalyticsConfigurations()).configurations ?? []
      const configuration = [
        source && { type: 'VideoSource', token: source.token },
        metadata && { type: 'Metadata', token: metadata.token },
        analytics && { type: 'Analytics', token: analytics.token }
      ].filter((entry) => entry !== undefined)
      await v2.addConfiguration({ profileToken, configuration })
      const [built] = (await v2.getProfiles({ token: profileToken, type: ['All'] })).profiles ?? []
      expect(built?.configurations?.metadata?.token).toBe(metadata?.token)
      expect(built?.configurations?.analytics?.token).toBe(analytics?.token)
      await v2.removeConfiguration({ profileToken, configuration: configuration.map(({ type }) => ({ type })) })
      const [emptied] = (await v2.getProfiles({ token: profileToken, type: ['All'] })).profiles ?? []
      expect(emptied?.configurations?.metadata).toBeUndefined()
    } finally {
      await v1.deleteProfile({ profileToken })
      connected.close()
    }
  })

  it('reads the video source modes, encoder instances, audio outputs and OSD options', async () => {
    const connected = await Device.connect({
      hostname: hostname ?? '',
      username: username ?? '',
      password: password ?? ''
    })
    try {
      const { v1, v2 } = connected.use(media).media
      const [source] = (await v1.getVideoSourceConfigurations()).configurations ?? []
      if (!source) throw new Error('The camera reported no video source configuration')
      const configurationToken = source.token
      await v1.getVideoSourceModes({ videoSourceToken: source.sourceToken })
      expect((await v1.getGuaranteedNumberOfVideoEncoderInstances({ configurationToken })).totalNumber).toBeGreaterThan(
        0
      )
      expect((await v1.getOSDOptions({ configurationToken })).osdOptions).toBeDefined()
      await v1.getOSDs({ configurationToken })
      await v1.getAudioOutputs()
      await v1.getAudioOutputConfigurations()
      await v1.getAudioDecoderConfigurations()
      await v1.getVideoAnalyticsConfigurations()

      if (!connected.services.has('http://www.onvif.org/ver20/media/wsdl')) return
      expect((await v2.getServiceCapabilities()).capabilities.profileCapabilities).toBeDefined()
      await v2.getVideoSourceModes({ videoSourceToken: source.sourceToken })
      expect((await v2.getVideoEncoderInstances({ configurationToken })).info.total).toBeGreaterThan(0)
      expect((await v2.getOSDOptions({ configurationToken })).osdOptions).toBeDefined()
      await v2.getOSDs({ configurationToken })
    } finally {
      connected.close()
    }
  })

  it('creates, changes and deletes a text OSD through Media and Media2', async () => {
    const connected = await Device.connect({
      hostname: hostname ?? '',
      username: username ?? '',
      password: password ?? ''
    })
    try {
      const { v1, v2 } = connected.use(media).media
      const [source] = (await v1.getVideoSourceConfigurations()).configurations ?? []
      if (!source) throw new Error('The camera reported no video source configuration')
      const { osdOptions } = await v1.getOSDOptions({ configurationToken: source.token })
      const [position = 'UpperLeft'] = osdOptions.positionOption ?? []
      const osd = {
        token: 'onviftest',
        videoSourceConfigurationToken: { value: source.token },
        type: 'Text',
        position: position === 'Custom' ? { type: position, pos: { x: 0, y: 0 } } : { type: position },
        textString: { type: 'Plain', plainText: 'onviftest' }
      }
      const clients = connected.services.has('http://www.onvif.org/ver20/media/wsdl') ? [v1, v2] : [v1]
      for (const client of clients) {
        const { osdToken } = await client.createOSD({ OSD: osd })
        try {
          await client.setOSD({
            OSD: { ...osd, token: osdToken, textString: { type: 'Plain', plainText: 'onviftest2' } }
          })
          const { osds = [] } = await client.getOSDs({ configurationToken: source.token })
          expect(osds.find(({ token }) => token === osdToken)?.textString?.plainText).toBe('onviftest2')
        } finally {
          await client.deleteOSD({ osdToken })
        }
        const { osds = [] } = await client.getOSDs({ configurationToken: source.token })
        expect(osds.map(({ token }) => token)).not.toContain(osdToken)
      }
    } finally {
      connected.close()
    }
  })

  it('sends the Media2 audio configurations back unchanged', async () => {
    const connected = await Device.connect({
      hostname: hostname ?? '',
      username: username ?? '',
      password: password ?? ''
    })
    try {
      if (!connected.services.has('http://www.onvif.org/ver20/media/wsdl')) return
      const { v2 } = connected.use(media).media
      const [audioSource] = (await v2.getAudioSourceConfigurations()).configurations ?? []
      if (audioSource) await v2.setAudioSourceConfiguration({ configuration: audioSource })
      const [audioEncoder] = (await v2.getAudioEncoderConfigurations()).configurations ?? []
      if (audioEncoder) await v2.setAudioEncoderConfiguration({ configuration: audioEncoder })
      const [audioOutput] = (await v2.getAudioOutputConfigurations()).configurations ?? []
      if (audioOutput) await v2.setAudioOutputConfiguration({ configuration: audioOutput })
      const [audioDecoder] = (await v2.getAudioDecoderConfigurations()).configurations ?? []
      if (audioDecoder) await v2.setAudioDecoderConfiguration({ configuration: audioDecoder })
      expect((await v2.getAudioOutputConfigurations()).configurations?.[0]).toEqual(audioOutput)
      expect((await v2.getAudioEncoderConfigurations()).configurations?.[0]).toEqual(audioEncoder)
    } finally {
      connected.close()
    }
  })
})
