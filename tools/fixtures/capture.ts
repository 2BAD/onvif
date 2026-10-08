import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import { type DigestChallenge, digestAuthorization, parseChallenge } from '#onvif/transport/digest.ts'

type Capture = { service: string; action: string; status: number; contentType: string; xml: string }
type SendOptions = { authenticated?: boolean; addressing?: { action: string; to: string } }

const host = process.env['ONVIF_TEST_HOST']
const username = process.env['ONVIF_TEST_USER'] ?? ''
const password = process.env['ONVIF_TEST_PASS'] ?? ''
if (!host) throw new Error('ONVIF_TEST_HOST is not set')

// --motion only records PullMessages responses in which motion starts and ends, leaving the other captures as they are
const motionOnly = process.argv.includes('--motion')
// --only <prefix> runs the full capture but only writes responses whose `service.Action` name starts with a prefix
const only = process.argv.flatMap((argument, index) => (process.argv[index - 1] === '--only' ? [argument] : []))
// --set-encoder also sends the first video encoder configuration back unchanged, the only call that writes
const setEncoder = process.argv.includes('--set-encoder')
// --management only records the device management responses, with Get calls only unless --set-device is given
const managementOnly = process.argv.includes('--management')
// --set-device also sends the device management settings back as read, adds and removes a test IP filter entry, toggles
// the first relay and creates, changes and deletes a test user; for the lab camera only
const setDevice = process.argv.includes('--set-device')
// --ptz only records the PTZ responses, with Get calls only unless --move-ptz is given
const ptzOnly = process.argv.includes('--ptz')
// --move-ptz also saves the position as a preset, pans the camera, stops it, tries every move type and returns to the
// preset before removing it; for the lab camera only
const movePtz = process.argv.includes('--move-ptz')
// --stdout prints the scrubbed responses as JSON lines instead of writing them, for devices reached from another machine;
// tools/fixtures/import.ts writes them into a fixture directory
const toStdout = process.argv.includes('--stdout')
const log = toStdout ? console.error : console.log
const MOTION_WAIT_MS = 300_000

const deviceUrl = `http://${host}/onvif/device_service`
const outRoot = join(import.meta.dirname, '../../fixtures/live')
let clockSkewMs = 0

