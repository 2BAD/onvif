import { DecodeError, OnvifError, SoapFaultError } from '@2bad/onvif'
import { decode, parseEnvelope } from '@2bad/onvif/soap'
import { describe, expect, it } from 'vitest'
import { capturesOf, decodeCapture, operationsOf } from '../../../tools/fixtures/corpus.ts'
import {
  answer,
  cam,
  connectMock,
  dahua,
  hik,
  rawRequestOf,
  rejection,
  requestOf,
  simulator
} from '../../../tools/mock-camera/harness.ts'
import type { ActionOverride, MockCameraOptions } from '../../../tools/mock-camera/server.ts'
import { DeviceIO, io } from '#index.ts'

const connect = async (options?: MockCameraOptions) => {
  const { mock, device } = await connectMock(options)
  return { mock, device: device.use(io) }
}

const decodedRequestOf = (
  mock: Awaited<ReturnType<typeof connect>>['mock'],
  operation: (typeof operations)[number]
): unknown => {
  const { body } = parseEnvelope(rawRequestOf(mock, operation.name))
  return decode(operation.schema, operation.request.type, body[operation.request.name] ?? '')
}

const operations = operationsOf(DeviceIO)

const methodName = (name: string): string => `${name.charAt(0).toLowerCase()}${name.slice(1)}`

// required elements that the DCN-BM2220LPR answers with xsi:nil
const nilCaptures = [
  'live/dvc/dcn-bm2220lpr/deviceio.GetVideoSourceConfigurationOptions.xml',
  'live/dvc/dcn-bm2220lpr/deviceio.GetAudioSourceConfigurationOptions.xml',
  'live/dvc/dcn-bm2220lpr/deviceio.GetAudioOutputConfiguration.xml'
]

describe('generated device IO operations', () => {
  const fixtures = capturesOf('deviceio', operations)

  it('cover a capture for every operation', () => {
    const captured = new Set(fixtures.map(({ operation }) => operation.name))
    const withoutDevice = [
      'GetVideoOutputConfiguration',
      'SetVideoOutputConfiguration',
      'GetVideoOutputConfigurationOptions',
      'SendReceiveSerialCommand'
    ]
    expect(operations.map(({ name }) => name).filter((name) => !captured.has(name))).toEqual(withoutDevice)
  })

  it('cover a camera capture for every read a camera answered', () => {
    const captured = new Set(
      fixtures.filter(({ name }) => name.startsWith('live/')).map(({ operation }) => operation.name)
    )
    const reads = operations.map(({ name }) => name).filter((name) => name.startsWith('Get'))
    expect(reads.filter((name) => !captured.has(name))).toEqual([
      'GetVideoOutputConfiguration',
      'GetVideoOutputConfigurationOptions',
      'GetSerialPortConfiguration',
      'GetSerialPortConfigurationOptions'
    ])
  })

  it.each(fixtures.filter(({ name }) => !nilCaptures.includes(name)).map((entry) => [entry.name, entry] as const))(
    'decode %s',
    (_name, capture) => {
      expect(() => decodeCapture(capture)).not.toThrow()
    }
  )

  it('send the relay list and state requests with device service elements and every other in device IO', () => {
    const device = ['GetRelayOutputs', 'SetRelayOutputState']
    for (const operation of operations) {
      const deviceElement = device.includes(operation.name)
      expect(operation.request.namespace).toBe(
        deviceElement ? 'http://www.onvif.org/ver10/device/wsdl' : 'http://www.onvif.org/ver10/deviceIO/wsdl'
      )
      expect(operation.service).toBe(deviceElement ? 'http://www.onvif.org/ver10/deviceIO/wsdl' : undefined)
    }
  })
})

