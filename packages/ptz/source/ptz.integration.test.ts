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
    const { presetToken } = await device.ptz.setPreset({ profileToken, presetName: 'onviftest' })
    try {
      const { preset = [] } = await device.ptz.getPresets({ profileToken })
      expect(preset).toContainEqual(expect.objectContaining({ token: presetToken, name: 'onviftest' }))

      await device.ptz.continuousMove({ profileToken, velocity: { panTilt: { x: 0.3, y: 0 } }, timeout: 'PT1S' })
      expect((await device.ptz.getStatus({ profileToken })).ptzStatus.moveStatus?.panTilt).toBe('MOVING')
      await sleep(2_000)
      expect((await device.ptz.getStatus({ profileToken })).ptzStatus.moveStatus?.panTilt).toBe('IDLE')

      await device.ptz.continuousMove({ profileToken, velocity: { panTilt: { x: -0.3, y: 0 } } })
      await sleep(500)
      await device.ptz.stop({ profileToken, panTilt: true })
      await sleep(1_000)
      expect((await device.ptz.getStatus({ profileToken })).ptzStatus.moveStatus?.panTilt).toBe('IDLE')
    } finally {
      await device.ptz.gotoPreset({ profileToken, presetToken })
      await sleep(3_000)
      await device.ptz.removePreset({ profileToken, presetToken })
    }
    const { preset = [] } = await device.ptz.getPresets({ profileToken })
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
