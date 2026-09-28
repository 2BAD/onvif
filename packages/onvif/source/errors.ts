export type ErrorContext = {
  host?: string
  service?: string
  action?: string
}

export class OnvifError extends Error {
  readonly host: string | undefined
  readonly service: string | undefined
  readonly action: string | undefined

  constructor(message: string, context: ErrorContext = {}, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.host = context.host
    this.service = context.service
    this.action = context.action
  }
}

export type SoapFault = {
  code: string
  subcodes: string[]
  reason: string
}

export class SoapFaultError extends OnvifError {
  readonly code: string
  readonly subcodes: string[]
  readonly reason: string

  constructor(fault: SoapFault, context: ErrorContext = {}) {
    super(`SOAP fault ${[fault.code, ...fault.subcodes].join(' / ')}: ${fault.reason}`, context)
    this.code = fault.code
    this.subcodes = fault.subcodes
    this.reason = fault.reason
  }
}

export class AuthError extends OnvifError {
  readonly fault: SoapFault | undefined

  constructor(message: string, context: ErrorContext = {}, fault?: SoapFault) {
    super(message, context)
    this.fault = fault
  }
}

export class TransportError extends OnvifError {
  readonly status: number | undefined

  constructor(message: string, context: ErrorContext = {}, options?: ErrorOptions & { status?: number }) {
    super(message, context, options)
    this.status = options?.status
  }
}

export class TimeoutError extends OnvifError {}

export class ParseError extends OnvifError {
  readonly reason: string
  readonly position: number

  constructor(reason: string, position: number, context: ErrorContext = {}) {
    super(`${reason} at position ${position}`, context)
    this.reason = reason
    this.position = position
  }
}

export class DecodeError extends OnvifError {
  readonly path: string

  constructor(message: string, path: string, context: ErrorContext = {}) {
    super(`${message} at ${path}`, context)
    this.path = path
  }
}
