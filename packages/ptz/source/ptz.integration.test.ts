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
      expect((await device.ptz.getNode({ nodeToken: node.token })).ptzNode).toEqual(node)
    }
    const { ptzConfiguration = [] } = await device.ptz.getConfigurations()
    for (const { token } of ptzConfiguration) {
      const { ptzConfiguration: configuration } = await device.ptz.getConfiguration({ ptzConfigurationToken: token })
      expect(configuration.token).toBe(token)
      await device.ptz.getConfigurationOptions({ configurationToken: token })
    }
    await device.ptz.getServiceCapabilities()
  })

  it('pans, stops and returns to a preset', async () => {
    const { ptzNode: [node] = [] } = await device.ptz.getNodes()
    if (!node?.supportedPTZSpaces.continuousPanTiltVelocitySpace) return
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

  it('reports a move in a space the node does not have as a SOAP fault', async () => {
    const { ptzNode: [node] = [] } = await device.ptz.getNodes()
    if (node?.supportedPTZSpaces.continuousZoomVelocitySpace) return
    await expect(
      device.ptz.continuousMove({ profileToken, velocity: { zoom: { x: 0.5 } }, timeout: 'PT1S' })
    ).rejects.toThrow(SoapFaultError)
  })
})
