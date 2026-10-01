import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

type Capture = { service: string; action: string; status: number; contentType: string; xml: string }
type SendOptions = { authenticated?: boolean; addressing?: { action: string; to: string } }

const host = process.env['ONVIF_TEST_HOST']
const username = process.env['ONVIF_TEST_USER'] ?? ''
const password = process.env['ONVIF_TEST_PASS'] ?? ''
if (!host) throw new Error('ONVIF_TEST_HOST is not set')

// --motion only records PullMessages responses in which motion starts and ends, leaving the other captures as they are
const motionOnly = process.argv.includes('--motion')
// --media2 runs the full capture but only writes the Media2 responses
const media2Only = process.argv.includes('--media2')
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

const send = async (url: string, body: string, options: SendOptions): Promise<Omit<Capture, 'service' | 'action'>> => {
  const { authenticated = true, addressing } = options
  const addressingHeader = addressing
    ? `<a:Action s:mustUnderstand="1">${escapeXml(addressing.action)}</a:Action>` +
      `<a:To s:mustUnderstand="1">${escapeXml(addressing.to)}</a:To>`
    : ''
  const envelope =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing">' +
    `<s:Header>${addressingHeader}${authenticated && username ? securityHeader() : ''}</s:Header>` +
    `<s:Body>${body}</s:Body></s:Envelope>`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
    body: envelope,
    signal: AbortSignal.timeout(15_000)
  })
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    xml: await response.text()
  }
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

const captures: Capture[] = []
const capture = async (service: string, action: string, url: string, body: string, options: SendOptions = {}) => {
  const result = await send(url, body, options)
  captures.push({ service, action, ...result })
  console.log(JSON.stringify({ service, action, status: result.status, bytes: result.xml.length }))
  return result.xml
}

const tds = 'xmlns="http://www.onvif.org/ver10/device/wsdl"'
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
  console.log(`waiting up to ${MOTION_WAIT_MS / 1000} s for motion to start and stop`)
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
      console.log(JSON.stringify({ status: pulled.status, motion: states }))
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
} else {
  await capture('device', 'GetServiceCapabilities', deviceUrl, `<GetServiceCapabilities ${tds}/>`)
  await capture('device', 'GetScopes', deviceUrl, `<GetScopes ${tds}/>`)
  await capture('device', 'GetHostname', deviceUrl, `<GetHostname ${tds}/>`)
  await capture('device', 'GetNetworkInterfaces', deviceUrl, `<GetNetworkInterfaces ${tds}/>`)

  const mediaUrl = serviceXAddr(servicesXml, 'http://www.onvif.org/ver10/media/wsdl')
  if (mediaUrl) {
    const url = pinToHost(mediaUrl)
    const profilesXml = await capture('media', 'GetProfiles', url, `<GetProfiles ${trt}/>`)
    await capture('media', 'GetVideoSources', url, `<GetVideoSources ${trt}/>`)
    await capture('media', 'GetVideoSourceConfigurations', url, `<GetVideoSourceConfigurations ${trt}/>`)
    await capture('media', 'GetVideoEncoderConfigurations', url, `<GetVideoEncoderConfigurations ${trt}/>`)
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

  const media2Url = serviceXAddr(servicesXml, 'http://www.onvif.org/ver20/media/wsdl')
  if (media2Url) {
    const url = pinToHost(media2Url)
    const profilesXml = await capture(
      'media2',
      'GetProfiles',
      url,
      `<GetProfiles ${tr2}><Type>All</Type></GetProfiles>`
    )
    await capture('media2', 'GetVideoSourceConfigurations', url, `<GetVideoSourceConfigurations ${tr2}/>`)
    await capture('media2', 'GetVideoEncoderConfigurations', url, `<GetVideoEncoderConfigurations ${tr2}/>`)
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

  const ptzUrl = serviceXAddr(servicesXml, 'http://www.onvif.org/ver20/ptz/wsdl')
  if (ptzUrl) {
    await capture('ptz', 'GetNodes', pinToHost(ptzUrl), `<GetNodes ${tptz}/>`)
    await capture('ptz', 'GetConfigurations', pinToHost(ptzUrl), `<GetConfigurations ${tptz}/>`)
  }

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
}

const vendor = firstMatch(infoXml, /<[\w-]+:Manufacturer>([^<]+)</) ?? 'unknown'
const model = firstMatch(infoXml, /<[\w-]+:Model>([^<]+)</) ?? 'unknown'
const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
const outDir = join(outRoot, slug(vendor), slug(model))
await mkdir(outDir, { recursive: true })

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
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (ip) => (isNonIdentifyingIp(ip) ? ip : pseudonym(ip, 'ip')))
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
for (const { service, action, status, contentType, xml } of captures) {
  // scrub every response in the same order, so pseudonyms match those of a full capture
  const scrubbed = scrub(xml)
  if (motionOnly && !action.startsWith('PullMessagesMotion')) continue
  if (media2Only && service !== 'media2') continue
  const name = `${service}.${action}`
  responses[name] = { status, contentType }
  await writeFile(join(outDir, `${name}.xml`), scrubbed)
  written += 1
}
const today = new Date().toISOString().slice(0, 10)
const capturedAt = motionOnly || media2Only ? (previous.capturedAt ?? today) : today
await writeFile(manifestPath, `${JSON.stringify({ capturedAt, vendor, model, responses }, null, 2)}\n`)
console.log(JSON.stringify({ outDir, files: written }))
