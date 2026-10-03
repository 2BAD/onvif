import { createSocket } from 'node:dgram'
import { once } from 'node:events'
import type { NetworkInterfaceInfo } from 'node:os'
import { OnvifError, ParseError, TransportError } from '@2bad/onvif'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type MockResponder,
  type MockResponderOptions,
  probeMatches,
  startMockResponder
} from '../../../tools/mock-camera/discovery.ts'
import { type DiscoverOptions, discover } from '#discover.ts'
import type { DiscoveredDevice } from '#message.ts'

const interfaces = vi.hoisted(() => ({ current: {} as Record<string, NetworkInterfaceInfo[]> }))

vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  networkInterfaces: () => interfaces.current
}))

const ipv4 = (address: string, internal: boolean): NetworkInterfaceInfo => ({
  address,
  netmask: '255.0.0.0',
  family: 'IPv4',
  mac: '00:00:00:00:00:00',
  internal,
  cidr: `${address}/8`
})

const ipv6Only: NetworkInterfaceInfo = {
  address: 'fe80::1',
  netmask: 'ffff:ffff:ffff:ffff::',
  family: 'IPv6',
  mac: '02:00:00:00:00:01',
  internal: false,
  cidr: 'fe80::1/64',
  scopeid: 2
}

const responders: MockResponder[] = []

const respond = async (options?: MockResponderOptions): Promise<MockResponder> => {
  const responder = await startMockResponder(options)
  responders.push(responder)
  return responder
}

const all = async (devices: AsyncIterable<DiscoveredDevice>): Promise<DiscoveredDevice[]> => {
  const found: DiscoveredDevice[] = []
  for await (const device of devices) found.push(device)
  return found
}

const collect = async (options: DiscoverOptions): Promise<{ devices: DiscoveredDevice[]; errors: OnvifError[] }> => {
  const errors: OnvifError[] = []
  const devices = await all(discover({ timeoutMs: 400, onError: (error) => errors.push(error), ...options }))
  return { devices, errors }
}

const rejection = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error('Expected a rejection')
}

afterEach(async () => {
  interfaces.current = {}
  await Promise.all(responders.splice(0).map((responder) => responder.close()))
})

