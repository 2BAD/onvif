import { Device } from '@2bad/onvif'
import { describe, expect, it } from 'vitest'
import {
  defaultProfile,
  fetchSnapshot,
  getProfiles,
  getSnapshotUri,
  getStreamUri,
  getVideoEncoderConfigurations,
  getVideoSourceConfigurations
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
})