describe('io', () => {
  it('adds a method for every operation as device.io', async () => {
    const { device } = await connect()
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(device.io))
    expect(methods.filter((name) => name !== 'constructor').toSorted()).toEqual(
      operations.map(({ name }) => methodName(name)).toSorted()
    )
    expect(Object.getOwnPropertyDescriptor(device, 'io')).toMatchObject({ writable: false, enumerable: true })
  })

  it('sends every request to the device IO service, the relay calls included', async () => {
    const { mock, device } = await connect()
    await device.io.getServiceCapabilities()
    await device.io.getRelayOutputs()
    await device.io.setRelayOutputState({ relayOutputToken: '0', logicalState: 'inactive' })
    await device.io.getDigitalInputs()
    expect(
      mock.requests.filter(({ service }) => service === 'deviceio').map(({ action, path }) => [action, path])
    ).toEqual([
      ['GetServiceCapabilities', '/onvif/DeviceIO'],
      ['GetRelayOutputs', '/onvif/DeviceIO'],
      ['SetRelayOutputState', '/onvif/DeviceIO'],
      ['GetDigitalInputs', '/onvif/DeviceIO']
    ])
    expect(rawRequestOf(mock, 'GetRelayOutputs')).toContain('<tds:GetRelayOutputs')
    expect(rawRequestOf(mock, 'SetRelayOutputState')).toContain(
      '<tds:SetRelayOutputState xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><tds:RelayOutputToken>0</tds:RelayOutputToken>' +
        '<tds:LogicalState>inactive</tds:LogicalState></tds:SetRelayOutputState>'
    )
  })

  it('reports a device without a device IO service before sending anything, the relay calls included', async () => {
    const services = cam('device.GetServices').replace(
      /<tds:Service>(?:(?!<\/tds:Service>)[\s\S])*?ver10\/deviceIO\/wsdl[\s\S]*?<\/tds:Service>/,
      ''
    )
    const { mock, device } = await connect({ overrides: { 'device.GetServices': answer(services) } })
    for (const [action, call] of [
      ['GetDigitalInputs', () => device.io.getDigitalInputs()],
      ['GetRelayOutputs', () => device.io.getRelayOutputs()]
    ] as const) {
      const error = await rejection(call)
      expect(error).toBeInstanceOf(OnvifError)
      expect(error).toMatchObject({
        message: 'The device does not offer the service http://www.onvif.org/ver10/deviceIO/wsdl',
        service: 'tmd',
        action
      })
    }
    expect(mock.requests.some(({ action }) => ['GetDigitalInputs', 'GetRelayOutputs'].includes(action))).toBe(false)
  })
})