describe('discover', () => {
  it('finds a device by a direct probe and yields it once for all probes and repeats', async () => {
    const responder = await respond()
    const { devices, errors } = await collect({ hosts: [responder.host] })
    expect(errors).toEqual([])
    expect(devices).toHaveLength(1)
    expect(devices[0]).toMatchObject({
      address: '127.0.0.1',
      xaddrs: [new URL('http://127.0.0.1/onvif/device_service')],
      name: 'DVC'
    })
    expect(responder.probes.map((probe) => probe.types).sort()).toEqual([
      'dn:NetworkVideoTransmitter',
      'dn:NetworkVideoTransmitter',
      'tds:Device',
      'tds:Device'
    ])
    expect(new Set(responder.probes.map((probe) => probe.messageId)).size).toBe(2)
  })

  it('yields devices that share an endpoint but list other addresses', async () => {
    const endpoint = 'urn:uuid:00000000-0000-4000-8000-000000000003'
    const responder = await respond({
      reply: (probe) => [
        probeMatches(probe.messageId, [{ endpoint, host: '192.0.2.10' }]),
        probeMatches(probe.messageId, [{ endpoint, host: '192.0.2.14' }])
      ]
    })
    const { devices, errors } = await collect({ hosts: [responder.host], xaddrs: 'any' })
    expect(errors).toEqual([])
    expect(devices.map((device) => device.xaddrs[0]?.hostname)).toEqual(['192.0.2.10', '192.0.2.14'])
  })

  it('yields a device without addresses once for the address it answers from', async () => {
    const first = await respond({
      reply: (probe) => [probeMatches(probe.messageId).replace(/<d:XAddrs>.*<\/d:XAddrs>/, '')]
    })
    const second = await respond({
      reply: (probe) => [probeMatches(probe.messageId).replace(/<d:XAddrs>.*<\/d:XAddrs>/, '')]
    })
    const { devices } = await collect({ hosts: [first.host, second.host] })
    expect(devices).toHaveLength(1)
    expect(devices[0]?.xaddrs).toEqual([])
  })

  it('yields each device as it answers, before the timeout', async () => {
    const responder = await respond()
    const start = performance.now()
    for await (const device of discover({ hosts: [responder.host], timeoutMs: 5_000 })) {
      expect(device.name).toBe('DVC')
      break
    }
    expect(performance.now() - start).toBeLessThan(1_000)
  })

  it('ends once the timeout has passed', async () => {
    const responder = await respond({ reply: () => [] })
    const start = performance.now()
    const { devices } = await collect({ hosts: [responder.host], timeoutMs: 300 })
    expect(devices).toEqual([])
    expect(performance.now() - start).toBeGreaterThanOrEqual(290)
  })

  it('keeps addresses on other hosts with the any policy', async () => {
    const responder = await respond({ reply: (probe) => [probeMatches(probe.messageId, [{ host: '192.0.2.50' }])] })
    const dropped = await collect({ hosts: [responder.host] })
    expect(dropped.devices[0]?.xaddrs).toEqual([])
    const kept = await collect({ hosts: [responder.host], xaddrs: 'any' })
    expect(kept.devices[0]?.xaddrs.map(String)).toContain('http://192.0.2.50/onvif/device_service')
  })

  it('reports bad and unrelated replies and goes on', async () => {
    const responder = await respond({
      reply: (probe) => [
        '<s:Envelope',
        Buffer.from([0xff, 0xfe, 0x00]),
        probeMatches('urn:uuid:someone-else'),
        probeMatches(probe.messageId).replace(/<a:EndpointReference>.*<\/a:EndpointReference>/, ''),
        probeMatches(probe.messageId)
      ]
    })
    const { devices, errors } = await collect({ hosts: [responder.host] })
    expect(devices).toHaveLength(1)
    expect(errors.some((error) => error instanceof ParseError)).toBe(true)
    expect(errors.some((error) => error.message === 'Reply does not answer this probe')).toBe(true)
    expect(errors.some((error) => error.name === 'DecodeError')).toBe(true)
    expect(errors.every((error) => error instanceof OnvifError && error.host === '127.0.0.1')).toBe(true)
  })

  it('ignores bad replies without an error callback', async () => {
    const responder = await respond({ reply: (probe) => ['<x/>', probeMatches(probe.messageId)] })
    const devices = await all(discover({ hosts: [responder.host], timeoutMs: 300 }))
    expect(devices).toHaveLength(1)
  })

  it('stops yielding after the limit of distinct devices', async () => {
    const perDatagram = 5
    const match = (index: number) =>
      `<d:ProbeMatch><a:EndpointReference><a:Address>urn:uuid:${index}</a:Address></a:EndpointReference><d:MetadataVersion>1</d:MetadataVersion></d:ProbeMatch>`
    const datagram = (messageId: string, first: number) =>
      probeMatches(messageId).replace(
        /<d:ProbeMatches>.*<\/d:ProbeMatches>/,
        `<d:ProbeMatches>${Array.from({ length: perDatagram }, (_, index) => match(first + index)).join('')}</d:ProbeMatches>`
      )
    let answered = false
    const responder = await respond({
      reply: (probe) => {
        if (answered) return []
        answered = true
        return Array.from({ length: Math.ceil(4_500 / perDatagram) }, (_, index) =>
          datagram(probe.messageId, index * perDatagram)
        )
      }
    })
    const { devices, errors } = await collect({ hosts: [responder.host], timeoutMs: 2_000 })
    expect(devices).toHaveLength(4_096)
    expect(errors.filter((error) => error.message === 'More than 4096 devices answered')).toHaveLength(1)
  })

  it('ends when the signal aborts, without yielding what is left', async () => {
    const responder = await respond({ reply: (probe) => [probeMatches(probe.messageId)] })
    const controller = new AbortController()
    const start = performance.now()
    const devices: DiscoveredDevice[] = []
    setTimeout(() => controller.abort(), 200)
    for await (const device of discover({ hosts: [responder.host], timeoutMs: 5_000, signal: controller.signal })) {
      devices.push(device)
      controller.abort()
    }
    expect(devices).toHaveLength(1)
    expect(performance.now() - start).toBeLessThan(1_000)
  })

  it('sends nothing when the signal is already aborted', async () => {
    const responder = await respond()
    const devices = await collect({ hosts: [responder.host], signal: AbortSignal.abort() })
    expect(devices.devices).toEqual([])
    expect(responder.probes).toEqual([])
  })

  it('probes hostnames and reports hosts it cannot send to', async () => {
    const responder = await respond()
    const port = responder.host.split(':')[1]
    const { devices, errors } = await collect({ hosts: [`localhost:${port}`, 'unresolvable.invalid'], timeoutMs: 600 })
    expect(devices).toHaveLength(1)
    expect(errors.length).toBeGreaterThanOrEqual(2)
    expect(errors.every((error) => error instanceof TransportError && error.host === 'unresolvable.invalid')).toBe(true)
  })

  it('throws when no probe could be sent', async () => {
    const error = await rejection(() => collect({ hosts: ['unresolvable.invalid'] }))
    expect(error).toBeInstanceOf(TransportError)
    expect(error).toMatchObject({ service: 'discovery', action: 'Probe', host: 'unresolvable.invalid' })
  })

  it('replies come back to a fixed local port', async () => {
    const responder = await respond()
    const probe = createSocket('udp4')
    probe.bind(0)
    await once(probe, 'listening')
    const { port } = probe.address()
    probe.close()
    await collect({ hosts: [responder.host], port })
    expect(responder.probes[0]?.from.port).toBe(port)
  })

  it('rejects invalid options', async () => {
    for (const options of [
      { timeoutMs: 0 },
      { timeoutMs: Number.NaN },
      { port: 70_000 },
      { hosts: [] },
      { hosts: ['::1'] },
      { hosts: ['[::1]:3702'] },
      { hosts: ['192.0.2.1:0'] },
      { hosts: ['192.0.2.1:x'] },
      { hosts: [':3702'] },
      { interfaces: ['missing0'] }
    ] satisfies DiscoverOptions[]) {
      const error = await rejection(() => collect(options))
      expect(error).toBeInstanceOf(OnvifError)
      expect(error).toMatchObject({ service: 'discovery' })
    }
  })
})

