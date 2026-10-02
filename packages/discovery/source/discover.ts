import { createSocket, type Socket } from 'node:dgram'
import { isIP } from 'node:net'
import { networkInterfaces } from 'node:os'
import { OnvifError, TransportError } from '@2bad/onvif'
import { buildProbe, type DiscoveredDevice, readProbeMatches, type XAddrPolicy } from '#message.ts'

export type DiscoverOptions = {
  /** How long to wait for replies, 3 000 ms by default. */
  timeoutMs?: number
  /**
   * Names of the network interfaces to probe by multicast, as `os.networkInterfaces()` lists them. Every IPv4 address
   * of every interface except loopback by default.
   */
  interfaces?: string[]
  /**
   * Probe these hosts directly instead of by multicast, for devices on another subnet or behind a VPN. IPv4 addresses
   * or hostnames, with an optional `:port` (3702 by default).
   */
  hosts?: string[]
  /** Local port replies come back to, for firewalls that only let a fixed port in. A random port by default. */
  port?: number
  /** Service addresses on a host other than the one that replied: `sender` drops them (default), `any` keeps them. */
  xaddrs?: XAddrPolicy
  /** Receives replies that could not be read and probes that could not be sent. Discovery goes on after each one. */
  onError?: (error: OnvifError) => void
  /** Ends the discovery when aborted. */
  signal?: AbortSignal
}

type Target = { bind: string | undefined; destinations: { address: string; port: number }[]; repeats: number }

const MULTICAST_ADDRESS = '239.255.255.250'
const DISCOVERY_PORT = 3702
const DEFAULT_TIMEOUT_MS = 3_000
// SOAP-over-UDP: a multicast message is repeated twice and a unicast one once, after a random 50 to 250 ms delay
// that doubles for each further repeat up to 500 ms
const MULTICAST_REPEATS = 2
const UNICAST_REPEATS = 1
const MIN_DELAY_MS = 50
const MAX_DELAY_MS = 250
const UPPER_DELAY_MS = 500
const MAX_DEVICES = 4_096

const context = { service: 'discovery', action: 'Probe' }

const parseHost = (entry: string): { address: string; port: number } => {
  const colon = entry.lastIndexOf(':')
  const address = colon === -1 ? entry : entry.slice(0, colon)
  const port = colon === -1 ? DISCOVERY_PORT : Number(entry.slice(colon + 1))
  if (address.length === 0 || address.includes(':') || isIP(address) === 6 || !isPort(port) || port === 0) {
    throw new OnvifError(`Invalid discovery host '${entry.slice(0, 200)}'`, context)
  }
  return { address, port }
}

const isPort = (port: number): boolean => Number.isInteger(port) && port >= 0 && port <= 65_535

const multicastTargets = (names: string[] | undefined): Target[] => {
  const interfaces = networkInterfaces()
  const chosen = names ?? Object.keys(interfaces)
  const targets: Target[] = []
  for (const name of chosen) {
    const addresses = interfaces[name]
    if (addresses === undefined) throw new OnvifError(`Unknown network interface '${name.slice(0, 200)}'`, context)
    const ipv4 = addresses.filter((info) => info.family === 'IPv4' && (names !== undefined || !info.internal))
    if (names !== undefined && ipv4.length === 0) {
      throw new OnvifError(`Network interface '${name.slice(0, 200)}' has no IPv4 address`, context)
    }
    for (const info of ipv4) {
      targets.push({
        bind: info.address,
        destinations: [{ address: MULTICAST_ADDRESS, port: DISCOVERY_PORT }],
        repeats: MULTICAST_REPEATS
      })
    }
  }
  if (targets.length === 0) throw new OnvifError('No network interface with an IPv4 address to probe', context)
  return targets
}

const errorOf = (error: unknown, message: string, host: string | undefined): OnvifError =>
  error instanceof OnvifError
    ? error
    : new TransportError(message, host === undefined ? context : { ...context, host }, { cause: error })

const open = (bind: string | undefined, port: number): Promise<Socket> => {
  const socket = createSocket({ type: 'udp4', reuseAddr: port !== 0 })
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      socket.close()
      reject(errorOf(error, `Cannot listen for discovery replies on ${bind ?? 'all addresses'}`, bind))
    }
    socket.once('error', onError)
    socket.bind({ port, ...(bind === undefined ? {} : { address: bind }) }, () => {
      socket.off('error', onError)
      resolve(socket)
    })
  })
}

const send = (socket: Socket, message: string, destination: { address: string; port: number }): Promise<void> =>
  new Promise((resolve, reject) => {
    socket.send(message, destination.port, destination.address, (failure) => {
      if (!failure) {
        resolve()
        return
      }
      reject(errorOf(failure, `Cannot send a discovery probe to ${destination.address}`, destination.address))
    })
  })

