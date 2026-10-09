import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import { type DigestChallenge, digestAuthorization, parseChallenge } from '#onvif/transport/digest.ts'

type Response = { status: number; contentType: string; xml: string }
type SendOptions = { authenticated?: boolean; addressing?: { action: string; to: string } }

const host = process.env['ONVIF_TEST_HOST']
const username = process.env['ONVIF_TEST_USER'] ?? ''
const password = process.env['ONVIF_TEST_PASS'] ?? ''
if (!host) throw new Error('ONVIF_TEST_HOST is not set')

const suites = ['device', 'management', 'media', 'ptz', 'events', 'discovery', 'motion']
const args = process.argv.slice(2)
const only = args.filter((_, index) => args[index - 1] === '--only')
const named = args.filter((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--only')
for (const name of named) if (!suites.includes(name)) throw new Error(`Unknown suite ${name}`)
const selected = named.length > 0 ? named : suites.filter((suite) => suite !== 'motion')
const write = args.includes('--write')
const toStdout = args.includes('--stdout')
const log = toStdout ? console.error : console.log

const ns = {
  tds: 'http://www.onvif.org/ver10/device/wsdl',
  tt: 'http://www.onvif.org/ver10/schema',
  trt: 'http://www.onvif.org/ver10/media/wsdl',
  tr2: 'http://www.onvif.org/ver20/media/wsdl',
  tev: 'http://www.onvif.org/ver10/events/wsdl',
  tptz: 'http://www.onvif.org/ver20/ptz/wsdl',
  wsnt: 'http://docs.oasis-open.org/wsn/b-2'
}
const tt = `xmlns="${ns.tt}"`
const deviceUrl = `http://${host}/onvif/device_service`
let clockSkewMs = 0
let digest: { challenge: DigestChallenge; count: number } | undefined

const escapeXml = (value: string): string => value.replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`)

const securityHeader = (): string => {
  const nonce = randomBytes(16)
  const created = new Date(Date.now() + clockSkewMs).toISOString()
  const passwordDigest = createHash('sha1')
    .update(Buffer.concat([nonce, Buffer.from(created, 'utf8'), Buffer.from(password, 'utf8')]))
    .digest('base64')
  return (
    '<Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">' +
    `<UsernameToken><Username>${escapeXml(username)}</Username>` +
    `<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${passwordDigest}</Password>` +
    `<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</Nonce>` +
    `<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</Created>` +
    '</UsernameToken></Security>'
  )
}

const post = (url: string, headers: Record<string, string>, body: string) =>
  new Promise<Response & { authenticate: string }>((resolve, reject) => {
    const outgoing = request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
        signal: AbortSignal.timeout(15_000)
      },
      (incoming) => {
        const chunks: Buffer[] = []
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
        incoming.on('error', reject)
        incoming.on('end', () =>
          resolve({
            status: incoming.statusCode ?? 0,
            contentType: incoming.headers['content-type'] ?? '',
            authenticate: incoming.headers['www-authenticate'] ?? '',
            xml: Buffer.concat(chunks).toString('utf8')
          })
        )
      }
    )
    outgoing.on('error', reject)
    outgoing.end(body)
  })

const send = async (url: string, body: string, options: SendOptions = {}): Promise<Response> => {
  const { authenticated = true, addressing } = options
  const signed = authenticated && username !== ''
  const attempt = () => {
    const header =
      (addressing
        ? `<a:Action s:mustUnderstand="1">${addressing.action}</a:Action><a:To s:mustUnderstand="1">${addressing.to}</a:To>`
        : '') + (signed ? securityHeader() : '')
    const envelope =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing">' +
      `<s:Header>${header}</s:Header><s:Body>${body}</s:Body></s:Envelope>`
    const headers: Record<string, string> = { 'Content-Type': 'application/soap+xml; charset=utf-8' }
    if (signed && digest) {
      digest.count += 1
      const { pathname, search } = new URL(url)
      headers['Authorization'] = digestAuthorization(
        digest.challenge,
        { username, password },
        'POST',
        pathname + search,
        digest.count
      )
    }
    return post(url, headers, envelope)
  }
  let response = await attempt()
  const challenge = response.status === 401 ? parseChallenge([response.authenticate]) : undefined
  if (signed && challenge) {
    digest = { challenge, count: 0 }
    response = await attempt()
  }
  const { status, contentType, xml } = response
  return { status, contentType, xml }
}

const firstMatch = (xml: string, pattern: RegExp): string | undefined => pattern.exec(xml)?.[1]

const elements = (xml: string, name: string): string[] =>
  [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'g'))].map(
    (match) => match[1] ?? ''
  )

const text = (xml: string, name: string): string | undefined => elements(xml, name)[0]?.trim()

const optional = (xml: string, name: string): string => {
  const value = text(xml, name)
  return value === undefined ? '' : `<${name}>${value}</${name}>`
}

const tokenized = (xml: string, name: string) =>
  [
    ...xml.matchAll(new RegExp(`<([\\w-]+:)?${name}\\b([^>]*\\btoken="([^"]+)"[^>]*)>([\\s\\S]*?)</\\1${name}>`, 'g'))
  ].map((match) => ({ attributes: match[2] ?? '', token: match[3] ?? '', content: match[4] ?? '' }))

