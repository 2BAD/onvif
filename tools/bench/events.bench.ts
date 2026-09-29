import { expect, test } from 'vitest'
import { decodeNotification } from '#onvif-events/notification.ts'
import { PullMessages } from '#onvif-events/generated/events.ts'
import { decode } from '#onvif/soap/codec.ts'
import { parseEnvelope } from '#onvif/soap/envelope.ts'
import { parseXml as fxp } from '#tools/bench/fxp.ts'
import { fixture } from '#tools/fixtures/corpus.ts'
import { workloads } from '#tools/bench/workloads.ts'

const context = { host: 'bench', service: 'tev', action: 'PullMessages' }

const decodeResponse = (xml: string) => {
  const { body } = parseEnvelope(xml, context, undefined, { namespaces: true })
  const response = decode(
    PullMessages.schema,
    PullMessages.response.type,
    body[PullMessages.response.name] ?? '',
    context
  )
  return ((response as { notificationMessage?: [] }).notificationMessage ?? []).map((holder) =>
    decodeNotification(holder, context)
  )
}

const cases = [
  { name: 'dvc capture (7 notifications)', xml: fixture('live/dvc/dcn-bm2220lpr/events.PullMessages.xml').xml },
  { name: 'event batch (210 notifications)', xml: workloads.eventBatch }
]

test.for(cases)('PullMessages $name', async ({ xml }, { bench }) => {
  expect(decodeResponse(xml).length).toBeGreaterThan(0)
  const results = await bench.compare(
    bench('fast-xml-parser, parse only', () => {
      fxp(xml)
    }),
    bench('custom, parse and decode to notifications', () => {
      decodeResponse(xml)
    })
  )
  expect(results.get('custom, parse and decode to notifications').throughput.mean).toBeGreaterThan(
    results.get('fast-xml-parser, parse only').throughput.mean
  )
})
