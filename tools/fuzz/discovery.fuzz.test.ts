import { array, assert, constantFrom, oneof, property, string, stringMatching, tuple } from 'fast-check'
import { describe, expect, it } from 'vitest'
import { OnvifError } from '#onvif/errors.ts'
import { readProbeMatches } from '#onvif-discovery/message.ts'
import { fixture } from '#tools/fixtures/corpus.ts'
import { applyMutation, hostileSnippets, mutation } from '#tools/fuzz/mutation.ts'

const numRuns = Number(process.env['FUZZ_RUNS'] ?? 2000)
const timeout = Math.max(30_000, numRuns * 20)
const prototypeKeyCount = Object.getOwnPropertyNames(Object.prototype).length
const probeId = 'urn:uuid:3c0b0a62-4b5e-4f0c-9a43-8f6c2f2b1d11'
const probes = new Set([probeId])
const sender = '192.0.2.14'

const replies = [
  fixture('live/dvc/dcn-bm2220lpr/discovery.ProbeMatches.xml').xml.replace(/(<wsa:RelatesTo>)[^<]*/, `$1${probeId}`),
  fixture('upstream/Probe.xml').xml.replace('RELATES_TO', probeId).replaceAll('192.0.2.1', sender)
]

const readsOrRejects = (xml: string): void => {
  for (const policy of ['sender', 'any'] as const) {
    try {
      const { devices } = readProbeMatches(xml, sender, probes, policy)
      for (const device of devices) {
        expect(device.endpoint.length).toBeGreaterThan(0)
        for (const xaddr of device.xaddrs) {
          expect(['http:', 'https:']).toContain(xaddr.protocol)
          if (policy === 'sender') expect(xaddr.hostname).toBe(sender)
        }
      }
    } catch (error) {
      if (!(error instanceof OnvifError)) throw error
    }
  }
  if (Object.getOwnPropertyNames(Object.prototype).length !== prototypeKeyCount || 'polluted' in {}) {
    throw new Error('Object.prototype was modified')
  }
}

const listValue = array(
  oneof(
    stringMatching(/^[a-z]{1,6}:[A-Za-z]{1,12}$/),
    constantFrom(
      'http://192.0.2.14/onvif/device_service',
      'https://192.0.2.14:443/',
      'http://192.0.2.15/',
      'http://192.0.2.14@192.0.2.15/',
      'http://192.0.2.15#@192.0.2.14/',
      'http://[fe80::1%25eth0]/',
      'javascript:alert(1)',
      'onvif://www.onvif.org/name/%E0%A4%A',
      'onvif://www.onvif.org/Profile/__proto__',
      '__proto__:constructor'
    ),
    string({ maxLength: 24 }).map((value) => value.replace(/[<&]/g, ''))
  ),
  { maxLength: 6 }
).map((values) => values.join(' '))

describe('discovery reply fuzzing', () => {
  it(
    'only throws OnvifError on arbitrary input',
    () => {
      expect(() => {
        assert(property(string({ unit: 'binary', maxLength: 512 }), readsOrRejects), { numRuns })
      }).not.toThrow()
    },
    timeout
  )

  it(
    'only throws OnvifError on mutated replies',
    () => {
      const mutations = array(mutation, { minLength: 1, maxLength: 8 })
      expect(() => {
        assert(
          property(constantFrom(...replies), mutations, (xml, changes) =>
            readsOrRejects(changes.reduce(applyMutation, xml))
          ),
          { numRuns }
        )
      }).not.toThrow()
    },
    timeout
  )

  it(
    'keeps only HTTP addresses on the sender whatever the lists hold',
    () => {
      const field = constantFrom('Types', 'Scopes', 'XAddrs')
      expect(() => {
        assert(
          property(constantFrom(...replies), array(tuple(field, listValue), { maxLength: 4 }), (xml, fields) =>
            readsOrRejects(
              fields.reduce(
                (reply, [name, value]) => reply.replace(new RegExp(`(<[\\w-]+:${name}>)[^<]*`), `$1${value}`),
                xml
              )
            )
          ),
          { numRuns }
        )
      }).not.toThrow()
    },
    timeout
  )

  it('reads hostile snippets in any list without throwing other errors', () => {
    expect(() => {
      for (const snippet of hostileSnippets) {
        for (const reply of replies) readsOrRejects(reply.replace(/(<[\w-]+:XAddrs>)/, `$1${snippet}`))
      }
    }).not.toThrow()
  })
})