// namespace declarations of a response envelope, so prefixed content copied out of it stays valid
const declarations = (xml: string): string =>
  [...(/<[\w-]+:Envelope\b([^>]*)>/.exec(xml)?.[1] ?? '').matchAll(/\sxmlns:[\w-]+="[^"]*"/g)]
    .map((match) => match[0])
    .join('')

const captures: (Response & { suite: string; name: string })[] = []

const record = (suite: string, name: string, response: Response): string => {
  captures.push({ suite, name, ...response })
  log(JSON.stringify({ name, status: response.status, bytes: response.xml.length }))
  return response.xml
}

const client = (suite: string, service: string, url: string, namespace: string, options: SendOptions = {}) => {
  const body = (action: string, content: string, source?: string) =>
    content === ''
      ? `<${action} xmlns="${namespace}"/>`
      : `<${action} xmlns="${namespace}"${source ? declarations(source) : ''}>${content}</${action}>`
  return {
    send: (action: string, content = '') => send(url, body(action, content), options),
    call: async (action: string, content = '', { as = action, from = '' } = {}) =>
      record(suite, `${service}.${as}`, await send(url, body(action, content, from), options))
  }
}

const pinToHost = (address: string): string => {
  const url = new URL(address)
  url.host = new URL(deviceUrl).host
  return url.toString()
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const device = client('device', 'device', deviceUrl, ns.tds)
const anonymous = client('device', 'device', deviceUrl, ns.tds, { authenticated: false })
const timeXml = await anonymous.call('GetSystemDateAndTime')
const utc = elements(timeXml, 'UTCDateTime')[0]
if (utc) {
  const part = (name: string) => Number(text(utc, name))
  const deviceTime = Date.UTC(
    part('Year'),
    part('Month') - 1,
    part('Day'),
    part('Hour'),
    part('Minute'),
    part('Second')
  )
  clockSkewMs = deviceTime - Date.now()
}
await anonymous.call('GetDeviceInformation', '', { as: 'GetSystemDateAndTimeUnauthorizedFault' })
await device.call('GetNonExistentThing', '', { as: 'UnknownActionFault' })
const servicesXml = await device.call('GetServices', '<IncludeCapability>true</IncludeCapability>')
await device.call('GetCapabilities', '<Category>All</Category>')
const infoXml = await device.call('GetDeviceInformation')
await device.call('GetServiceCapabilities')
await device.call('GetScopes')
await device.call('GetHostname')
const networkXml = await device.call('GetNetworkInterfaces')

const serviceUrl = (namespace: string): string | undefined => {
  const block = servicesXml
    .split(/<[\w-]+:Service>/)
    .slice(1)
    .find((candidate) => candidate.includes(`>${namespace}<`))
  const address = block && firstMatch(block, /<[\w-]+:XAddr>([^<]+)</)
  return address && pinToHost(address)
}

const profileToken = async (): Promise<string | undefined> => {
  const url = serviceUrl(ns.trt)
  return url && tokenized((await client('', 'media', url, ns.trt).send('GetProfiles')).xml, 'Profiles')[0]?.token
}

const captureManagement = async (): Promise<void> => {
  const management = client('management', 'device', deviceUrl, ns.tds)
  const gatewayXml = await management.call('GetNetworkDefaultGateway')
  await management.call('GetUsers')
  const ntpXml = await management.call('GetNTP')
  const dynamicDnsXml = await management.call('GetDynamicDNS')
  const zeroXml = await management.call('GetZeroConfiguration')
  const filterXml = await management.call('GetIPAddressFilter')
  const relaysXml = await management.call('GetRelayOutputs')
  if (!write) return

  const [networkInterface] = tokenized(networkXml, 'NetworkInterfaces')
  if (networkInterface) {
    const ipv4 = elements(networkInterface.content, 'IPv4')[0] ?? ''
    const manual = elements(ipv4, 'Manual')
      .map((address) => `<Manual>${address}</Manual>`)
      .join('')
    const mtu = text(networkInterface.content, 'MTU')
    await management.call(
      'SetNetworkInterfaces',
      `<InterfaceToken>${networkInterface.token}</InterfaceToken><NetworkInterface>` +
        `<Enabled ${tt}>${text(networkInterface.content, 'Enabled')}</Enabled>` +
        (mtu === undefined ? '' : `<MTU ${tt}>${mtu}</MTU>`) +
        `<IPv4 ${tt}><Enabled>${text(ipv4, 'Enabled')}</Enabled>${manual}<DHCP>${text(ipv4, 'DHCP')}</DHCP></IPv4>` +
        '</NetworkInterface>',
      { from: networkXml }
    )
  }

  const gateway = elements(gatewayXml, 'NetworkGateway')[0]
  if (gateway !== undefined) {
    const addresses = ['IPv4Address', 'IPv6Address'].flatMap((name) =>
      elements(gateway, name).map((address) => `<${name}>${address}</${name}>`)
    )
    await management.call('SetNetworkDefaultGateway', addresses.join(''), { from: gatewayXml })
  }

  const ntp = elements(ntpXml, 'NTPInformation')[0]
  if (ntp !== undefined) {
    const manual = elements(ntp, 'NTPManual')
      .map((server) => `<NTPManual>${server}</NTPManual>`)
      .join('')
    await management.call('SetNTP', `<FromDHCP>${text(ntp, 'FromDHCP')}</FromDHCP>${manual}`, { from: ntpXml })
  }

  // a nil DynamicDNSInformation is sent back as NoUpdate
  const dynamicDns = elements(dynamicDnsXml, 'DynamicDNSInformation')[0] ?? ''
  await management.call(
    'SetDynamicDNS',
    `<Type>${text(dynamicDns, 'Type') ?? 'NoUpdate'}</Type>${optional(dynamicDns, 'Name')}${optional(dynamicDns, 'TTL')}`,
    { from: dynamicDnsXml }
  )

  const zero = elements(zeroXml, 'ZeroConfiguration')[0]
  if (zero !== undefined) {
    const content = `${optional(zero, 'InterfaceToken')}${optional(zero, 'Enabled')}`
    await management.call('SetZeroConfiguration', content, { from: zeroXml })
  }

  const filter = elements(filterXml, 'IPAddressFilter')[0]
  if (filter !== undefined) {
    await management.call('SetIPAddressFilter', `<IPAddressFilter>${filter}</IPAddressFilter>`, { from: filterXml })
    // an Allow filter with one entry would lock everyone else out
    if (text(filter, 'Type') === 'Deny') {
      const entry =
        `<IPAddressFilter><Type ${tt}>Deny</Type><IPv4Address ${tt}><Address>198.51.100.7</Address>` +
        '<PrefixLength>32</PrefixLength></IPv4Address></IPAddressFilter>'
      await management.call('AddIPAddressFilter', entry, { from: filterXml })
      await management.call('RemoveIPAddressFilter', entry, { from: filterXml })
    }
  }

  const [relay] = tokenized(relaysXml, 'RelayOutputs')
  const properties = relay && elements(relay.content, 'Properties')[0]
  if (relay && properties !== undefined) {
    const token = `<RelayOutputToken>${relay.token}</RelayOutputToken>`
    await management.call('SetRelayOutputSettings', `${token}<Properties>${properties}</Properties>`, {
      from: relaysXml
    })
    try {
      await management.call('SetRelayOutputState', `${token}<LogicalState>active</LogicalState>`, { from: relaysXml })
    } finally {
      await management.send('SetRelayOutputState', `${token}<LogicalState>inactive</LogicalState>`)
    }
  }

  const testUser = (level: string) =>
    `<User><Username ${tt}>onviftest</Username><Password ${tt}>${randomBytes(12).toString('base64url')}</Password>` +
    `<UserLevel ${tt}>${level}</UserLevel></User>`
  const deleteTestUser = '<Username>onviftest</Username>'
  await management.call('CreateUsers', testUser('User'))
  try {
    await management.call('SetUser', testUser('Operator'))
    await management.call(
      'SetUser',
      `<User><Username ${tt}>onviftest</Username><UserLevel ${tt}>User</UserLevel></User>`,
      { as: 'SetUserWithoutPasswordFault' }
    )
  } finally {
    await management.call('DeleteUsers', deleteTestUser)
  }
  await management.call('DeleteUsers', deleteTestUser, { as: 'DeleteUsersMissingFault' })
}

// Media2 encodings that a Media v1 configuration can carry.
// Writing a configuration with any other encoding back through Media v1 changes its encoding.
const MEDIA1_ENCODINGS = new Set(['JPEG', 'H264', 'MPV4-ES'])

const captureMedia = async (): Promise<void> => {
  const media1Url = serviceUrl(ns.trt)
  const media2Url = serviceUrl(ns.tr2)
  const media2 = media2Url && client('media', 'media2', media2Url, ns.tr2)
  const media2Encodings =
    write && media2
      ? new Map(
          tokenized((await media2.send('GetVideoEncoderConfigurations')).xml, 'Configurations').map(
            ({ token, content }) => [token, text(content, 'Encoding') ?? '']
          )
        )
      : undefined
  const services = [
    media1Url && {
      media: client('media', 'media', media1Url, ns.trt),
      profiles: '',
      sources: true,
      stream: `<StreamSetup><Stream ${tt}>RTP-Unicast</Stream><Transport ${tt}><Protocol>RTSP</Protocol></Transport></StreamSetup>`,
      persistence: '<ForcePersistence>true</ForcePersistence>',
      writable: (token: string) =>
        media2Encodings === undefined || MEDIA1_ENCODINGS.has(media2Encodings.get(token) ?? '')
    },
    media2 && {
      media: media2,
      profiles: '<Type>All</Type>',
      sources: false,
      stream: '<Protocol>RTSP</Protocol>',
      persistence: '',
      writable: () => true
    }
  ]
  for (const service of services) {
    if (!service) continue
    const { media } = service
    const profilesXml = await media.call('GetProfiles', service.profiles)
    if (service.sources) await media.call('GetVideoSources')
    await media.call('GetVideoSourceConfigurations')
    const [encoder] = tokenized(await media.call('GetVideoEncoderConfigurations'), 'Configurations')
    if (encoder) {
      await media.call(
        'GetVideoEncoderConfigurationOptions',
        `<ConfigurationToken>${encoder.token}</ConfigurationToken>`
      )
      if (write && service.writable(encoder.token)) {
        await media.call(
          'SetVideoEncoderConfiguration',
          `<Configuration xmlns:tt="${ns.tt}"${encoder.attributes}>${encoder.content}</Configuration>${service.persistence}`
        )
      } else if (write) {
        log(JSON.stringify({ skipped: 'SetVideoEncoderConfiguration', token: encoder.token }))
      }
    }
    const [profile] = tokenized(profilesXml, 'Profiles')
    if (profile) {
      const token = `<ProfileToken>${profile.token}</ProfileToken>`
      await media.call('GetSnapshotUri', token)
      await media.call('GetStreamUri', `${service.stream}${token}`)
    }
  }
}

const capturePtz = async (): Promise<void> => {
  const url = serviceUrl(ns.tptz)
  if (!url) return
  const ptz = client('ptz', 'ptz', url, ns.tptz)
  await ptz.call('GetServiceCapabilities')
  const [node] = tokenized(await ptz.call('GetNodes'), 'PTZNode')
  const configurationsXml = await ptz.call('GetConfigurations')
  if (node) await ptz.call('GetNode', `<NodeToken>${node.token}</NodeToken>`)
  const [configuration] = tokenized(configurationsXml, 'PTZConfiguration')
  if (configuration) {
    await ptz.call('GetConfiguration', `<PTZConfigurationToken>${configuration.token}</PTZConfigurationToken>`)
    await ptz.call('GetConfigurationOptions', `<ConfigurationToken>${configuration.token}</ConfigurationToken>`)
  }
  const token = await profileToken()
  if (!token) return
  const profile = `<ProfileToken>${token}</ProfileToken>`
  await ptz.call('GetStatus', profile)
  await ptz.call('GetPresets', profile)
  if (!write) return

  if (configuration) {
    await ptz.call(
      'SetConfiguration',
      `<PTZConfiguration xmlns:tt="${ns.tt}" token="${configuration.token}">${configuration.content}</PTZConfiguration>` +
        '<ForcePersistence>true</ForcePersistence>',
      { from: configurationsXml }
    )
  }
  const presetToken = text(await ptz.call('SetPreset', `${profile}<PresetName>onviftest</PresetName>`), 'PresetToken')
  const panTilt = (x: number, y: number) => `<PanTilt ${tt} x="${x}" y="${y}"/>`
  try {
    await ptz.call('GetPresets', profile, { as: 'GetPresetsWithPreset' })
    await ptz.call('ContinuousMove', `${profile}<Velocity>${panTilt(0.3, 0)}</Velocity><Timeout>PT1S</Timeout>`)
    await ptz.call('GetStatus', profile, { as: 'GetStatusMoving' })
    await pause(2_000)
    await ptz.call('GetStatus', profile, { as: 'GetStatusAfterTimeout' })
    await ptz.call('ContinuousMove', `${profile}<Velocity>${panTilt(-0.3, 0)}</Velocity>`, {
      as: 'ContinuousMoveWithoutTimeout'
    })
    await pause(500)
    await ptz.call('Stop', `${profile}<PanTilt>true</PanTilt><Zoom>true</Zoom>`)
    await ptz.call('GetStatus', profile, { as: 'GetStatusStopped' })
    await ptz.call('ContinuousMove', `${profile}<Velocity><Zoom ${tt} x="0.5"/></Velocity><Timeout>PT1S</Timeout>`, {
      as: 'ContinuousMoveZoom'
    })
    await ptz.call('Stop', profile, { as: 'StopWithoutAxes' })
    await ptz.call('RelativeMove', `${profile}<Translation>${panTilt(0.1, 0)}</Translation>`)
    await ptz.call('AbsoluteMove', `${profile}<Position>${panTilt(0, 0)}</Position>`)
    await ptz.call('Stop', profile, { as: 'StopAfterMoves' })
    await ptz.call('GotoHomePosition', profile)
    await ptz.call('SetHomePosition', profile)
    await ptz.call('SendAuxiliaryCommand', `${profile}<AuxiliaryData>tt:Wiper|On</AuxiliaryData>`)
    await ptz.call('GotoPreset', `${profile}<PresetToken>missing</PresetToken>`, { as: 'GotoPresetMissing' })
  } finally {
    if (presetToken !== undefined) {
      const preset = `${profile}<PresetToken>${presetToken}</PresetToken>`
      await ptz.call('GotoPreset', preset)
      await pause(3_000)
      await ptz.call('RemovePreset', preset)
      await ptz.call('RemovePreset', preset, { as: 'RemovePresetMissing' })
    }
  }
}

const subscription = (suite: string, subscriptionXml: string) => {
  const address = firstMatch(subscriptionXml, /<[\w-]+:Address>([^<]+)</)
  if (!address) return undefined
  const addressed = (namespace: string, action: string) =>
    client(suite, 'events', pinToHost(address), namespace, { addressing: { action, to: address } })
  return {
    pullPoint: addressed(ns.tev, `${ns.tev}/PullPointSubscription/PullMessagesRequest`),
    manager: addressed(ns.wsnt, 'http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/UnsubscribeRequest')
  }
}

const captureEvents = async (): Promise<void> => {
  const url = serviceUrl(ns.tev)
  if (!url) return
  const events = client('events', 'events', url, ns.tev)
  await events.call('GetServiceCapabilities')
  await events.call('GetEventProperties')
  const created = subscription(
    'events',
    await events.call('CreatePullPointSubscription', '<InitialTerminationTime>PT60S</InitialTerminationTime>')
  )
  if (!created) return
  await created.pullPoint.call('PullMessages', '<Timeout>PT5S</Timeout><MessageLimit>50</MessageLimit>')
  await created.manager.call('Unsubscribe')
}

const motionStates = (xml: string): string[] =>
  elements(xml, 'NotificationMessage')
    .filter((message) => /Motion/.test(text(message, 'Topic') ?? ''))
    .flatMap((message) =>
      [...message.matchAll(/Name="(?:IsMotion|State)" Value="([^"]*)"/g)].map((match) => match[1] ?? '')
    )

const captureMotion = async (): Promise<void> => {
  const url = serviceUrl(ns.tev)
  if (!url) throw new Error('The device offers no events service')
  const created = subscription(
    'motion',
    (
      await client('motion', 'events', url, ns.tev).send(
        'CreatePullPointSubscription',
        '<InitialTerminationTime>PT600S</InitialTerminationTime>'
      )
    ).xml
  )
  if (!created) throw new Error('CreatePullPointSubscription returned no address')
  log('waiting up to 300 s for motion to start and stop')
  try {
    const deadline = Date.now() + 300_000
    let started = false
    while (Date.now() < deadline) {
      const pulled = await created.pullPoint.send(
        'PullMessages',
        '<Timeout>PT10S</Timeout><MessageLimit>50</MessageLimit>'
      )
      const states = motionStates(pulled.xml)
      log(JSON.stringify({ status: pulled.status, motion: states }))
      if (!started && states.includes('true')) {
        record('motion', 'events.PullMessagesMotion', pulled)
        started = true
      } else if (started && states.includes('false')) {
        record('motion', 'events.PullMessagesMotionEnd', pulled)
        return
      }
    }
    throw new Error(started ? 'Motion did not stop in time' : 'No motion in time')
  } finally {
    await created.manager.send('Unsubscribe')
  }
}

const probe = async (types: string): Promise<Response> => {
  const socket = createSocket('udp4')
  try {
    socket.bind(0)
    await once(socket, 'listening')
    const envelope =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" ' +
      'xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl" ' +
      'xmlns:tds="http://www.onvif.org/ver10/device/wsdl">' +
      `<s:Header><a:MessageID>urn:uuid:${randomUUID()}</a:MessageID>` +
      '<a:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To>' +
      '<a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action></s:Header>' +
      `<s:Body><d:Probe><d:Types>${types}</d:Types><d:Scopes/></d:Probe></s:Body></s:Envelope>`
    socket.send(envelope, 3702, new URL(deviceUrl).hostname)
    const [message] = (await once(socket, 'message', { signal: AbortSignal.timeout(5_000) })) as [Buffer]
    return { status: 200, contentType: 'application/soap+xml', xml: message.toString('utf8') }
  } finally {
    socket.close()
  }
}

const captureDiscovery = async (): Promise<void> => {
  record('discovery', 'discovery.ProbeMatches', await probe('dn:NetworkVideoTransmitter'))
  record('discovery', 'discovery.ProbeMatchesDevice', await probe('tds:Device'))
}

const runs: Record<string, () => Promise<void>> = {
  management: captureManagement,
  media: captureMedia,
  ptz: capturePtz,
  events: captureEvents,
  discovery: captureDiscovery,
  motion: captureMotion
}
for (const suite of suites) if (selected.includes(suite)) await runs[suite]?.()

const sensitive = [text(infoXml, 'SerialNumber'), text(infoXml, 'HardwareId'), username, password].filter(
  (value): value is string => value !== undefined && value.length > 2
)

const replacements = new Map<string, string>()
const pseudonyms: Record<string, (index: number, value: string) => string> = {
  text: (index) => `REDACTED${index}`,
  host: (index) => `host${index}.example`,
  ip: (index) => `192.0.2.${index + 9}`,
  ipv6: (index, value) => `${value.startsWith('fe80:') ? 'fe80' : '2001:db8'}::${index.toString(16)}`,
  mac: (index) => `02:00:00:00:00:${(index + 15).toString(16).padStart(2, '0')}`,
  uuid: (index) => `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`
}
const pseudonym = (kind: string) => (value: string) => {
  const replacement = replacements.get(value) ?? pseudonyms[kind]?.(replacements.size + 1, value) ?? ''
  replacements.set(value, replacement)
  return replacement
}
const replaceGroup =
  (kind: string) =>
  (_: string, start: string, value: string): string =>
    `${start}${pseudonym(kind)(value)}`

const isNonIdentifyingIp = (ip: string): boolean => {
  const firstOctet = Number(ip.split('.')[0])
  return firstOctet === 0 || firstOctet === 255 || (firstOctet >= 224 && firstOctet <= 239)
}

const scrub = (xml: string): string =>
  sensitive
    .reduce((result, value) => result.split(value).join(pseudonym('text')(value)), xml)
    .replace(/:\/\/[^/@\s<"]+:[^/@\s<"]+@/g, '://')
    .replace(/(<[\w-]+:(?:Password|Nonce)\b[^>]*>)[^<]*/g, '$1REDACTED')
    .replace(/(onvif:\/\/www\.onvif\.org\/(?:name|location)\/)([^\s<]+)/gi, replaceGroup('text'))
    .replace(
      /(<[\w-]+:HostnameInformation\b[^>]*>(?:(?!HostnameInformation>)[\s\S])*?<[\w-]+:Name>)([^<]+)/g,
      replaceGroup('text')
    )
    .replace(/(<[\w-]+:Username>)([^<]+)/g, (match: string, start: string, name: string) =>
      name.startsWith('REDACTED') ? match : `${start}${pseudonym('text')(name)}`
    )
    .replace(/(<[\w-]+:DNSname>)([^<]+)/g, replaceGroup('host'))
    .replace(
      /(<[\w-]+:DynamicDNSInformation\b[^>]*>(?:(?!DynamicDNSInformation>)[\s\S])*?<[\w-]+:Name>)([^<]+)/g,
      replaceGroup('host')
    )
    .replace(
      /(<[\w-]+:(?:IPv6Address|Address)>)([0-9a-f]*:[0-9a-f:]*)</gi,
      (_, start: string, ip: string) => `${start}${pseudonym('ipv6')(ip.toLowerCase())}<`
    )
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (ip) => (isNonIdentifyingIp(ip) ? ip : pseudonym('ip')(ip)))
    .replace(/\[([0-9a-f:]+)\]/gi, (_, ip: string) => `[${pseudonym('ipv6')(ip.toLowerCase())}]`)
    .replace(/\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/gi, (mac) => pseudonym('mac')(mac.toLowerCase()))
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, (uuid) =>
      pseudonym('uuid')(uuid.toLowerCase())
    )

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
const vendor = text(infoXml, 'Manufacturer') ?? 'unknown'
const model = text(infoXml, 'Model') ?? 'unknown'
const outDir = join(import.meta.dirname, '../../fixtures/live', slug(vendor), slug(model))
const manifestPath = join(outDir, 'manifest.json')
let previous: { capturedAt?: string; responses?: Record<string, unknown> } = {}
try {
  previous = JSON.parse(await readFile(manifestPath, 'utf8')) as typeof previous
} catch {
  previous = {}
}
const responses: Record<string, unknown> = { ...previous.responses }
let written = 0
if (!toStdout) await mkdir(outDir, { recursive: true })
for (const { suite, name, status, contentType, xml } of captures) {
  // scrub every response in the same order, so pseudonyms match those of a full capture
  const scrubbed = scrub(xml)
  if (!selected.includes(suite)) continue
  if (only.length > 0 && !only.some((prefix) => name.startsWith(prefix))) continue
  written += 1
  if (toStdout) {
    console.log(JSON.stringify({ name, status, contentType, xml: scrubbed }))
    continue
  }
  responses[name] = { status, contentType }
  await writeFile(join(outDir, `${name}.xml`), scrubbed)
}
const today = new Date().toISOString().slice(0, 10)
const capturedAt = named.length > 0 || only.length > 0 ? (previous.capturedAt ?? today) : today
if (!toStdout) await writeFile(manifestPath, `${JSON.stringify({ capturedAt, vendor, model, responses }, null, 2)}\n`)
log(JSON.stringify({ outDir, files: written }))
