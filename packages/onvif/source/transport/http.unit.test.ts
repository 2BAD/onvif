import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startMockCamera } from '../../../../tools/mock-camera/server.ts'
import { TimeoutError, TransportError } from '#errors.ts'
import { HttpTransport } from '#transport/http.ts'

const tlsDirectory = join(import.meta.dirname, '../../../../fixtures/tls')
const certificate = readFileSync(join(tlsDirectory, 'cert.pem'))
const privateKey = readFileSync(join(tlsDirectory, 'key.pem'))
const fingerprint = '06:DD:B2:7F:56:70:AF:CA:F4:29:81:27:1E:66:34:04:B3:FB:0B:54:69:3A:C1:76:33:7D:57:88:0E:A6:D0:DB'

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const listen = async (server: Server, protocol = 'http'): Promise<URL> => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanups.push(async () => {
    server.closeAllConnections()
    server.close()
    await once(server, 'close')
  })
  return new URL(`${protocol}://127.0.0.1:${(server.address() as AddressInfo).port}/onvif/device_service`)
}

const serve = (handler: (request: IncomingMessage, response: ServerResponse, body: string) => void) =>
  createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    handler(request, response, Buffer.concat(chunks).toString('utf8'))
  })

const transport = (options?: ConstructorParameters<typeof HttpTransport>[0]): HttpTransport => {
  const instance = new HttpTransport(options)
  cleanups.push(() => instance.close())
  return instance
}

describe('HttpTransport', () => {
  it('posts the body as SOAP and resolves with any status', async () => {
    const url = await listen(
      serve((request, response, body) => {
        response.writeHead(body === 'fault' ? 500 : 200, { 'X-Type': request.headers['content-type'] ?? '' })
        response.end(`echo:${body}:${request.headers['content-length']}`)
      })
    )
    const client = transport()
    const ok = await client.post(url, 'ä')
    expect(ok).toMatchObject({ status: 200, body: 'echo:ä:2' })
    expect(ok.headers['x-type']).toEqual(['application/soap+xml; charset=utf-8'])
    expect((await client.post(url, 'fault')).status).toBe(500)
  })

  it('sends the SOAP action as a Content-Type parameter', async () => {
    const url = await listen(serve((request, response) => response.end(request.headers['content-type'])))
    const { body } = await transport().post(url, 'x', { action: 'urn:a"b' })
    expect(body).toBe('application/soap+xml; charset=utf-8; action="urn:a%22b"')
  })

  it('reuses the connection between requests', async () => {
    const server = serve((_request, response) => response.end('ok'))
    let connections = 0
    server.on('connection', () => connections++)
    const url = await listen(server)
    const client = transport()
    for (let index = 0; index < 3; index++) await client.post(url, 'x')
    expect(connections).toBe(1)
  })

  it('retries once when a reused connection was reset before the response', async () => {
    const seen = new WeakSet<object>()
    let requests = 0
    const url = await listen(
      serve((request, response) => {
        requests++
        if (seen.has(request.socket)) {
          request.socket.destroy()
          return
        }
        seen.add(request.socket)
        response.end('ok')
      })
    )
    const client = transport()
    await client.post(url, 'first')
    expect(await client.post(url, 'second')).toMatchObject({ status: 200, body: 'ok' })
    expect(requests).toBe(3)
  })

  it('does not retry a reset on a new connection', async () => {
    const url = await listen(serve((request) => request.socket.destroy()))
    await expect(transport().post(url, 'x', { context: { host: 'camera' } })).rejects.toMatchObject({
      name: 'TransportError',
      host: 'camera'
    })
  })

  it('times out when the device does not answer', async () => {
    const url = await listen(serve(() => {}))
    await expect(transport({ timeoutMs: 100 }).post(url, 'x')).rejects.toThrow(TimeoutError)
  })

  it('rejects with the abort reason when the caller aborts', async () => {
    const url = await listen(serve(() => {}))
    const controller = new AbortController()
    const request = transport().post(url, 'x', { signal: controller.signal })
    controller.abort(new Error('stopped'))
    await expect(request).rejects.toThrow('stopped')
  })

  it('rejects responses over the size limit by declared length', async () => {
    const url = await listen(serve((_request, response) => response.end('x'.repeat(2048))))
    await expect(transport({ maxResponseBytes: 1024 }).post(url, 'x')).rejects.toThrow(/2048 bytes exceeds 1024/)
  })

  it('rejects streamed responses over the size limit', async () => {
    const url = await listen(
      serve((_request, response) => {
        response.write('x'.repeat(1000))
        response.end('x'.repeat(1000))
      })
    )
    await expect(transport({ maxResponseBytes: 1024 }).post(url, 'x')).rejects.toThrow(/exceeds 1024 bytes/)
  })

  it('rejects truncated responses', async () => {
    const url = await listen(
      serve((request, response) => {
        response.writeHead(200, { 'Content-Length': 100 })
        response.write('partial', () => request.socket.destroy())
      })
    )
    await expect(transport().post(url, 'x')).rejects.toThrow(TransportError)
  })

  it('rejects refused connections and unsupported protocols', async () => {
    const url = await listen(serve(() => {}))
    const port = url.port
    for (const cleanup of cleanups.splice(0)) await cleanup()
    await expect(transport().post(new URL(`http://127.0.0.1:${port}/`), 'x')).rejects.toThrow(/Request failed/)
    await expect(transport().post(new URL('ftp://127.0.0.1/'), 'x')).rejects.toThrow(/Unsupported protocol ftp:/)
  })
})

