import { describe, expect, it } from 'vitest'
import { Onvif } from './onvif.ts'

const host = process.env.ONVIF_TEST_HOST
const username = process.env.ONVIF_TEST_USER
const password = process.env.ONVIF_TEST_PASS

const connect = async (): Promise<Onvif> => {
  if (!host) throw new Error('ONVIF_TEST_HOST is not set')
  const cam = new Onvif({ hostname: host, username, password })
  await cam.connect()
  return cam
}

let camPromise: Promise<Onvif> | undefined
const getCam = (): Promise<Onvif> => (camPromise ??= connect())

describe.skipIf(!host)('Onvif (live device)', () => {
  it('populates device information during connect()', async () => {
    const cam = await getCam()
    expect(cam.deviceInformation).toMatchObject({
      manufacturer: expect.any(String),
      model: expect.any(String),
      serialNumber: expect.any(String)
    })
  })

  it('discovers service endpoints pointing at the device', async () => {
    const cam = await getCam()
    expect(cam.uri.device?.toString()).toContain(host)
    expect(cam.uri.media?.toString()).toContain(host)
  })

  it('returns at least one media profile with a usable token', async () => {
    const cam = await getCam()
    const profiles = await cam.media.getProfiles()
    expect(profiles.length).toBeGreaterThan(0)
    expect(profiles[0]?.token).toMatch(/\S/)
  })

  it('returns an rtsp stream URI for the default profile', async () => {
    const cam = await getCam()
    const token = cam.defaultProfile?.token
    if (!token) throw new Error('expected a default profile with a token')
    const { uri } = await cam.media.getStreamUri({ profileToken: token })
    expect(uri).toMatch(/^rtsp:\/\//)
    expect(uri).toContain(host)
  })
})
