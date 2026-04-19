import { beforeAll, describe, expect, it } from 'vitest'
import { Onvif } from './onvif.ts'

const host = process.env.ONVIF_TEST_HOST
const username = process.env.ONVIF_TEST_USER
const password = process.env.ONVIF_TEST_PASS

describe.skipIf(!host)('Onvif (live device)', () => {
  let cam: Onvif

  beforeAll(async () => {
    cam = new Onvif({ hostname: host!, username, password })
    await cam.connect()
  })

  it('populates device information during connect()', () => {
    expect(cam.deviceInformation).toMatchObject({
      manufacturer: expect.any(String),
      model: expect.any(String),
      serialNumber: expect.any(String)
    })
  })

  it('discovers service endpoints pointing at the device', () => {
    expect(cam.uri.device?.toString()).toContain(host)
    expect(cam.uri.media?.toString()).toContain(host)
  })

  it('returns at least one media profile with a usable token', async () => {
    const profiles = await cam.media.getProfiles()
    expect(profiles.length).toBeGreaterThan(0)
    expect(profiles[0]?.token).toMatch(/\S/)
  })

  it('returns an rtsp stream URI for the default profile', async () => {
    const token = cam.defaultProfile?.token
    expect(token).toBeTruthy()
    const { uri } = await cam.media.getStreamUri({ profileToken: token! })
    expect(uri).toMatch(/^rtsp:\/\//)
    expect(uri).toContain(host)
  })
})