describe('relay outputs', () => {
  it('reads the relays with their tokens as strings', async () => {
    const { device } = await connect()
    expect(await device.io.getRelayOutputs()).toEqual({
      relayOutputs: [{ token: '0', properties: { mode: 'Monostable', delayTime: 'PT20S', idleState: 'closed' } }]
    })
  })

  it('reads every relay of a camera with two', async () => {
    const { device } = await connect({
      overrides: { 'deviceio.GetRelayOutputs': answer(dahua('deviceio.GetRelayOutputs')) }
    })
    const { relayOutputs = [] } = await device.io.getRelayOutputs()
    expect(relayOutputs.map(({ token }) => token)).toEqual(['00000', '00100'])
  })

  it('reads an empty relay list as no relays', async () => {
    const empty = cam('deviceio.GetRelayOutputs').replace(/<tds:RelayOutputs\b[\s\S]*<\/tds:RelayOutputs>/, '')
    const { device } = await connect({ overrides: { 'deviceio.GetRelayOutputs': answer(empty) } })
    expect(await device.io.getRelayOutputs()).toEqual({})
  })

  it('reads the delay times as numbers and every mode', async () => {
    const { device } = await connect()
    expect(await device.io.getRelayOutputOptions()).toEqual({
      relayOutputOptions: [{ token: '0', mode: ['Monostable', 'Bistable'], delayTimes: [3, 120], discrete: false }]
    })
  })

  it('reads a single delay time and a single mode as lists', async () => {
    const single = cam('deviceio.GetRelayOutputOptions')
      .replace('<tmd:Mode>Bistable</tmd:Mode>', '')
      .replace('<tmd:DelayTimes>3 120</tmd:DelayTimes>', '<tmd:DelayTimes>5</tmd:DelayTimes>')
    const { device } = await connect({ overrides: { 'deviceio.GetRelayOutputOptions': answer(single) } })
    const { relayOutputOptions = [] } = await device.io.getRelayOutputOptions()
    expect(relayOutputOptions[0]).toMatchObject({ mode: ['Monostable'], delayTimes: [5] })
  })

  it('sends the relay settings back with the token as attribute and the properties in the schema namespace', async () => {
    const { mock, device } = await connect()
    const { relayOutputs = [] } = await device.io.getRelayOutputs()
    const [relayOutput] = relayOutputs
    if (!relayOutput) throw new Error('No relay')
    await device.io.setRelayOutputSettings({ relayOutput })
    expect(decodedRequestOf(mock, DeviceIO.SetRelayOutputSettings)).toEqual({ relayOutput })
    expect(rawRequestOf(mock, 'SetRelayOutputSettings')).toContain(
      '<tmd:RelayOutput token="0"><tt:Properties><tt:Mode>Monostable</tt:Mode><tt:DelayTime>PT20S</tt:DelayTime>' +
        '<tt:IdleState>closed</tt:IdleState></tt:Properties></tmd:RelayOutput>'
    )
  })

  it('reports an unknown relay token as a SOAP fault with its subcodes', async () => {
    const { device } = await connect({
      overrides: { 'deviceio.SetRelayOutputState': answer(cam('deviceio.SetRelayOutputStateMissingFault'), 400) }
    })
    const error = await rejection(() =>
      device.io.setRelayOutputState({ relayOutputToken: 'missing', logicalState: 'inactive' })
    )
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({
      subcodes: ['InvalidArgVal', 'RelayToken'],
      service: 'tmd',
      action: 'SetRelayOutputState'
    })
  })

  it('reports a camera without relays as a SOAP fault', async () => {
    const { device } = await connect({
      overrides: { 'deviceio.GetRelayOutputs': answer(hik('deviceio.GetRelayOutputs'), 500) }
    })
    await expect(device.io.getRelayOutputs()).rejects.toMatchObject({
      subcodes: ['InvalidArgVal', 'InvalidParameter'],
      action: 'GetRelayOutputs'
    })
  })
})

describe('digital inputs', () => {
  it('reads the idle state attribute of every input, also from empty elements', async () => {
    const { device } = await connect({
      overrides: { 'deviceio.GetDigitalInputs': answer(dahua('deviceio.GetDigitalInputs')) }
    })
    expect(await device.io.getDigitalInputs()).toEqual({
      digitalInputs: [
        { token: '00000', idleState: 'open' },
        { token: '00100', idleState: 'open' }
      ]
    })
  })

  it('reads the idle state options as a list', async () => {
    const { mock, device } = await connect()
    expect(await device.io.getDigitalInputConfigurationOptions({ token: '1' })).toEqual({
      digitalInputOptions: { idleState: ['closed', 'open'] }
    })
    expect(requestOf(mock, 'GetDigitalInputConfigurationOptions')).toEqual({
      GetDigitalInputConfigurationOptions: { Token: '1' }
    })
  })

  it('sends the inputs back with token and idle state as attributes', async () => {
    const { mock, device } = await connect()
    const { digitalInputs = [] } = await device.io.getDigitalInputs()
    await device.io.setDigitalInputConfigurations({ digitalInputs })
    expect(decodedRequestOf(mock, DeviceIO.SetDigitalInputConfigurations)).toEqual({ digitalInputs })
    expect(rawRequestOf(mock, 'SetDigitalInputConfigurations')).toContain(
      '<tmd:DigitalInputs token="1" IdleState="open"/>'
    )
  })
})