const delay = (attempt: number): number =>
  Math.min(UPPER_DELAY_MS, (MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS)) * 2 ** attempt)

/**
 * Find ONVIF devices with a WS-Discovery probe. Yields each device once, as its first reply arrives, and ends when the
 * timeout passes, the signal aborts or the loop is left.
 *
 * @param options - Timeout, interfaces or hosts to probe, address policy, error callback and abort signal
 * @yields Each device that answered, once
 * @throws {OnvifError} If an option is invalid or no interface has an IPv4 address
 * @throws {TransportError} If no probe could be sent at all
 */
export async function* discover(options: DiscoverOptions = {}): AsyncGenerator<DiscoveredDevice, void, undefined> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, port = 0, xaddrs = 'sender', onError = () => {}, signal } = options
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new OnvifError('Discovery timeout must be a positive number of milliseconds', context)
  }
  if (!isPort(port)) throw new OnvifError(`Invalid local port ${port}`, context)
  if (options.hosts?.length === 0) throw new OnvifError('No discovery host to probe', context)
  const targets: Target[] = options.hosts
    ? [{ bind: undefined, destinations: options.hosts.map(parseHost), repeats: UNICAST_REPEATS }]
    : multicastTargets(options.interfaces)
  if (signal?.aborted) return

  const queue: DiscoveredDevice[] = []
  const seen = new Set<string>()
  const timers = new Set<NodeJS.Timeout>()
  const sockets: Socket[] = []
  const probes = [buildProbe('NetworkVideoTransmitter'), buildProbe('Device')]
  const messageIds = new Set(probes.map((probe) => probe.messageId))
  let finished = false
  let overflowReported = false
  let wake = () => {}
  const finish = () => {
    finished = true
    wake()
  }

  const receive = (message: Buffer, sender: string) => {
    let reply: ReturnType<typeof readProbeMatches>
    try {
      reply = readProbeMatches(message.toString('utf8'), sender, messageIds, xaddrs)
    } catch (error) {
      onError(errorOf(error, 'Cannot read a discovery reply', sender))
      return
    }
    for (const error of reply.errors) onError(error)
    for (const device of reply.devices) {
      if (seen.has(device.endpoint)) continue
      if (seen.size >= MAX_DEVICES) {
        if (!overflowReported) onError(new OnvifError(`More than ${MAX_DEVICES} devices answered`, context))
        overflowReported = true
        return
      }
      seen.add(device.endpoint)
      queue.push(device)
      wake()
    }
  }

  signal?.addEventListener('abort', finish, { once: true })
  try {
    const opened = await Promise.allSettled(targets.map((target) => open(target.bind, port)))
    const sends: Promise<void>[] = []
    opened.forEach((result, index) => {
      if (result.status === 'rejected') return
      const socket = result.value
      const target = targets[index] as Target
      sockets.push(socket)
      socket.on('message', (message, remote) => receive(message, remote.address))
      socket.on('error', (error) => onError(errorOf(error, 'Discovery socket failed', target.bind)))
      if (target.bind !== undefined) {
        socket.setMulticastInterface(target.bind)
        socket.setMulticastTTL(1)
      }
      for (const destination of target.destinations) {
        for (const probe of probes) {
          sends.push(send(socket, probe.xml, destination))
          let waited = 0
          for (let attempt = 0; attempt < target.repeats; attempt++) {
            waited += delay(attempt)
            const timer = setTimeout(async () => {
              timers.delete(timer)
              try {
                await send(socket, probe.xml, destination)
              } catch (error) {
                onError(errorOf(error, 'Cannot send a discovery probe', destination.address))
              }
            }, waited)
            timers.add(timer)
          }
        }
      }
    })
    const sent = await Promise.allSettled(sends)
    const failures = [...opened, ...sent].flatMap((result) => (result.status === 'rejected' ? [result.reason] : []))
    if (!sent.some((result) => result.status === 'fulfilled')) {
      throw errorOf(failures[0], 'Cannot send a discovery probe', undefined)
    }
    for (const failure of failures) onError(errorOf(failure, 'Cannot send a discovery probe', undefined))

    const timeout = setTimeout(finish, timeoutMs)
    timers.add(timeout)
    while (true) {
      if (signal?.aborted) return
      const device = queue.shift()
      if (device !== undefined) {
        yield device
        continue
      }
      if (finished) return
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
  } finally {
    signal?.removeEventListener('abort', finish)
    for (const timer of timers) clearTimeout(timer)
    for (const socket of sockets) socket.close()
  }
}