const escapeXml = (value: string): string => value.replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`)

const securityHeader = (): string => {
  const nonce = randomBytes(16)
  const created = new Date(Date.now() + clockSkewMs).toISOString()
  const digest = createHash('sha1')
    .update(Buffer.concat([nonce, Buffer.from(created, 'utf8'), Buffer.from(password, 'utf8')]))
    .digest('base64')
  return (
    '<Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">' +
    `<UsernameToken><Username>${escapeXml(username)}</Username>` +
    `<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password>` +
    `<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</Nonce>` +
    `<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</Created>` +
    '</UsernameToken></Security>'
  )
}

let digest: { challenge: DigestChallenge; count: number } | undefined

type Response = { status: number; contentType: string; authenticate: string; xml: string }

const post = (url: string, headers: Record<string, string>, body: string): Promise<Response> =>
  new Promise((resolve, reject) => {
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

const send = async (url: string, body: string, options: SendOptions): Promise<Omit<Capture, 'service' | 'action'>> => {
  const { authenticated = true, addressing } = options
  const addressingHeader = addressing
    ? `<a:Action s:mustUnderstand="1">${escapeXml(addressing.action)}</a:Action>` +
      `<a:To s:mustUnderstand="1">${escapeXml(addressing.to)}</a:To>`
    : ''
  const signed = authenticated && username !== ''
  const attempt = () => {
    const envelope =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing">' +
      `<s:Header>${addressingHeader}${signed ? securityHeader() : ''}</s:Header>` +
      `<s:Body>${body}</s:Body></s:Envelope>`
    const target = new URL(url)
    if (signed && digest) digest.count += 1
    const authorization =
      signed && digest
        ? digestAuthorization(
            digest.challenge,
            { username, password },
            'POST',
            target.pathname + target.search,
            digest.count
          )
        : undefined
    const headers: Record<string, string> = { 'Content-Type': 'application/soap+xml; charset=utf-8' }
    if (authorization !== undefined) headers['Authorization'] = authorization
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

const serviceXAddr = (servicesXml: string, namespace: string): string | undefined => {
  for (const block of servicesXml.split(/<[\w-]+:Service>/).slice(1)) {
    if (block.includes(`>${namespace}<`)) return firstMatch(block, /<[\w-]+:XAddr>([^<]+)</)
  }
  return undefined
}

const pinToHost = (xaddr: string): string => {
  const url = new URL(xaddr)
  const target = new URL(deviceUrl)
  url.host = target.host
  return url.toString()
}

const probe = async (types: string): Promise<string> => {
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
    socket.send(envelope, 3702, host)
    const [message] = (await once(socket, 'message', { signal: AbortSignal.timeout(5_000) })) as [Buffer]
    return message.toString('utf8')
  } finally {
    socket.close()
  }
}

const captures: Capture[] = []
const capture = async (service: string, action: string, url: string, body: string, options: SendOptions = {}) => {
  const result = await send(url, body, options)
  captures.push({ service, action, ...result })
  log(JSON.stringify({ service, action, status: result.status, bytes: result.xml.length }))
  return result.xml
}

const tds = 'xmlns="http://www.onvif.org/ver10/device/wsdl"'
const tt = 'xmlns="http://www.onvif.org/ver10/schema"'
const trt = 'xmlns="http://www.onvif.org/ver10/media/wsdl"'
const tr2 = 'xmlns="http://www.onvif.org/ver20/media/wsdl"'
const tev = 'xmlns="http://www.onvif.org/ver10/events/wsdl"'
const tptz = 'xmlns="http://www.onvif.org/ver20/ptz/wsdl"'
const wsnt = 'xmlns="http://docs.oasis-open.org/wsn/b-2"'
const pullAction = 'http://www.onvif.org/ver10/events/wsdl/PullPointSubscription/PullMessagesRequest'
const unsubscribeAction = 'http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/UnsubscribeRequest'

const motionStates = (xml: string): string[] =>
  xml
    .split(/<[\w-]+:NotificationMessage>/)
    .slice(1)
    .filter((message) => /Motion/.test(firstMatch(message, /<[\w-]+:Topic[^>]*>([^<]+)</) ?? ''))
    .flatMap((message) =>
      [...message.matchAll(/Name="(?:IsMotion|State)" Value="([^"]*)"/g)].map((match) => match[1] ?? '')
    )

const captureMotion = async (url: string): Promise<void> => {
  const subscriptionXml = (
    await send(
      url,
      `<CreatePullPointSubscription ${tev}><InitialTerminationTime>PT600S</InitialTerminationTime></CreatePullPointSubscription>`,
      {}
    )
  ).xml
  const subscriptionAddress = firstMatch(subscriptionXml, /<[\w-]+:Address>([^<]+)</)
  if (!subscriptionAddress) throw new Error('CreatePullPointSubscription returned no address')
  const subscriptionUrl = pinToHost(subscriptionAddress)
  const addressing = (action: string) => ({ addressing: { action, to: subscriptionAddress } })
  log(`waiting up to ${MOTION_WAIT_MS / 1000} s for motion to start and stop`)
  try {
    const deadline = Date.now() + MOTION_WAIT_MS
    let started = false
    while (Date.now() < deadline) {
      const pulled = await send(
        subscriptionUrl,
        `<PullMessages ${tev}><Timeout>PT10S</Timeout><MessageLimit>50</MessageLimit></PullMessages>`,
        addressing(pullAction)
      )
      const states = motionStates(pulled.xml)
      log(JSON.stringify({ status: pulled.status, motion: states }))
      if (!started && states.includes('true')) {
        captures.push({ service: 'events', action: 'PullMessagesMotion', ...pulled })
        started = true
      } else if (started && states.includes('false')) {
        captures.push({ service: 'events', action: 'PullMessagesMotionEnd', ...pulled })
        return
      }
    }
    throw new Error(started ? 'Motion did not stop in time' : 'No motion in time')
  } finally {
    await send(subscriptionUrl, `<Unsubscribe ${wsnt}/>`, addressing(unsubscribeAction))
  }
}

const elements = (xml: string, name: string): string[] =>
  [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'g'))].map(
    (match) => match[1] ?? ''
  )

const text = (xml: string, name: string): string | undefined => elements(xml, name)[0]?.trim()

const optional = (xml: string, name: string): string => {
  const value = text(xml, name)
  return value === undefined ? '' : `<${name}>${value}</${name}>`
}

// namespace declarations of the response envelope, so prefixed content copied out of it stays valid
const declarations = (xml: string): string =>
  [...(/<[\w-]+:Envelope\b([^>]*)>/.exec(xml)?.[1] ?? '').matchAll(/\sxmlns:[\w-]+="[^"]*"/g)]
    .map((match) => match[0])
    .join('')

const tokenized = (xml: string, name: string): { token: string; content: string } | undefined => {
  const match = new RegExp(`<([\\w-]+:)?${name}\\b[^>]*\\btoken="([^"]+)"[^>]*>([\\s\\S]*?)</\\1${name}>`).exec(xml)
  return match ? { token: match[2] ?? '', content: match[3] ?? '' } : undefined
}

