import type { XmlObject } from '#onvif/soap/parse.ts'

export type MockEventsOptions = {
  /** Lifetime the device grants to a pull point, whatever the client asks for. */
  terminationMs?: number
  /** Extend the termination time on every PullMessages, as the spec intends. Axis and some gSOAP devices do not. */
  extendOnPull?: boolean
  /** Give every pull point the same address and an Axis `SubscriptionId` reference parameter to tell them apart. */
  referenceParameters?: boolean
  /** Answer Renew with ActionNotSupported. */
  renew?: boolean
  /** Leave the optional CurrentTime out of RenewResponse. */
  renewCurrentTime?: boolean
  /** Report subscription addresses without a host, as RaySharp does (`http:///onvif/...`). */
  hostlessAddress?: boolean
  /** Fault CreatePullPointSubscription once this many pull points exist. */
  maxPullPoints?: number
}

export type PullPointState = { id: number; address: string; terminationAt: number; pulls: number }

type PullPoint = PullPointState & { path: string; pending: string[]; wake: (() => void) | undefined }

export type EventReply = { status: number; body: string }

const EVENTS = 'http://www.onvif.org/ver10/events/wsdl'
const AXIS = 'http://www.axis.com/2009/event'

const text = (node: unknown): string | undefined => {
  if (typeof node === 'string') return node
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return undefined
  const value = (node as XmlObject)['_']
  return typeof value === 'string' ? value : undefined
}

const child = (node: unknown, name: string): unknown =>
  typeof node === 'object' && node !== null && !Array.isArray(node) ? (node as XmlObject)[name] : undefined

const durationMs = (value: string | undefined, now: number): number | undefined => {
  if (value === undefined) return undefined
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value.trim())
  if (match) return ((Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 60 + Number(match[3] ?? 0)) * 1000
  const absolute = Date.parse(value)
  return Number.isNaN(absolute) ? undefined : absolute - now
}

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

/**
 * A notification in the shape the DVC camera sends for the cell motion detector.
 *
 * @param isMotion - Value of the `IsMotion` item
 * @param operation - PropertyOperation of the message
 * @returns A `wsnt:NotificationMessage` element
 */
export const motionNotification = (isMotion: boolean, operation = 'Changed'): string =>
  '<wsnt:NotificationMessage><wsnt:Topic Dialect="http://www.onvif.org/ver10/tev/topicExpression/ConcreteSet">' +
  'tns1:RuleEngine/CellMotionDetector/Motion</wsnt:Topic><wsnt:Message>' +
  `<tt:Message UtcTime="${new Date().toISOString()}" PropertyOperation="${operation}"><tt:Source>` +
  '<tt:SimpleItem Name="VideoSourceConfigurationToken" Value="VideoSource_token_1"/>' +
  '<tt:SimpleItem Name="VideoAnalyticsConfigurationToken" Value="VideoAnalytics0"/>' +
  '<tt:SimpleItem Name="Rule" Value="MotionDetectorRule"/></tt:Source>' +
  `<tt:Data><tt:SimpleItem Name="IsMotion" Value="${isMotion}"/></tt:Data></tt:Message></wsnt:Message>` +
  '</wsnt:NotificationMessage>'

/**
 * Pull point state of the mock camera: CreatePullPointSubscription, PullMessages as a long poll, Renew,
 * SetSynchronizationPoint and Unsubscribe, with the device quirks in `MockEventsOptions`.
 */
export class MockEvents {
  readonly #options: MockEventsOptions
  readonly #pullPoints = new Map<number, PullPoint>()
  readonly #timers = new Set<NodeJS.Timeout>()
  readonly #envelopeStart: string
  readonly #initial: string[]
  #next = 1