describe('audio and video', () => {
  it('reads the source and output tokens as lists', async () => {
    const { device } = await connect()
    expect(await device.io.getVideoSources()).toEqual({ token: ['VideoSource_token_1'] })
    expect(await device.io.getVideoOutputs()).toEqual({})
  })

  it('sends a video source configuration back before ForcePersistence, with its children in the schema namespace', async () => {
    const { mock, device } = await connect()
    const { videoSourceConfiguration } = await device.io.getVideoSourceConfiguration({
      videoSourceToken: 'VideoSource_token_1'
    })
    expect(videoSourceConfiguration).toEqual({
      token: 'VideoSource_token_1',
      name: 'VideoSource_1',
      useCount: 3,
      sourceToken: 'VideoSource_token_1',
      bounds: { x: 0, y: 0, width: 1920, height: 1080 }
    })
    await device.io.setVideoSourceConfiguration({
      configuration: videoSourceConfiguration,
      forcePersistence: true
    })
    expect(decodedRequestOf(mock, DeviceIO.SetVideoSourceConfiguration)).toEqual({
      configuration: videoSourceConfiguration,
      forcePersistence: true
    })
    expect(rawRequestOf(mock, 'SetVideoSourceConfiguration')).toMatch(
      /<tmd:Configuration token="VideoSource_token_1"><tt:Name>VideoSource_1<\/tt:Name>[\s\S]*<\/tmd:Configuration><tmd:ForcePersistence>true<\/tmd:ForcePersistence><\/tmd:SetVideoSourceConfiguration>/
    )
  })

  it('reads the audio output options with every list as a list', async () => {
    const { device } = await connect()
    expect(await device.io.getAudioOutputConfigurationOptions({ audioOutputToken: 'AudioOutput_token_1' })).toEqual({
      audioOutputOptions: {
        outputTokensAvailable: ['AudioOutput_token_1'],
        sendPrimacyOptions: ['www.onvif.org/ver20/HalfDuplex/C'],
        outputLevelRange: { min: 5, max: 5 }
      }
    })
  })

  it.each(nilCaptures.map((name) => [name] as const))(
    'rejects the nil required element of %s with its path',
    async (name) => {
      const action = /deviceio\.(\w+)\.xml$/.exec(name)?.[1] ?? ''
      const operation = operations.find((candidate) => candidate.name === action)
      if (!operation) throw new Error(`No operation ${action}`)
      const { device } = await connect()
      const call = device.io[methodName(action) as keyof typeof device.io] as (request: object) => Promise<unknown>
      const error = await rejection(() =>
        call.call(device.io, { videoSourceToken: '1', audioSourceToken: '1', audioOutputToken: '1' })
      )
      expect(error).toBeInstanceOf(DecodeError)
      expect(error).toMatchObject({ service: 'tmd', action })
      expect((error as DecodeError).path).toMatch(new RegExp(`^${operation.response.name}\\.\\w+$`))
    }
  )

  it('reports an unknown video source token as a SOAP fault', async () => {
    const { device } = await connect({
      overrides: {
        'deviceio.GetVideoSourceConfiguration': answer(cam('deviceio.GetVideoSourceConfigurationMissingFault'), 500)
      }
    })
    await expect(device.io.getVideoSourceConfiguration({ videoSourceToken: 'missing' })).rejects.toMatchObject({
      subcodes: ['InvalidArgs', 'NoConfig'],
      action: 'GetVideoSourceConfiguration'
    })
  })

  it('reports an optional call a camera does not implement as a SOAP fault sent with HTTP 200', async () => {
    const { device } = await connect({
      overrides: { 'deviceio.GetVideoSourceConfiguration': answer(dahua('deviceio.GetVideoSourceConfiguration')) }
    })
    await expect(device.io.getVideoSourceConfiguration({ videoSourceToken: '00000' })).rejects.toMatchObject({
      subcodes: ['ActionNotSupported', 'NotImplemented']
    })
  })
})