let managementFrom = -1

const captureManagement = async (networkXml: string): Promise<void> => {
  managementFrom = captures.length
  const get = (action: string) => capture('device', action, deviceUrl, `<${action} ${tds}/>`)
  const gatewayXml = await get('GetNetworkDefaultGateway')
  await get('GetUsers')
  const ntpXml = await get('GetNTP')
  const dynamicDnsXml = await get('GetDynamicDNS')
  const zeroXml = await get('GetZeroConfiguration')
  const filterXml = await get('GetIPAddressFilter')
  const relaysXml = await get('GetRelayOutputs')
  if (!setDevice) return

  const set = (action: string, source: string, content: string) =>
    capture('device', action, deviceUrl, `<${action} ${tds}${declarations(source)}>${content}</${action}>`)

  const networkInterface = tokenized(networkXml, 'NetworkInterfaces')
  if (networkInterface) {
    const ipv4 = elements(networkInterface.content, 'IPv4')[0] ?? ''
    const manual = elements(ipv4, 'Manual')
      .map((address) => `<Manual>${address}</Manual>`)
      .join('')
    const mtu = text(networkInterface.content, 'MTU')
    await set(
      'SetNetworkInterfaces',
      networkXml,
      `<InterfaceToken>${networkInterface.token}</InterfaceToken><NetworkInterface>` +
        `<Enabled ${tt}>${text(networkInterface.content, 'Enabled')}</Enabled>` +
        (mtu === undefined ? '' : `<MTU ${tt}>${mtu}</MTU>`) +
        `<IPv4 ${tt}><Enabled>${text(ipv4, 'Enabled')}</Enabled>${manual}<DHCP>${text(ipv4, 'DHCP')}</DHCP></IPv4>` +
        '</NetworkInterface>'
    )
  }

  const gateway = elements(gatewayXml, 'NetworkGateway')[0]
  if (gateway !== undefined) {
    const addresses = ['IPv4Address', 'IPv6Address'].flatMap((name) =>
      elements(gateway, name).map((address) => `<${name}>${address}</${name}>`)
    )
    await set('SetNetworkDefaultGateway', gatewayXml, addresses.join(''))
  }

  const ntp = elements(ntpXml, 'NTPInformation')[0]
  if (ntp !== undefined) {
    const manual = elements(ntp, 'NTPManual')
      .map((host) => `<NTPManual>${host}</NTPManual>`)
      .join('')
    await set('SetNTP', ntpXml, `<FromDHCP>${text(ntp, 'FromDHCP')}</FromDHCP>${manual}`)
  }

  // a nil DynamicDNSInformation is sent back as NoUpdate
  const dynamicDns = elements(dynamicDnsXml, 'DynamicDNSInformation')[0] ?? ''
  await set(
    'SetDynamicDNS',
    dynamicDnsXml,
    `<Type>${text(dynamicDns, 'Type') ?? 'NoUpdate'}</Type>${optional(dynamicDns, 'Name')}${optional(dynamicDns, 'TTL')}`
  )

  const zero = elements(zeroXml, 'ZeroConfiguration')[0]
  if (zero !== undefined) {
    await set('SetZeroConfiguration', zeroXml, `${optional(zero, 'InterfaceToken')}${optional(zero, 'Enabled')}`)
  }

  const filter = elements(filterXml, 'IPAddressFilter')[0]
  if (filter !== undefined) {
    await set('SetIPAddressFilter', filterXml, `<IPAddressFilter>${filter}</IPAddressFilter>`)
    // an Allow filter with one entry would lock everyone else out
    if (text(filter, 'Type') === 'Deny') {
      const entry =
        `<IPAddressFilter><Type ${tt}>Deny</Type><IPv4Address ${tt}><Address>198.51.100.7</Address>` +
        '<PrefixLength>32</PrefixLength></IPv4Address></IPAddressFilter>'
      await set('AddIPAddressFilter', filterXml, entry)
      await set('RemoveIPAddressFilter', filterXml, entry)
    }
  }

  const relay = tokenized(relaysXml, 'RelayOutputs')
  const properties = relay && elements(relay.content, 'Properties')[0]
  if (relay && properties !== undefined) {
    const token = `<RelayOutputToken>${relay.token}</RelayOutputToken>`
    await set('SetRelayOutputSettings', relaysXml, `${token}<Properties>${properties}</Properties>`)
    try {
      await set('SetRelayOutputState', relaysXml, `${token}<LogicalState>active</LogicalState>`)
    } finally {
      await send(
        deviceUrl,
        `<SetRelayOutputState ${tds}>${token}<LogicalState>inactive</LogicalState></SetRelayOutputState>`,
        {}
      )
    }
  }

  const testUser = (level: string) =>
    `<User><Username ${tt}>onviftest</Username><Password ${tt}>${randomBytes(12).toString('base64url')}</Password>` +
    `<UserLevel ${tt}>${level}</UserLevel></User>`
  const deleteTestUser = `<DeleteUsers ${tds}><Username>onviftest</Username></DeleteUsers>`
  await capture('device', 'CreateUsers', deviceUrl, `<CreateUsers ${tds}>${testUser('User')}</CreateUsers>`)
  try {
    await capture('device', 'SetUser', deviceUrl, `<SetUser ${tds}>${testUser('Operator')}</SetUser>`)
    await capture(
      'device',
      'SetUserWithoutPasswordFault',
      deviceUrl,
      `<SetUser ${tds}><User><Username ${tt}>onviftest</Username><UserLevel ${tt}>User</UserLevel></User></SetUser>`
    )
  } finally {
    await capture('device', 'DeleteUsers', deviceUrl, deleteTestUser)
  }
  await capture('device', 'DeleteUsersMissingFault', deviceUrl, deleteTestUser)
}