  constructor(pullMessagesFixture: string, options: MockEventsOptions = {}) {
    this.#options = options
    const declarations = (/<[\w.-]+:Envelope([^>]*)>/.exec(pullMessagesFixture)?.[1] ?? '').replaceAll(
      /\s+xmlns:(SOAP-ENV|wsa5)="[^"]*"/g,
      ''
    )
    this.#envelopeStart =
      '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" ' +
      `xmlns:wsa5="http://www.w3.org/2005/08/addressing"${declarations}>`
    this.#initial = pullMessagesFixture.match(/<wsnt:NotificationMessage>[\s\S]*?<\/wsnt:NotificationMessage>/g) ?? []
  }

  get pullPoints(): PullPointState[] {
    return [...this.#pullPoints.values()].map(({ id, address, terminationAt, pulls }) => ({
      id,
      address,
      terminationAt,
      pulls
    }))
  }

  emit(notification: string): void {
    for (const pullPoint of this.#pullPoints.values()) {
      pullPoint.pending.push(notification)
      pullPoint.wake?.()
    }
  }

  expireAll(): void {
    this.#pullPoints.clear()
  }

  close(): void {
    for (const timer of this.#timers) clearTimeout(timer)
    this.#timers.clear()
  }

  async handle(
    action: string,
    path: string,
    host: string,
    envelope: unknown,
    clock: () => number
  ): Promise<EventReply> {
    const now = clock()
    const body = child(child(envelope, 'Envelope'), 'Body')
    const header = child(child(envelope, 'Envelope'), 'Header')
    const request = child(body, action)
    if (action === 'CreatePullPointSubscription') return this.#create(request, host, now)

    const pullPoint = this.#find(path, header, now)
    if (!pullPoint) {
      return this.#fault('wsrf-rw:ResourceUnknownFault', 'The subscription does not exist or has expired.')
    }
    switch (action) {
      case 'PullMessages':
        return await this.#pull(pullPoint, request, clock)
      case 'Renew': {
        if (this.#options.renew === false) {
          return this.#fault('wsa5:ActionNotSupported', 'The [action] cannot be processed at the receiver.')
        }
        const requested = durationMs(text(child(request, 'TerminationTime')), now)
        pullPoint.terminationAt = now + (this.#options.terminationMs ?? requested ?? 60_000)
        return this.#reply(
          'http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/RenewResponse',
          `<wsnt:RenewResponse><wsnt:TerminationTime>${iso(pullPoint.terminationAt)}</wsnt:TerminationTime>` +
            `${this.#options.renewCurrentTime === false ? '' : `<wsnt:CurrentTime>${iso(now)}</wsnt:CurrentTime>`}` +
            '</wsnt:RenewResponse>'
        )
      }
      case 'SetSynchronizationPoint':
        pullPoint.pending.push(...this.#initial)
        pullPoint.wake?.()
        return this.#reply(
          `${EVENTS}/PullPointSubscription/SetSynchronizationPointResponse`,
          '<tev:SetSynchronizationPointResponse/>'
        )
      case 'Unsubscribe':
        this.#pullPoints.delete(pullPoint.id)
        pullPoint.wake?.()
        return this.#reply(
          'http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/UnsubscribeResponse',
          '<wsnt:UnsubscribeResponse/>'
        )
      default:
        return this.#fault('wsa5:ActionNotSupported', `Unknown events action ${action}`)
    }
  }

  #create(request: unknown, host: string, now: number): EventReply {
    const { maxPullPoints, terminationMs, referenceParameters, hostlessAddress } = this.#options
    if (maxPullPoints !== undefined && this.#pullPoints.size >= maxPullPoints) {
      return this.#fault('wsntw:SubscribeCreationFailedFault', 'Maximum number of pull points reached.')
    }
    const requested = durationMs(text(child(request, 'InitialTerminationTime')), now)
    const id = this.#next++
    const path = referenceParameters ? '/onvif/services' : `/onvif/event/subsription_${id}`
    const address = `http://${hostlessAddress ? '' : host}${path}`
    const pullPoint: PullPoint = {
      id,
      path,
      address,
      terminationAt: now + (terminationMs ?? requested ?? 60_000),
      pulls: 0,
      pending: [...this.#initial],
      wake: undefined
    }
    this.#pullPoints.set(id, pullPoint)
    const parameters = referenceParameters
      ? `<wsa5:ReferenceParameters><dom0:SubscriptionId xmlns:dom0="${AXIS}">${id}</dom0:SubscriptionId>` +
        '</wsa5:ReferenceParameters>'
      : ''
    return this.#reply(
      `${EVENTS}/EventPortType/CreatePullPointSubscriptionResponse`,
      `<tev:CreatePullPointSubscriptionResponse><tev:SubscriptionReference><wsa5:Address>${address}</wsa5:Address>` +
        `${parameters}</tev:SubscriptionReference><wsnt:CurrentTime>${iso(now)}</wsnt:CurrentTime>` +
        `<wsnt:TerminationTime>${iso(pullPoint.terminationAt)}</wsnt:TerminationTime>` +
        '</tev:CreatePullPointSubscriptionResponse>'
    )
  }

  #find(path: string, header: unknown, now: number): PullPoint | undefined {
    let pullPoint: PullPoint | undefined
    if (this.#options.referenceParameters) {
      pullPoint = this.#pullPoints.get(Number(text(child(header, 'SubscriptionId'))))
    } else {
      pullPoint = [...this.#pullPoints.values()].find((candidate) => candidate.path === path)
    }
    if (pullPoint && now > pullPoint.terminationAt) {
      this.#pullPoints.delete(pullPoint.id)
      return undefined
    }
    return pullPoint
  }

  async #pull(pullPoint: PullPoint, request: unknown, clock: () => number): Promise<EventReply> {
    const now = clock()
    pullPoint.pulls++
    const timeoutMs = durationMs(text(child(request, 'Timeout')), now) ?? 60_000
    const limit = Number(text(child(request, 'MessageLimit')) ?? 1)
    if (pullPoint.pending.length === 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.#timers.delete(timer)
          pullPoint.wake = undefined
          resolve()
        }, timeoutMs)
        this.#timers.add(timer)
        pullPoint.wake = () => {
          clearTimeout(timer)
          this.#timers.delete(timer)
          pullPoint.wake = undefined
          resolve()
        }
      })
    }
    const current = clock()
    if (this.#options.extendOnPull !== false) {
      pullPoint.terminationAt = Math.max(pullPoint.terminationAt, current + (this.#options.terminationMs ?? 60_000))
    }
    const messages = pullPoint.pending.splice(0, limit)
    return this.#reply(
      `${EVENTS}/PullPointSubscription/PullMessagesResponse`,
      `<tev:PullMessagesResponse><tev:CurrentTime>${iso(current)}</tev:CurrentTime>` +
        `<tev:TerminationTime>${iso(pullPoint.terminationAt)}</tev:TerminationTime>${messages.join('')}` +
        '</tev:PullMessagesResponse>'
    )
  }

  #reply(action: string, body: string): EventReply {
    return {
      status: 200,
      body:
        `<?xml version="1.0" encoding="UTF-8"?>${this.#envelopeStart}<SOAP-ENV:Header>` +
        `<wsa5:Action SOAP-ENV:mustUnderstand="true">${action}</wsa5:Action></SOAP-ENV:Header>` +
        `<SOAP-ENV:Body>${body}</SOAP-ENV:Body></SOAP-ENV:Envelope>`
    }
  }

  #fault(subcode: string, reason: string): EventReply {
    return {
      status: 400,
      body:
        `<?xml version="1.0" encoding="UTF-8"?>${this.#envelopeStart}<SOAP-ENV:Body><SOAP-ENV:Fault>` +
        `<SOAP-ENV:Code><SOAP-ENV:Value>SOAP-ENV:Receiver</SOAP-ENV:Value><SOAP-ENV:Subcode><SOAP-ENV:Value>${subcode}` +
        `</SOAP-ENV:Value></SOAP-ENV:Subcode></SOAP-ENV:Code><SOAP-ENV:Reason><SOAP-ENV:Text xml:lang="en">${reason}` +
        '</SOAP-ENV:Text></SOAP-ENV:Reason></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>'
    }
  }
}
