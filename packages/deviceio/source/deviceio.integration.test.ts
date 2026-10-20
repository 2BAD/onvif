import { Device, SoapFaultError } from '@2bad/onvif'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type DeviceIOClient, io } from '#index.ts'

const hostname = process.env['ONVIF_TEST_HOST']
const username = process.env['ONVIF_TEST_USER']
const password = process.env['ONVIF_TEST_PASS']

// cameras without a kind of IO answer its calls with a fault
const unlessFault = async <Result>(call: () => Promise<Result>): Promise<Result | undefined> => {
  try {
    return await call()
  } catch (error) {
    if (error instanceof SoapFaultError) return undefined
    throw error
  }
}

describe.skipIf(!hostname)('device IO on a live camera', () => {
  let device: Device & { io: DeviceIOClient }

  beforeAll(async () => {
    const connected = await Device.connect({
      hostname: hostname ?? '',
      username: username ?? '',
      password: password ?? ''
    })
    device = connected.use(io)
  })

  afterAll(() => device.close())

  it('reads the capabilities and every source, output, input and port list', async () => {
    const { capabilities } = await device.io.getServiceCapabilities()
    expect(capabilities.relayOutputs ?? 0).toBeGreaterThanOrEqual(0)
    const calls: (() => Promise<unknown>)[] = [
      () => device.io.getVideoSources(),
      () => device.io.getVideoOutputs(),
      () => device.io.getAudioSources(),
      () => device.io.getAudioOutputs(),
      () => device.io.getDigitalInputs(),
      () => device.io.getSerialPorts(),
      () => device.io.getRelayOutputOptions()
    ]
    for (const call of calls) await unlessFault(call)
  })

  it('reads the configuration of the first video source with its source token', async (context) => {
    const { token: videoSources = [] } = (await unlessFault(() => device.io.getVideoSources())) ?? {}
    const [videoSourceToken] = videoSources
    if (videoSourceToken === undefined) return context.skip('No video source')
    const read = await unlessFault(() => device.io.getVideoSourceConfiguration({ videoSourceToken }))
    if (!read) return context.skip('No video source configuration in device IO')
    expect(read.videoSourceConfiguration.sourceToken).toBe(videoSourceToken)
  })

  it('switches the first relay on and off and reads the same settings', async (context) => {
    const { relayOutputs = [] } = (await unlessFault(() => device.io.getRelayOutputs())) ?? {}
    const [relayOutput] = relayOutputs
    if (!relayOutput) return context.skip('No relay')
    await device.io.setRelayOutputSettings({ relayOutput })
    try {
      await device.io.setRelayOutputState({ relayOutputToken: relayOutput.token, logicalState: 'active' })
    } finally {
      await device.io.setRelayOutputState({ relayOutputToken: relayOutput.token, logicalState: 'inactive' })
    }
    expect((await device.io.getRelayOutputs()).relayOutputs).toEqual(relayOutputs)
  })

  it('sends the digital inputs back and reads the same', async (context) => {
    const { digitalInputs = [] } = (await unlessFault(() => device.io.getDigitalInputs())) ?? {}
    if (digitalInputs.length === 0) return context.skip('No digital input')
    await device.io.setDigitalInputConfigurations({ digitalInputs })
    expect((await device.io.getDigitalInputs()).digitalInputs).toEqual(digitalInputs)
  })
})