// Media2 encodings that a Media v1 configuration can carry.
// Writing a configuration with any other encoding back through Media v1 changes its encoding.
const MEDIA1_ENCODINGS = new Set(['JPEG', 'H264', 'MPV4-ES'])

const encodingsByToken = (encodersXml: string): Map<string, string> =>
  new Map(
    [
      ...encodersXml.matchAll(/<([\w-]+):Configurations\b[^>]*\btoken="([^"]+)"[^>]*>([\s\S]*?)<\/\1:Configurations>/g)
    ].map((match) => [match[2] ?? '', text(match[3] ?? '', 'Encoding') ?? ''])
  )

const captureEncoder = async (
  service: string,
  url: string,
  namespace: string,
  encodersXml: string,
  extra: string,
  writable: (token: string) => boolean
): Promise<void> => {
  const encoder = /<([\w-]+):Configurations\b([^>]*)>([\s\S]*?)<\/\1:Configurations>/.exec(encodersXml)
  const token = encoder && firstMatch(encoder[2] ?? '', /token="([^"]+)"/)
  if (!encoder || !token) return
  await capture(
    service,
    'GetVideoEncoderConfigurationOptions',
    url,
    `<GetVideoEncoderConfigurationOptions ${namespace}><ConfigurationToken>${escapeXml(token)}</ConfigurationToken>` +
      '</GetVideoEncoderConfigurationOptions>'
  )
  if (!setEncoder) return
  if (!writable(token)) {
    log(JSON.stringify({ service, action: 'SetVideoEncoderConfiguration', skipped: token }))
    return
  }
  const configuration = `<Configuration xmlns:tt="http://www.onvif.org/ver10/schema"${encoder[2]}>${encoder[3]}</Configuration>`
  await capture(
    service,
    'SetVideoEncoderConfiguration',
    url,
    `<SetVideoEncoderConfiguration ${namespace}>${configuration}${extra}</SetVideoEncoderConfiguration>`
  )
}