describe('discover by multicast', () => {
  it('fails without an interface that has an IPv4 address', async () => {
    interfaces.current = { lo: [ipv4('127.0.0.1', true)], wlan0: [ipv6Only] }
    await expect(collect({})).rejects.toThrow('No network interface with an IPv4 address to probe')
    await expect(collect({ interfaces: ['wlan0'] })).rejects.toThrow("Network interface 'wlan0' has no IPv4 address")
  })

  it('reports an interface it cannot listen on and fails when none is left', async () => {
    interfaces.current = { eth0: [ipv4('192.0.2.200', false)], eth1: [ipv4('192.0.2.201', false)] }
    const error = await rejection(() => collect({}))
    expect(error).toBeInstanceOf(TransportError)
    expect(error).toMatchObject({ host: '192.0.2.200' })
  })

  it.skipIf(process.platform === 'win32')(
    'probes the multicast group on every address of the chosen interfaces',
    async () => {
      interfaces.current = { lo: [ipv4('127.0.0.1', true)], eth0: [ipv4('192.0.2.200', false)] }
      const responder = await respond({ multicast: true })
      const { devices, errors } = await collect({ interfaces: ['lo', 'eth0'], timeoutMs: 800 })
      expect(devices.map((device) => device.name)).toEqual(['DVC'])
      expect(errors).toEqual([expect.objectContaining({ name: 'TransportError', host: '192.0.2.200' })])
      expect(responder.probes).toHaveLength(6)
      expect(responder.probes.every((probe) => probe.from.address === '127.0.0.1')).toBe(true)
    }
  )
})
