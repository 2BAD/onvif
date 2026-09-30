import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { Device } from '#onvif/device.ts'
import { fetchSnapshot } from '#onvif-media/media.ts'
import { type MockCamera, startMockCamera } from '#tools/mock-camera/server.ts'

const snapshot = readFileSync(join(import.meta.dirname, '../../fixtures/snapshots/sapporo-720p.jpg'))
const basic = `Basic ${Buffer.from('admin:password').toString('base64')}`

const connect = async (mock: MockCamera): Promise<Device> => {
  const url = new URL(mock.url)
  return await Device.connect({
    hostname: url.hostname,
    port: Number(url.port),
    username: 'admin',
    password: 'password'
  })
}

const viaFetch = async (url: string): Promise<Uint8Array> => {
  const response = await fetch(url, { headers: { Authorization: basic } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

const cases = [
  { name: 'keeps connections open', closeConnections: false, minimumRatio: 1 },
  { name: 'closes every connection (DVC)', closeConnections: true, minimumRatio: 0.8 }
]

test.for(cases)('snapshot from a device that $name', async ({ closeConnections, minimumRatio }, { bench }) => {
  const basicCamera = await startMockCamera({ snapshot: { auth: 'basic', body: snapshot, closeConnections } })
  const digestCamera = await startMockCamera({ snapshot: { body: snapshot, closeConnections } })
  const device = await connect(digestCamera)
  const basicUrl = `${basicCamera.url}/snapshot.JPG`
  const digestUrl = new URL(`${digestCamera.url}/snapshot.JPG`)
  try {
    expect((await viaFetch(basicUrl)).length).toBe(snapshot.length)
    expect((await fetchSnapshot(device, digestUrl)).length).toBe(snapshot.length)
    digestCamera.requests.length = 0
    const results = await bench.compare(
      bench('fetch with Basic (argos today)', async () => {
        await viaFetch(basicUrl)
      }),
      bench('fetchSnapshot with Digest', async () => {
        await fetchSnapshot(device, digestUrl)
      })
    )
    const snapshots = digestCamera.requests.filter(({ service }) => service === 'snapshot')
    expect(snapshots.every(({ headers }) => headers.authorization?.startsWith('Digest '))).toBe(true)
    expect(results.get('fetchSnapshot with Digest').throughput.mean).toBeGreaterThan(
      results.get('fetch with Basic (argos today)').throughput.mean * minimumRatio
    )
  } finally {
    device.close()
    await basicCamera.close()
    await digestCamera.close()
  }
})