const capturePtz = async (servicesXml: string): Promise<void> => {
  const ptzAddress = serviceXAddr(servicesXml, 'http://www.onvif.org/ver20/ptz/wsdl')
  const mediaAddress = serviceXAddr(servicesXml, 'http://www.onvif.org/ver10/media/wsdl')
  if (!ptzAddress) return
  const url = pinToHost(ptzAddress)
  const call = (action: string, content = '', name = action) =>
    capture('ptz', name, url, content === '' ? `<${action} ${tptz}/>` : `<${action} ${tptz}>${content}</${action}>`)
  await call('GetServiceCapabilities')
  const nodesXml = await call('GetNodes')
  const configurationsXml = await call('GetConfigurations')
  const node = tokenized(nodesXml, 'PTZNode')
  if (node) await call('GetNode', `<NodeToken>${escapeXml(node.token)}</NodeToken>`)
  const configuration = tokenized(configurationsXml, 'PTZConfiguration')
  if (configuration) {
    const token = escapeXml(configuration.token)
    await call('GetConfiguration', `<PTZConfigurationToken>${token}</PTZConfigurationToken>`)
    await call('GetConfigurationOptions', `<ConfigurationToken>${token}</ConfigurationToken>`)
  }
  const profilesXml = mediaAddress ? (await send(pinToHost(mediaAddress), `<GetProfiles ${trt}/>`, {})).xml : ''
  const profileToken = firstMatch(profilesXml, /<[\w-]+:Profiles[^>]*token="([^"]+)"/)
  if (!profileToken) return
  const profile = `<ProfileToken>${escapeXml(profileToken)}</ProfileToken>`
  await call('GetStatus', profile)
  await call('GetPresets', profile)
  if (!movePtz) return

  if (configuration) {
    const content =
      `<PTZConfiguration xmlns:tt="http://www.onvif.org/ver10/schema" token="${configuration.token}">` +
      `${configuration.content}</PTZConfiguration><ForcePersistence>true</ForcePersistence>`
    await capture(
      'ptz',
      'SetConfiguration',
      url,
      `<SetConfiguration ${tptz}${declarations(configurationsXml)}>${content}</SetConfiguration>`
    )
  }
  const presetXml = await call('SetPreset', `${profile}<PresetName>onviftest</PresetName>`)
  const presetToken = text(presetXml, 'PresetToken')
  const preset = `<PresetToken>${escapeXml(presetToken ?? '')}</PresetToken>`
  const panTilt = (x: number, y: number) => `<PanTilt ${tt} x="${x}" y="${y}"/>`
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  try {
    await call('GetPresets', profile, 'GetPresetsWithPreset')
    await call('ContinuousMove', `${profile}<Velocity>${panTilt(0.3, 0)}</Velocity><Timeout>PT1S</Timeout>`)
    await call('GetStatus', profile, 'GetStatusMoving')
    await pause(2_000)
    await call('GetStatus', profile, 'GetStatusAfterTimeout')
    await call('ContinuousMove', `${profile}<Velocity>${panTilt(-0.3, 0)}</Velocity>`, 'ContinuousMoveWithoutTimeout')
    await pause(500)
    await call('Stop', `${profile}<PanTilt>true</PanTilt><Zoom>true</Zoom>`)
    await call('GetStatus', profile, 'GetStatusStopped')
    await call(
      'ContinuousMove',
      `${profile}<Velocity><Zoom ${tt} x="0.5"/></Velocity><Timeout>PT1S</Timeout>`,
      'ContinuousMoveZoom'
    )
    await call('Stop', profile, 'StopWithoutAxes')
    await call('RelativeMove', `${profile}<Translation>${panTilt(0.1, 0)}</Translation>`)
    await call('AbsoluteMove', `${profile}<Position>${panTilt(0, 0)}</Position>`)
    await call('Stop', profile, 'StopAfterMoves')
    await call('GotoHomePosition', profile)
    await call('SetHomePosition', profile)
    await call('SendAuxiliaryCommand', `${profile}<AuxiliaryData>tt:Wiper|On</AuxiliaryData>`)
    await call('GotoPreset', `${profile}<PresetToken>missing</PresetToken>`, 'GotoPresetMissing')
  } finally {
    if (presetToken !== undefined) {
      await call('GotoPreset', `${profile}${preset}`)
      await pause(3_000)
      await call('RemovePreset', `${profile}${preset}`)
      await call('RemovePreset', `${profile}${preset}`, 'RemovePresetMissing')
    }
  }
}

