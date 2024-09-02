import type { SecureContextOptions } from 'node:tls'
import { parseSOAPString } from '../utils/xml.ts'

export type HttpClientOptions = {
  hostname: string
  port: number
  basePath: string
  uriMap: Record<string, URL>
  timeout: number
  useSecure: boolean
  secureOptions?: SecureContextOptions
}

export type RequestOptions = {
  body: string
  service?: string
  raw?: boolean
}

export class HttpClient {
  private readonly baseUrl: string

  constructor(private readonly options: HttpClientOptions) {
    const { hostname, port, useSecure } = options
    this.baseUrl = `${useSecure ? 'https' : 'http'}://${hostname}:${port}`
  }

  private createUrl(service?: string): string {
    const path = service ? this.options.uriMap[service]?.pathname || this.options.basePath : this.options.basePath
    return new URL(path, this.baseUrl).toString()
  }

  public async request<T>(options: RequestOptions): Promise<[T, string]> {
    const { body, service } = options
    const url = this.createUrl(service)

    const requestOptions: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/soap+xml',
        charset: 'utf-8'
      },
      body,
      signal: AbortSignal.timeout(this.options.timeout)
    }

    if (this.options.useSecure || Object.keys(this.options.secureOptions ?? {}).length !== 0) {
      console.error('SSL options are not directly supported with fetch. Consider using a custom HTTPS agent if needed.')
    }

    const response = await fetch(url, requestOptions)

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const xml = await response.text()
    return await parseSOAPString<T>(xml)
  }
}
