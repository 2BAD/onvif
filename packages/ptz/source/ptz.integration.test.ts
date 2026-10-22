import { setTimeout as sleep } from 'node:timers/promises'
import { Device, SoapFaultError } from '@2bad/onvif'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { media } from '../../media/source/index.ts'
import { type PTZClient, ptz } from '#index.ts'

const hostname = process.env['ONVIF_TEST_HOST']
const username = process.env['ONVIF_TEST_USER']
const password = process.env['ONVIF_TEST_PASS']

describe.skipIf(!hostname)('PTZ on a live camera', () => {
  let device: Device & { ptz: PTZClient }
  let profileToken = ''

  beforeAll(async () => {
    const connected = await Device.connect({
      hostname: hostname ?? '',
      username: username ?? '',
      password: password ?? ''
    })
    device = connected.use(ptz)
    const [profile] = await connected.use(media).media.getProfiles()
    profileToken = profile?.token ?? ''
  })

  afterAll(() => device.close())

  it('reads every node, configuration and its options', async () => {
    const { ptzNode = [] } = await device.ptz.getNodes()
    expect(ptzNode.length).toBeGreaterThan(0)
    for (const node of ptzNode) {
      expect((await device.ptz.getNode({ nodeToken: node.token })).ptzNode).toMatchObject(node)
    }
    const { ptzConfiguration = [] } = await device.ptz.getConfigurations()
    for (const { token } of ptzConfiguration) {
      const { ptzConfiguration: configuration } = await device.ptz.getConfiguration({ ptzConfigurationToken: token })
      expect(configuration.token).toBe(token)
      await device.ptz.getConfigurationOptions({ configurationToken: token })
    }
    await device.ptz.getServiceCapabilities()
  })

  it('pans, stops and returns to a preset', async (context) => {
    const { ptzNode: [node] = [] } = await device.ptz.getNodes()
    if (!node?.supportedPTZSpaces.continuousPanTiltVelocitySpace) return
    if (node.maximumNumberOfPresets === 0) context.skip('The node has no preset to return to')
    const profile = device.ptz.forProfile(profileToken)
    const { presetToken } = await profile.setPreset({ presetName: 'onviftest' })
    try {
      const { preset = [] } = await profile.getPresets()
      expect(preset).toContainEqual(expect.objectContaining({ token: presetToken, name: 'onviftest' }))

      await profile.continuousMove({ velocity: { panTilt: { x: 0.3, y: 0 } }, timeout: 'PT1S' })
      expect((await profile.getStatus()).ptzStatus.moveStatus?.panTilt).toBe('MOVING')
      await sleep(2_000)
      expect((await profile.getStatus()).ptzStatus.moveStatus?.panTilt).toBe('IDLE')

      await profile.continuousMove({ velocity: { panTilt: { x: -0.3, y: 0 } } })
      await sleep(500)
      await profile.stop({ panTilt: true })
      await sleep(1_000)
      expect((await profile.getStatus()).ptzStatus.moveStatus?.panTilt).toBe('IDLE')
    } finally {
      await profile.gotoPreset({ presetToken })
      await sleep(3_000)
      await profile.removePreset({ presetToken })
    }
    const { preset = [] } = await profile.getPresets()
    expect(preset.map(({ token }) => token)).not.toContain(presetToken)
  })

  it('creates, changes, runs and removes a preset tour', async (context) => {
    const profile = device.ptz.forProfile(profileToken)
    const { ptzConfiguration = [] } = await profile.getCompatibleConfigurations()
    expect(ptzConfiguration.length).toBeGreaterThan(0)
    await profile.getPresetTours()
    await profile.getPresetTourOptions()
    const { ptzNode: [listed] = [] } = await device.ptz.getNodes()
    const { ptzNode: node } = await device.ptz.getNode({ nodeToken: listed?.token ?? '' })
    if (node.extension?.supportedPresetTour?.maximumNumberOfPresetTours === 0 || node.maximumNumberOfPresets === 0) {
      context.skip('The node has no room for a preset tour')
    }
    const { presetToken } = await profile.setPreset({ presetName: 'onviftest' })
    try {
      const { presetTourToken } = await profile.createPresetTour()
      try {
        const { presetTour } = await profile.getPresetTour({ presetTourToken })
        const tourSpot = [{ presetDetail: { presetToken }, stayTime: 'PT5S' }]
        await profile.modifyPresetTour({ presetTour: { ...presetTour, autoStart: false, tourSpot } })
        const { presetTour: modified } = await profile.getPresetTour({ presetTourToken })
        expect(modified.tourSpot?.map((spot) => spot.presetDetail.presetToken)).toEqual([presetToken])
        await profile.operatePresetTour({ presetTourToken, operation: 'Start' })
        await sleep(1_000)
        await profile.operatePresetTour({ presetTourToken, operation: 'Stop' })
      } finally {
        await profile.removePresetTour({ presetTourToken })
      }
      const { presetTour = [] } = await profile.getPresetTours()
      expect(presetTour.map(({ token }) => token)).not.toContain(presetTourToken)
    } finally {
      await profile.removePreset({ presetToken })
    }
  })

  it('reports a move in a space the node does not have as a SOAP fault', async () => {
    const { ptzNode: [node] = [] } = await device.ptz.getNodes()
    if (node?.supportedPTZSpaces.continuousZoomVelocitySpace) return
    await expect(
      device.ptz.continuousMove({ profileToken, velocity: { zoom: { x: 0.5 } }, timeout: 'PT1S' })
    ).rejects.toThrow(SoapFaultError)
  })
})