const timeXml = await capture('device', 'GetSystemDateAndTime', deviceUrl, `<GetSystemDateAndTime ${tds}/>`, {
  authenticated: false
})
const utc = /<[\w-]+:UTCDateTime>([\s\S]*?)<\/[\w-]+:UTCDateTime>/.exec(timeXml)?.[1]
if (utc) {
  const part = (name: string) => Number(firstMatch(utc, new RegExp(`<[\\w-]+:${name}>(\\d+)<`)))
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

await capture('device', 'GetSystemDateAndTimeUnauthorizedFault', deviceUrl, `<GetDeviceInformation ${tds}/>`, {
  authenticated: false
})
await capture('device', 'UnknownActionFault', deviceUrl, `<GetNonExistentThing ${tds}/>`)
const servicesXml = await capture(
  'device',
  'GetServices',
  deviceUrl,
  `<GetServices ${tds}><IncludeCapability>true</IncludeCapability></GetServices>`
)
await capture(
  'device',
  'GetCapabilities',
  deviceUrl,
  `<GetCapabilities ${tds}><Category>All</Category></GetCapabilities>`
)
const infoXml = await capture('device', 'GetDeviceInformation', deviceUrl, `<GetDeviceInformation ${tds}/>`)
if (motionOnly) {
  const eventsUrl = serviceXAddr(servicesXml, 'http://www.onvif.org/ver10/events/wsdl')
  if (!eventsUrl) throw new Error('The device offers no events service')
  await captureMotion(pinToHost(eventsUrl))
} else if (!ptzOnly) {
  await capture('device', 'GetServiceCapabilities', deviceUrl, `<GetServiceCapabilities ${tds}/>`)
  await capture('device', 'GetScopes', deviceUrl, `<GetScopes ${tds}/>`)
  await capture('device', 'GetHostname', deviceUrl, `<GetHostname ${tds}/>`)
  const networkXml = await capture('device', 'GetNetworkInterfaces', deviceUrl, `<GetNetworkInterfaces ${tds}/>`)
  await captureManagement(networkXml)
}
if (ptzOnly) await capturePtz(servicesXml)
if (!motionOnly && !managementOnly && !ptzOnly) {
  const mediaUrl = serviceXAddr(servicesXml, 'http://www.onvif.org/ver10/media/wsdl')
  const media2Url = serviceXAddr(servicesXml, 'http://www.onvif.org/ver20/media/wsdl')
  const media2Encodings =
    setEncoder && media2Url
      ? encodingsByToken((await send(pinToHost(media2Url), `<GetVideoEncoderConfigurations ${tr2}/>`, {})).xml)
      : undefined
  if (mediaUrl) {
    const url = pinToHost(mediaUrl)
    const profilesXml = await capture('media', 'GetProfiles', url, `<GetProfiles ${trt}/>`)
    await capture('media', 'GetVideoSources', url, `<GetVideoSources ${trt}/>`)
    await capture('media', 'GetVideoSourceConfigurations', url, `<GetVideoSourceConfigurations ${trt}/>`)
    const encodersXml = await capture(
      'media',
      'GetVideoEncoderConfigurations',
      url,
      `<GetVideoEncoderConfigurations ${trt}/>`
    )
    await captureEncoder(
      'media',
      url,
      trt,
      encodersXml,
      '<ForcePersistence>true</ForcePersistence>',
      (token) => media2Encodings === undefined || MEDIA1_ENCODINGS.has(media2Encodings.get(token) ?? '')
    )
    const profileToken = firstMatch(profilesXml, /<[\w-]+:Profiles[^>]*token="([^"]+)"/)
    if (profileToken) {
      const token = `<ProfileToken>${escapeXml(profileToken)}</ProfileToken>`
      await capture('media', 'GetSnapshotUri', url, `<GetSnapshotUri ${trt}>${token}</GetSnapshotUri>`)
      await capture(
        'media',
        'GetStreamUri',
        url,
        `<GetStreamUri ${trt}><StreamSetup><Stream xmlns="http://www.onvif.org/ver10/schema">RTP-Unicast</Stream>` +
          `<Transport xmlns="http://www.onvif.org/ver10/schema"><Protocol>RTSP</Protocol></Transport></StreamSetup>${token}</GetStreamUri>`
      )
    }
  }

  if (media2Url) {
    const url = pinToHost(media2Url)
    const profilesXml = await capture(
      'media2',
      'GetProfiles',
      url,
      `<GetProfiles ${tr2}><Type>All</Type></GetProfiles>`
    )
    await capture('media2', 'GetVideoSourceConfigurations', url, `<GetVideoSourceConfigurations ${tr2}/>`)
    const encodersXml = await capture(
      'media2',
      'GetVideoEncoderConfigurations',
      url,
      `<GetVideoEncoderConfigurations ${tr2}/>`
    )
    await captureEncoder('media2', url, tr2, encodersXml, '', () => true)
    const profileToken = firstMatch(profilesXml, /<[\w-]+:Profiles[^>]*token="([^"]+)"/)
    if (profileToken) {
      const token = `<ProfileToken>${escapeXml(profileToken)}</ProfileToken>`
      await capture('media2', 'GetSnapshotUri', url, `<GetSnapshotUri ${tr2}>${token}</GetSnapshotUri>`)
      await capture(
        'media2',
        'GetStreamUri',
        url,
        `<GetStreamUri ${tr2}><Protocol>RTSP</Protocol>${token}</GetStreamUri>`
      )
    }
  }

  await capturePtz(servicesXml)

  const eventsUrl = serviceXAddr(servicesXml, 'http://www.onvif.org/ver10/events/wsdl')
  if (eventsUrl) {
    const url = pinToHost(eventsUrl)
    await capture('events', 'GetServiceCapabilities', url, `<GetServiceCapabilities ${tev}/>`)
    await capture('events', 'GetEventProperties', url, `<GetEventProperties ${tev}/>`)
    const subscriptionXml = await capture(
      'events',
      'CreatePullPointSubscription',
      url,
      `<CreatePullPointSubscription ${tev}><InitialTerminationTime>PT60S</InitialTerminationTime></CreatePullPointSubscription>`
    )
    const subscriptionAddress = firstMatch(subscriptionXml, /<[\w-]+:Address>([^<]+)</)
    if (subscriptionAddress) {
      const subscriptionUrl = pinToHost(subscriptionAddress)
      await capture(
        'events',
        'PullMessages',
        subscriptionUrl,
        `<PullMessages ${tev}><Timeout>PT5S</Timeout><MessageLimit>50</MessageLimit></PullMessages>`,
        { addressing: { action: pullAction, to: subscriptionAddress } }
      )
      await capture('events', 'Unsubscribe', subscriptionUrl, `<Unsubscribe ${wsnt}/>`, {
        addressing: { action: unsubscribeAction, to: subscriptionAddress }
      })
    }
  }

  for (const [action, types] of [
    ['ProbeMatches', 'dn:NetworkVideoTransmitter'],
    ['ProbeMatchesDevice', 'tds:Device']
  ] as const) {
    const xml = await probe(types)
    captures.push({ service: 'discovery', action, status: 200, contentType: 'application/soap+xml', xml })
    log(JSON.stringify({ service: 'discovery', action, bytes: xml.length }))
  }
}

