import { describe, expect, it } from 'vitest'
import { discover } from '#index.ts'

const hostname = process.env['ONVIF_TEST_HOST']

describe.skipIf(!hostname)('Discovery of a live camera', () => {
  it('finds the camera with a direct probe', async () => {
    const devices = await Array.fromAsync(discover({ hosts: [hostname ?? ''], timeoutMs: 2_000 }))
    expect(devices).toHaveLength(1)
    expect(devices[0]?.endpoint).not.toBe('')
    expect(devices[0]?.xaddrs.map((xaddr) => xaddr.hostname)).toContain(hostname)
  })
})
