import { Device, SoapFaultError } from '@2bad/onvif'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { media } from '../../media/source/index.ts'
import { type ImagingClient, imaging } from '#index.ts'

const hostname = process.env['ONVIF_TEST_HOST']
const username = process.env['ONVIF_TEST_USER']
const password = process.env['ONVIF_TEST_PASS']

describe.skipIf(!hostname)('imaging on a live camera', () => {
  let device: Device & { imaging: ImagingClient }
  let videoSourceToken = ''

  beforeAll(async () => {
    const connected = await Device.connect({
      hostname: hostname ?? '',
      username: username ?? '',
      password: password ?? ''
    })
    device = connected.use(imaging)
    const [configuration] = await connected.use(media).media.getVideoSourceConfigurations()
    videoSourceToken = configuration?.sourceToken ?? ''
  })

  afterAll(() => device.close())

  it('reads the settings, options, move options and status', async () => {
    const source = device.imaging.forVideoSource(videoSourceToken)
    const { imagingOptions } = await source.getOptions()
    const { imagingSettings } = await source.getImagingSettings()
    const { brightness = 0 } = imagingSettings
    const { min = 0, max = 0 } = imagingOptions.brightness ?? {}
    expect(brightness).toBeGreaterThanOrEqual(min)
    expect(brightness).toBeLessThanOrEqual(max)
    await source.getMoveOptions()
    await source.getStatus()
    await device.imaging.getServiceCapabilities()
  })

  it('changes the brightness and sets it back', async (context) => {
    const source = device.imaging.forVideoSource(videoSourceToken)
    const { imagingOptions } = await source.getOptions()
    const { imagingSettings } = await source.getImagingSettings()
    const { brightness } = imagingSettings
    const { min, max } = imagingOptions.brightness ?? {}
    if (brightness === undefined || min === undefined || max === undefined) return context.skip('No brightness')
    const changed = brightness === max ? min : max
    try {
      await source.setImagingSettings({ imagingSettings: { brightness: changed } })
      expect((await source.getImagingSettings()).imagingSettings.brightness).toBe(changed)
    } finally {
      await source.setImagingSettings({ imagingSettings: { brightness } })
    }
    expect((await source.getImagingSettings()).imagingSettings).toEqual(imagingSettings)
  })

  it('reports a video source that does not exist as a SOAP fault', async () => {
    await expect(device.imaging.getImagingSettings({ videoSourceToken: 'missing' })).rejects.toThrow(SoapFaultError)
  })
})