describe('serial ports', () => {
  const serial = (name: string): ActionOverride => answer(simulator(`deviceio.${name}`))

  it('reads the configuration with type and token as attributes and every option list as a list', async () => {
    const { device } = await connect({
      overrides: {
        'deviceio.GetSerialPortConfiguration': serial('GetSerialPortConfiguration'),
        'deviceio.GetSerialPortConfigurationOptions': serial('GetSerialPortConfigurationOptions')
      }
    })
    expect(await device.io.getSerialPortConfiguration({ serialPortToken: 'SerialPortToken_1' })).toEqual({
      serialPortConfiguration: {
        token: '',
        type: 'RS485FullDuplex',
        baudRate: 115200,
        parityBit: 'Odd',
        characterLength: 8,
        stopBit: 1
      }
    })
    const { serialPortOptions } = await device.io.getSerialPortConfigurationOptions({
      serialPortToken: 'SerialPortToken_1'
    })
    expect(serialPortOptions).toMatchObject({
      token: 'SerialPortToken_1',
      baudRateList: { items: [115200, 98000] },
      parityBitList: { items: ['Odd', 'Even'] },
      characterLengthList: { items: [8] },
      stopBitList: { items: [1] }
    })
  })

  it('sends the configuration back with ForcePersistance as the spec spells it', async () => {
    const { mock, device } = await connect({
      overrides: {
        'deviceio.GetSerialPortConfiguration': serial('GetSerialPortConfiguration'),
        'deviceio.SetSerialPortConfiguration': serial('SetSerialPortConfiguration')
      }
    })
    const { serialPortConfiguration } = await device.io.getSerialPortConfiguration({
      serialPortToken: 'SerialPortToken_1'
    })
    await device.io.setSerialPortConfiguration({ serialPortConfiguration, forcePersistance: true })
    expect(rawRequestOf(mock, 'SetSerialPortConfiguration')).toContain(
      '<tmd:SerialPortConfiguration token="" type="RS485FullDuplex"><tmd:BaudRate>115200</tmd:BaudRate>' +
        '<tmd:ParityBit>Odd</tmd:ParityBit><tmd:CharacterLength>8</tmd:CharacterLength><tmd:StopBit>1</tmd:StopBit>' +
        '</tmd:SerialPortConfiguration><tmd:ForcePersistance>true</tmd:ForcePersistance>'
    )
  })

  const serialAnswer = (data: string): ActionOverride =>
    answer(
      cam('deviceio.SetRelayOutputSettings').replace(
        /<tmd:SetRelayOutputSettingsResponse\s*\/>|<tmd:SetRelayOutputSettingsResponse>\s*<\/tmd:SetRelayOutputSettingsResponse>/,
        `<tmd:SendReceiveSerialCommandResponse>${data}</tmd:SendReceiveSerialCommandResponse>`
      )
    )

  it('sends binary data as base64 and reads the binary reply as bytes', async () => {
    const { mock, device } = await connect({
      overrides: {
        'deviceio.SendReceiveSerialCommand': serialAnswer(
          '<tmd:SerialData><tmd:Binary>AAH/</tmd:Binary></tmd:SerialData>'
        )
      }
    })
    const reply = await device.io.sendReceiveSerialCommand({
      token: 'SerialPortToken_1',
      serialData: { binary: new Uint8Array([0x02, 0x41, 0x03]) },
      timeOut: 'PT1S',
      dataLength: 3
    })
    expect(reply).toEqual({ serialData: { binary: new Uint8Array([0x00, 0x01, 0xff]) } })
    expect(rawRequestOf(mock, 'SendReceiveSerialCommand')).toContain(
      '<tmd:Token>SerialPortToken_1</tmd:Token><tmd:SerialData><tmd:Binary>AkED</tmd:Binary></tmd:SerialData>' +
        '<tmd:TimeOut>PT1S</tmd:TimeOut><tmd:DataLength>3</tmd:DataLength>'
    )
  })

  it('keeps a string reply that looks like a number or a boolean as a string', async () => {
    const { device } = await connect({
      overrides: {
        'deviceio.SendReceiveSerialCommand': serialAnswer(
          '<tmd:SerialData><tmd:String>0042</tmd:String></tmd:SerialData>'
        )
      }
    })
    expect(await device.io.sendReceiveSerialCommand({ serialData: { string: 'true' } })).toEqual({
      serialData: { string: '0042' }
    })
  })

  it('reads a reply without data as no data', async () => {
    const { device } = await connect({ overrides: { 'deviceio.SendReceiveSerialCommand': serialAnswer('') } })
    expect(await device.io.sendReceiveSerialCommand({ serialData: { string: 'PING' } })).toEqual({})
  })

  it('rejects serial data with neither or both of binary and string before sending', async () => {
    const { mock, device } = await connect()
    for (const serialData of [{}, { binary: new Uint8Array([1]), string: 'A' }]) {
      const error = await rejection(() => device.io.sendReceiveSerialCommand({ serialData }))
      expect(error).toBeInstanceOf(OnvifError)
      expect((error as Error).message).toBe('Expected one of binary, string at SendReceiveSerialCommand.serialData')
    }
    expect(mock.requests.some(({ action }) => action === 'SendReceiveSerialCommand')).toBe(false)
  })

  it('rejects a string with control characters that XML cannot carry before sending', async () => {
    const { mock, device } = await connect()
    const error = await rejection(() =>
      device.io.sendReceiveSerialCommand({ serialData: { string: '\u0002PING\u0003' } })
    )
    expect(error).toBeInstanceOf(OnvifError)
    expect(mock.requests.some(({ action }) => action === 'SendReceiveSerialCommand')).toBe(false)
  })

  it('reports an unknown serial port token as a SOAP fault', async () => {
    const { device } = await connect({
      overrides: { 'deviceio.SendReceiveSerialCommand': answer(simulator('deviceio.SendReceiveSerialCommand'), 400) }
    })
    await expect(
      device.io.sendReceiveSerialCommand({ token: 'missing', serialData: { binary: new Uint8Array() } })
    ).rejects.toMatchObject({ subcodes: ['InvalidArgVal', 'InvalidSerialPort'] })
  })
})