const vendor = firstMatch(infoXml, /<[\w-]+:Manufacturer>([^<]+)</) ?? 'unknown'
const model = firstMatch(infoXml, /<[\w-]+:Model>([^<]+)</) ?? 'unknown'
const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
const outDir = join(outRoot, slug(vendor), slug(model))
if (!toStdout) await mkdir(outDir, { recursive: true })

const sensitive = [
  firstMatch(infoXml, /<[\w-]+:SerialNumber>([^<]+)</),
  firstMatch(infoXml, /<[\w-]+:HardwareId>([^<]+)</),
  username,
  password
].filter((value): value is string => value !== undefined && value.length > 2)

const replacements = new Map<string, string>()
const pseudonym = (value: string, kind: string): string => {
  const existing = replacements.get(value)
  if (existing) return existing
  const next =
    kind === 'ip'
      ? `192.0.2.${replacements.size + 10}`
      : kind === 'mac'
        ? `02:00:00:00:00:${(replacements.size + 16).toString(16).padStart(2, '0')}`
        : kind === 'ipv6'
          ? `${value.startsWith('fe80:') ? 'fe80' : '2001:db8'}::${(replacements.size + 1).toString(16)}`
          : kind === 'host'
            ? `host${replacements.size + 1}.example`
            : kind === 'uuid'
              ? `00000000-0000-4000-8000-${(replacements.size + 1).toString().padStart(12, '0')}`
              : `REDACTED${replacements.size + 1}`
  replacements.set(value, next)
  return next
}

