import { once } from 'node:events'
import { Agent, createServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { workloads } from '#tools/bench/workloads.ts'

const envelope = (body: string): string =>
  `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body>${body}</s:Body></s:Envelope>`

const server = createServer((incoming, outgoing) => {
  incoming.resume()
  incoming.on('end', () => {
    outgoing.writeHead(200, { 'Content-Type': 'application/soap+xml; charset=utf-8' })
    outgoing.end(workloads.large)
  })
})
let localUrl = ''

beforeAll(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  localUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/onvif/Media`
})

afterAll(() => {
  server.closeAllConnections()
  server.close()
})

const viaFetch = async (url: string, body: string): Promise<string> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
    body
  })
  return await response.text()
}

const viaNodeHttp = (url: string, body: string, agent: Agent): Promise<string> =>
  new Promise((resolve, reject) => {
    const outgoing = request(
      url,
      {
        method: 'POST',
        agent,
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        response.on('error', reject)
      }
    )
    outgoing.on('error', reject)
    outgoing.end(body)
  })

test('GetProfiles round trip against a local server', async ({ bench }) => {
  const body = envelope('<GetProfiles xmlns="http://www.onvif.org/ver10/media/wsdl"/>')
  const keepAlive = new Agent({ keepAlive: true, maxSockets: 1 })
  const noKeepAlive = new Agent({ keepAlive: false })
  const results = await bench.compare(
    bench('fetch', async () => {
      await viaFetch(localUrl, body)
    }),
    bench('node:http keep-alive', async () => {
      await viaNodeHttp(localUrl, body, keepAlive)
    }),
    bench('node:http new connection', async () => {
      await viaNodeHttp(localUrl, body, noKeepAlive)
    })
  )
  keepAlive.destroy()
  noKeepAlive.destroy()
  expect(results.get('node:http keep-alive').throughput.mean).toBeGreaterThan(results.get('fetch').throughput.mean)
})

const liveHost = process.env['ONVIF_TEST_HOST']

test.skipIf(!liveHost)('GetSystemDateAndTime round trip on a live device', async ({ bench }) => {
  const url = `http://${liveHost}/onvif/device_service`
  const body = envelope('<GetSystemDateAndTime xmlns="http://www.onvif.org/ver10/device/wsdl"/>')
  const keepAlive = new Agent({ keepAlive: true, maxSockets: 1 })
  const results = await bench.compare(
    bench('fetch', async () => {
      await viaFetch(url, body)
    }),
    bench('node:http keep-alive', async () => {
      await viaNodeHttp(url, body, keepAlive)
    }),
    { time: 3000 }
  )
  keepAlive.destroy()
  expect(results.get('fetch').latency.samplesCount).toBeGreaterThan(0)
})