describe('service capabilities', () => {
  it('reads the counts as numbers', async () => {
    const { device } = await connect()
    expect(await device.io.getServiceCapabilities()).toEqual({
      capabilities: {
        videoSources: 1,
        videoOutputs: 0,
        audioSources: 1,
        audioOutputs: 1,
        relayOutputs: 1,
        serialPorts: 1,
        digitalInputs: 1,
        digitalInputOptions: true
      }
    })
  })

  it('reads counts a camera leaves out as absent', async () => {
    const sparse = cam('deviceio.GetServiceCapabilities').replace(
      /<tmd:Capabilities [^>]*>/,
      '<tmd:Capabilities RelayOutputs="2">'
    )
    const { device } = await connect({ overrides: { 'deviceio.GetServiceCapabilities': answer(sparse) } })
    expect(await device.io.getServiceCapabilities()).toEqual({ capabilities: { relayOutputs: 2 } })
  })

  it('rejects a count that is not a number with the path of the attribute', async () => {
    const broken = cam('deviceio.GetServiceCapabilities').replace('RelayOutputs="1"', 'RelayOutputs="one"')
    const { device } = await connect({ overrides: { 'deviceio.GetServiceCapabilities': answer(broken) } })
    const error = await rejection(() => device.io.getServiceCapabilities())
    expect(error).toBeInstanceOf(DecodeError)
    expect(error).toMatchObject({ path: 'GetServiceCapabilitiesResponse.Capabilities.RelayOutputs' })
  })
})