const isNonIdentifyingIp = (ip: string): boolean => {
  const firstOctet = Number(ip.split('.')[0])
  return firstOctet === 0 || firstOctet === 255 || (firstOctet >= 224 && firstOctet <= 239)
}

const scrub = (xml: string): string => {
  let result = xml
  for (const value of sensitive) result = result.split(value).join(pseudonym(value, 'text'))
  return result
    .replace(/:\/\/[^/@\s<"]+:[^/@\s<"]+@/g, '://')
    .replace(/(<[\w-]+:(?:Password|Nonce)\b[^>]*>)[^<]*/g, '$1REDACTED')
    .replace(
      /(onvif:\/\/www\.onvif\.org\/(?:name|location)\/)([^\s<]+)/gi,
      (_, scope: string, value: string) => `${scope}${pseudonym(value, 'text')}`
    )
    .replace(
      /(<[\w-]+:HostnameInformation\b[^>]*>(?:(?!HostnameInformation>)[\s\S])*?<[\w-]+:Name>)([^<]+)/g,
      (_, start: string, name: string) => `${start}${pseudonym(name, 'text')}`
    )
    .replace(/(<[\w-]+:Username>)([^<]+)/g, (_, start: string, name: string) =>
      name.startsWith('REDACTED') ? `${start}${name}` : `${start}${pseudonym(name, 'text')}`
    )
    .replace(/(<[\w-]+:DNSname>)([^<]+)/g, (_, start: string, name: string) => `${start}${pseudonym(name, 'host')}`)
    .replace(
      /(<[\w-]+:DynamicDNSInformation\b[^>]*>(?:(?!DynamicDNSInformation>)[\s\S])*?<[\w-]+:Name>)([^<]+)/g,
      (_, start: string, name: string) => `${start}${pseudonym(name, 'host')}`
    )
    .replace(
      /(<[\w-]+:(?:IPv6Address|Address)>)([0-9a-f]*:[0-9a-f:]*)</gi,
      (_, start: string, ip: string) => `${start}${pseudonym(ip.toLowerCase(), 'ipv6')}<`
    )
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (ip) => (isNonIdentifyingIp(ip) ? ip : pseudonym(ip, 'ip')))
    .replace(/\[([0-9a-f:]+)\]/gi, (_, ip: string) => `[${pseudonym(ip.toLowerCase(), 'ipv6')}]`)
    .replace(/\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/gi, (mac) => pseudonym(mac.toLowerCase(), 'mac'))
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, (uuid) =>
      pseudonym(uuid.toLowerCase(), 'uuid')
    )
}

const manifestPath = join(outDir, 'manifest.json')
let previous: { capturedAt?: string; responses?: Record<string, unknown> } = {}
try {
  previous = JSON.parse(await readFile(manifestPath, 'utf8')) as typeof previous
} catch {
  previous = {}
}
const responses: Record<string, unknown> = { ...previous.responses }
let written = 0
for (const [index, { service, action, status, contentType, xml }] of captures.entries()) {
  // scrub every response in the same order, so pseudonyms match those of a full capture
  const scrubbed = scrub(xml)
  if (motionOnly && !action.startsWith('PullMessagesMotion')) continue
  if (managementOnly && index < managementFrom) continue
  if (ptzOnly && service !== 'ptz') continue
  const name = `${service}.${action}`
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
const capturedAt = motionOnly || managementOnly || ptzOnly || only.length > 0 ? (previous.capturedAt ?? today) : today
if (!toStdout) await writeFile(manifestPath, `${JSON.stringify({ capturedAt, vendor, model, responses }, null, 2)}\n`)
log(JSON.stringify({ outDir, files: written }))
