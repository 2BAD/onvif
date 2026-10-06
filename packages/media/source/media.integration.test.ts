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
})