describe('HttpTransport digest authentication', () => {
  const envelope =
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body>' +
    '<GetDeviceInformation xmlns="http://www.onvif.org/ver10/device/wsdl"/></s:Body></s:Envelope>'

  it.each(['MD5', 'SHA-256'] as const)('answers a %s challenge and reuses it', async (digestAlgorithm) => {
    const camera = await startMockCamera({ auth: 'digest', digestAlgorithm })
    cleanups.push(() => camera.close())
    const client = transport({ digest: { username: 'admin', password: 'password' } })
    const url = new URL(`${camera.url}/onvif/device_service`)

    expect((await client.post(url, envelope)).status).toBe(200)
    expect((await client.post(url, envelope)).status).toBe(200)
    expect(camera.requests).toHaveLength(3)
  })

  it('gives up after one retry with wrong credentials', async () => {
    const camera = await startMockCamera({ auth: 'digest' })
    cleanups.push(() => camera.close())
    const client = transport({ digest: { username: 'admin', password: 'wrong' } })
    const response = await client.post(new URL(`${camera.url}/onvif/device_service`), envelope)
    expect(response.status).toBe(401)
    expect(camera.requests).toHaveLength(2)
  })

  it('returns the 401 unchanged without digest credentials', async () => {
    const camera = await startMockCamera({ auth: 'digest' })
    cleanups.push(() => camera.close())
    expect((await transport().post(new URL(`${camera.url}/onvif/device_service`), envelope)).status).toBe(401)
    expect(camera.requests).toHaveLength(1)
  })

  it('returns the 401 when the device drops the connection on the digest retry', async () => {
    let requests = 0
    const url = await listen(
      serve((request, response) => {
        requests++
        if (request.headers.authorization) {
          request.socket.destroy()
          return
        }
        response.writeHead(401, { 'WWW-Authenticate': 'Digest realm="r", nonce="n", qop="auth"' })
        response.end('denied')
      })
    )
    const response = await transport({ digest: { username: 'a', password: 'b' } }).post(url, 'x')
    expect(response).toMatchObject({ status: 401, body: 'denied' })
    expect(requests).toBe(3)
  })
})

describe('HttpTransport TLS', () => {
  const startTlsServer = async () => {
    let requests = 0
    const server = createTlsServer({ cert: certificate, key: privateKey }, (_request, response) => {
      requests++
      response.end('secure')
    })
    const url = await listen(server, 'https')
    return { url, requests: () => requests }
  }

  it('rejects a self signed certificate by default', async () => {
    const { url, requests } = await startTlsServer()
    await expect(transport().post(url, 'x')).rejects.toThrow(/self.signed/i)
    expect(requests()).toBe(0)
  })

  it('accepts the certificate through a custom CA', async () => {
    const { url } = await startTlsServer()
    expect((await transport({ tls: { ca: certificate } }).post(url, 'x')).body).toBe('secure')
  })

  it('accepts a self signed certificate with a matching pinned fingerprint', async () => {
    const { url } = await startTlsServer()
    const client = transport({ tls: { fingerprint256: fingerprint.toLowerCase().replaceAll(':', '') } })
    expect((await client.post(url, 'x')).body).toBe('secure')
    expect((await client.post(url, 'x')).body).toBe('secure')
  })

  it('sends nothing to a peer whose certificate does not match the pin', async () => {
    const { url, requests } = await startTlsServer()
    const client = transport({ tls: { fingerprint256: 'AA'.repeat(32) } })
    await expect(client.post(url, 'secret')).rejects.toThrow(/does not match the pinned fingerprint/)
    expect(requests()).toBe(0)
  })
})
