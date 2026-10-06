import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import { type AddressInfo, createServer as createTcpServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MOCK_JPEG, startMockCamera } from '../../../../tools/mock-camera/server.ts'
import { AuthError, TimeoutError, TransportError } from '#errors.ts'
import { HttpTransport } from '#transport/http.ts'

const tlsDirectory = join(import.meta.dirname, '../../../../fixtures/tls')
const certificate = readFileSync(join(tlsDirectory, 'cert.pem'))
const privateKey = readFileSync(join(tlsDirectory, 'key.pem'))
const otherCertificate = readFileSync(join(tlsDirectory, 'other-cert.pem'))
const otherPrivateKey = readFileSync(join(tlsDirectory, 'other-key.pem'))
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
    const chunks = await Array.fromAsync<Buffer>(request)
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

  it('capitalizes Content-Length for the DRN-3282R, which ignores a lowercase one', async () => {
    const names: string[] = []
    const url = await listen(
      serve((request, response) => {
        names.push(...request.rawHeaders.filter((_value, index) => index % 2 === 0))
        response.end()
      })
    )
    await transport().post(url, '<s:Envelope/>')
    expect(names).toEqual(expect.arrayContaining(['Content-Type', 'Content-Length']))
  })

  it('gets the body as bytes, without a request body or Content-Type', async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0x00, 0xc3, 0x28, 0xff, 0xd9])
    const seen: IncomingMessage['headers'][] = []
    const url = await listen(
      serve((request, response, body) => {
        seen.push(request.headers)
        response.writeHead(body === '' && request.method === 'GET' ? 200 : 400)
        response.end(bytes)
      })
    )
    const response = await transport().get(url)
    expect(response.status).toBe(200)
    expect(response.body).toEqual(bytes)
    expect(seen[0]?.['content-type']).toBeUndefined()
    expect(seen[0]?.['content-length']).toBeUndefined()
  })

  it('applies the size limit to a GET', async () => {
    const url = await listen(serve((_request, response) => response.end(Buffer.alloc(64))))
    await expect(transport({ maxResponseBytes: 32 }).get(url)).rejects.toBeInstanceOf(TransportError)
  })

  it('releases responses once they are read, long before the timeout', async () => {
    setFlagsFromString('--expose-gc')
    const gc = runInNewContext('gc') as () => void
    const body = Buffer.alloc(1024 * 1024, 1)
    const url = await listen(serve((_request, response) => response.end(body)))
    const client = transport({ timeoutMs: 60_000 })
    const retained = async (): Promise<number> => {
      await sleep(100)
      gc()
      const { heapUsed, arrayBuffers } = process.memoryUsage()
      return heapUsed + arrayBuffers
    }
    await client.get(url)
    const before = await retained()
    for (let index = 0; index < 20; index++) await client.get(url)
    const limit = 5 * 1024 * 1024
    const giveUpAt = performance.now() + 2_000
    let growth = (await retained()) - before
    while (growth >= limit && performance.now() < giveUpAt) growth = (await retained()) - before
    expect(growth).toBeLessThan(limit)
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

  it('closes a kept-alive connection once it was idle, but not while a response is pending', async () => {
    const server = serve((_request, response, body) => setTimeout(() => response.end('ok'), body === 'slow' ? 300 : 0))
    server.keepAliveTimeout = 60_000
    let connections = 0
    let closed = 0
    server.on('connection', (socket) => {
      connections++
      socket.on('close', () => closed++)
    })
    const url = await listen(server)
    const client = transport({ idleTimeoutMs: 100 })
    expect((await client.post(url, 'slow')).body).toBe('ok')
    expect(closed).toBe(0)
    await vi.waitFor(() => expect(closed).toBe(1))
    await client.post(url, 'x')
    expect(connections).toBe(2)
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

  it('serializes the body again for the retry after a reset', async () => {
    const seen = new WeakSet<object>()
    const bodies: string[] = []
    const url = await listen(
      serve((request, response, body) => {
        bodies.push(body)
        if (seen.has(request.socket)) {
          request.socket.destroy()
          return
        }
        seen.add(request.socket)
        response.end('ok')
      })
    )
    const client = transport()
    let attempt = 0
    await client.post(url, () => `first-${++attempt}`)
    await client.post(url, () => `second-${++attempt}`)
    expect(bodies).toEqual(['first-1', 'second-2', 'second-3'])
  })

  it('does not retry a reused connection that breaks once the response started', async () => {
    const seen = new WeakSet<object>()
    let requests = 0
    const url = await listen(
      serve((request, response) => {
        requests++
        if (seen.has(request.socket)) {
          response.writeHead(200, { 'Content-Length': 100 })
          response.write('partial', () => request.socket.destroy())
          return
        }
        seen.add(request.socket)
        response.end('ok')
      })
    )
    const client = transport()
    await client.post(url, 'first')
    await expect(client.post(url, 'second')).rejects.toThrow(TransportError)
    expect(requests).toBe(2)
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

  it('uses the timeout of the request over the transport timeout', async () => {
    const url = await listen(serve((_request, response) => setTimeout(() => response.end('late'), 150)))
    await expect(transport({ timeoutMs: 100 }).post(url, 'x', { timeoutMs: 1000 })).resolves.toMatchObject({
      body: 'late'
    })
    await expect(transport({ timeoutMs: 1000 }).post(url, 'x', { timeoutMs: 50 })).rejects.toThrow(
      'No response within 50 ms'
    )
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
    const client = transport({ credentials: { username: 'admin', password: 'password' } })
    const url = new URL(`${camera.url}/onvif/device_service`)

    expect((await client.post(url, envelope)).status).toBe(200)
    expect((await client.post(url, envelope)).status).toBe(200)
    expect(camera.requests).toHaveLength(3)
  })

  it('answers a challenge on a GET with the GET method in the digest', async () => {
    const camera = await startMockCamera()
    cleanups.push(() => camera.close())
    const client = transport({ credentials: { username: 'admin', password: 'password' } })
    const url = new URL(`${camera.url}/snapshot.JPG`)

    const response = await client.get(url)
    expect(response.status).toBe(200)
    expect(response.body).toEqual(MOCK_JPEG)
    expect((await client.get(url)).status).toBe(200)
    expect(camera.requests).toHaveLength(3)
    expect(camera.requests[1]?.headers.authorization).toMatch(/^Digest .*uri="\/snapshot\.JPG"/)
  })

  it('gives up after one retry with wrong credentials', async () => {
    const camera = await startMockCamera({ auth: 'digest' })
    cleanups.push(() => camera.close())
    const client = transport({ credentials: { username: 'admin', password: 'wrong' } })
    const response = await client.post(new URL(`${camera.url}/onvif/device_service`), envelope)
    expect(response.status).toBe(401)
    expect(camera.requests).toHaveLength(2)
  })

  it('answers the retry after a reset with a new nonce count and cnonce', async () => {
    const seen = new WeakSet<object>()
    const authorizations: string[] = []
    const url = await listen(
      serve((request, response) => {
        const { authorization } = request.headers
        if (!authorization) {
          response.writeHead(401, { 'WWW-Authenticate': 'Digest realm="r", nonce="n", qop="auth"' })
          response.end()
          return
        }
        authorizations.push(authorization)
        if (seen.has(request.socket)) {
          request.socket.destroy()
          return
        }
        seen.add(request.socket)
        response.end('ok')
      })
    )
    const client = transport({ credentials: { username: 'admin', password: 'password' } })
    expect((await client.post(url, 'first')).status).toBe(200)
    expect((await client.post(url, 'second')).status).toBe(200)
    expect(authorizations.map((header) => /nc=(\w+)/.exec(header)?.[1])).toEqual(['00000001', '00000002', '00000003'])
    expect(new Set(authorizations.map((header) => /cnonce="(\w+)"/.exec(header)?.[1])).size).toBe(3)
  })

  it('returns the 401 unchanged without digest credentials', async () => {
    const camera = await startMockCamera({ auth: 'digest' })
    cleanups.push(() => camera.close())
    expect((await transport().post(new URL(`${camera.url}/onvif/device_service`), envelope)).status).toBe(401)
    expect(camera.requests).toHaveLength(1)
  })

  it('rejects header values Node refuses to send as a TransportError without the value', async () => {
    const url = await listen(
      serve((_request, response) => {
        response.writeHead(401, { 'WWW-Authenticate': 'Digest realm="r", nonce="n", qop="auth"' })
        response.end()
      })
    )
    const request = transport().post(url, 'x', { action: 'urn:secret\nX-Injected: 1', context: { host: 'camera' } })
    await expect(request).rejects.toThrow(TransportError)
    await expect(request).rejects.toMatchObject({ host: 'camera' })
    await expect(request).rejects.not.toThrow(/secret|Injected/)
  })

  it.each([
    ['a line break', 'admin\r\nX-Injected: 1'],
    ['a non-ASCII character', 'ädmin']
  ])('rejects a Digest username with %s as an AuthError, then sends nothing', async (_name, username) => {
    let requests = 0
    const url = await listen(
      serve((_request, response) => {
        requests++
        response.writeHead(401, { 'WWW-Authenticate': 'Digest realm="r", nonce="n", qop="auth"' })
        response.end()
      })
    )
    const client = transport({ credentials: { username, password: 'secret' } })
    for (let attempt = 0; attempt < 2; attempt++) {
      const request = client.post(url, 'x', { context: { host: 'camera' } })
      await expect(request).rejects.toThrow(AuthError)
      await expect(request).rejects.toMatchObject({ host: 'camera' })
      await expect(request).rejects.not.toThrow(/admin|ädmin|Injected|secret/)
    }
    expect(requests).toBe(1)
  })

  it('counts the digest retry against the same timeout', async () => {
    let requests = 0
    const url = await listen(
      serve((_request, response) => {
        requests++
        setTimeout(() => {
          response.writeHead(401, { 'WWW-Authenticate': `Digest realm="r", nonce="n${requests}", qop="auth"` })
          response.end()
        }, 70)
      })
    )
    const client = transport({ timeoutMs: 100, credentials: { username: 'a', password: 'b' } })
    await expect(client.post(url, 'x')).rejects.toThrow('No response within 100 ms')
    expect(requests).toBe(2)
    await expect(client.post(url, 'x', { deadline: performance.now() - 1, timeoutMs: 5 })).rejects.toThrow(
      'No response within 5 ms'
    )
    expect(requests).toBe(2)
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
    const response = await transport({ credentials: { username: 'a', password: 'b' } }).post(url, 'x')
    expect(response).toMatchObject({ status: 401, body: 'denied' })
    expect(requests).toBe(3)
  })
})

describe('HttpTransport basic authentication', () => {
  const credentials = { username: 'admin', password: 'pässword' }
  const expected = `Basic ${Buffer.from('admin:pässword', 'utf8').toString('base64')}`

  const handler =
    (challenges: string[], seen: (string | undefined)[]) => (request: IncomingMessage, response: ServerResponse) => {
      seen.push(request.headers.authorization)
      if (request.headers.authorization === expected) {
        response.end('ok')
        return
      }
      response.writeHead(401, { 'WWW-Authenticate': challenges })
      response.end()
    }

  const basicServer = async (challenges = ['Basic realm="camera"'], protocol = 'http') => {
    const seen: (string | undefined)[] = []
    const url =
      protocol === 'https'
        ? await listen(createTlsServer({ cert: certificate, key: privateKey }, handler(challenges, seen)), 'https')
        : await listen(createServer(handler(challenges, seen)))
    return { url, seen }
  }

  it('does not answer a Basic challenge by default', async () => {
    const { url, seen } = await basicServer()
    expect((await transport({ credentials }).get(url)).status).toBe(401)
    expect(seen).toEqual([undefined])
  })

  it('answers a Basic challenge over HTTP with always, once, then sends it right away', async () => {
    const { url, seen } = await basicServer()
    const client = transport({ credentials, basicAuth: 'always' })
    expect((await client.get(url)).status).toBe(200)
    expect((await client.post(url, 'x')).status).toBe(200)
    expect(seen).toEqual([undefined, expected, expected])
  })

  it('answers a Basic challenge only over HTTPS with https', async () => {
    const plain = await basicServer()
    expect((await transport({ credentials, basicAuth: 'https' }).get(plain.url)).status).toBe(401)
    expect(plain.seen).toEqual([undefined])

    const secure = await basicServer(['Basic realm="camera"'], 'https')
    const client = transport({ credentials, basicAuth: 'https', tls: { ca: certificate } })
    expect((await client.get(secure.url)).status).toBe(200)
    expect(secure.seen).toEqual([undefined, expected])
  })

  it('prefers Digest when the device offers both', async () => {
    const { url, seen } = await basicServer(['Basic realm="camera"', 'Digest realm="r", nonce="n", qop="auth"'])
    await transport({ credentials, basicAuth: 'always' }).get(url)
    expect(seen[1]).toMatch(/^Digest /)
  })

  it('gives up after one retry with wrong credentials', async () => {
    const { url, seen } = await basicServer()
    const client = transport({ credentials: { username: 'admin', password: 'wrong' }, basicAuth: 'always' })
    expect((await client.get(url)).status).toBe(401)
    expect(seen).toHaveLength(2)
  })

  it.each([
    ['a username with a colon', { username: 'ad:min', password: 'x' }],
    ['a password with a line break', { username: 'admin', password: 'x\ny' }]
  ])('rejects %s as an AuthError and sends nothing more', async (_name, rejected) => {
    const { url, seen } = await basicServer()
    await expect(transport({ credentials: rejected, basicAuth: 'always' }).get(url)).rejects.toBeInstanceOf(AuthError)
    expect(seen).toEqual([undefined])
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

  it('resumes pinned sessions and still rejects a server that cannot resume them', async () => {
    let requests = 0
    let resumed = 0
    const handler = (_request: IncomingMessage, response: ServerResponse) => {
      requests++
      response.writeHead(200, { Connection: 'close' })
      response.end('secure')
    }
    const start = async (cert: Buffer, key: Buffer, port = 0) => {
      const server = createTlsServer({ cert, key }, handler)
      server.on('secureConnection', (socket) => {
        if (socket.isSessionReused()) resumed++
      })
      server.listen(port, '127.0.0.1')
      await once(server, 'listening')
      return server
    }
    const genuine = await start(certificate, privateKey)
    const url = new URL(`https://127.0.0.1:${(genuine.address() as AddressInfo).port}/onvif/device_service`)
    const client = transport({ tls: { fingerprint256: fingerprint } })
    for (let index = 0; index < 3; index++) expect((await client.post(url, 'x')).body).toBe('secure')
    expect(resumed).toBe(2)

    genuine.close()
    await once(genuine, 'close')
    const impostor = await start(otherCertificate, otherPrivateKey, Number(url.port))
    cleanups.push(async () => {
      impostor.close()
      await once(impostor, 'close')
    })
    requests = 0
    await expect(client.post(url, 'secret')).rejects.toThrow(/does not match the pinned fingerprint/)
    expect(requests).toBe(0)
    expect(resumed).toBe(2)
  })

  it('closes an idle pinned connection', async () => {
    const server = createTlsServer({ cert: certificate, key: privateKey }, (_request, response) => response.end('ok'))
    server.keepAliveTimeout = 60_000
    let closed = 0
    server.on('secureConnection', (socket) => socket.on('close', () => closed++))
    const url = await listen(server, 'https')
    const client = transport({ idleTimeoutMs: 100, tls: { fingerprint256: fingerprint } })
    expect((await client.post(url, 'x')).body).toBe('ok')
    await vi.waitFor(() => expect(closed).toBe(1))
  })

  it('sends nothing to a peer whose certificate does not match the pin', async () => {
    const { url, requests } = await startTlsServer()
    const client = transport({ tls: { fingerprint256: 'AA'.repeat(32) } })
    await expect(client.post(url, 'secret')).rejects.toThrow(/does not match the pinned fingerprint/)
    expect(requests()).toBe(0)
  })

  it('times out and closes the connection when a pinned peer never completes the handshake', async () => {
    const sockets = new Set<Socket>()
    const server = createTcpServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket)).resume()
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    cleanups.push(async () => {
      for (const socket of sockets) socket.destroy()
      server.close()
      await once(server, 'close')
    })
    const url = new URL(`https://127.0.0.1:${(server.address() as AddressInfo).port}/`)
    const client = transport({ timeoutMs: 100, tls: { fingerprint256: fingerprint } })

    await expect(client.post(url, 'x')).rejects.toThrow(TimeoutError)
    await expect(client.post(url, 'x', { timeoutMs: 20 })).rejects.toThrow('No response within 20 ms')
    await vi.waitFor(() => expect(sockets.size).toBe(0))
  })
})
