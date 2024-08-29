import type { AnyURI } from './basics.ts'
import type { ReferenceToken } from './common.ts'
import type { Capabilities } from './onvif.ts'

export type Protocols = 'https' | 'wss'
export type AuthorizationModes = 'mTLS' | 'JWT'
export type ConnectionStatus = 'Offline' | 'Connecting' | 'Connected'
export type Configuration = {
  /** Uniform resource locator by which the remote client can be reached. */
  remoteAddress?: AnyURI
  /** ID of the certificate to be used for client authentication. */
  certificateID?: string
  /** Authorization level that will be assigned to the uplink connection. */
  userLevel?: string
  /** Current connection status (see tup:ConnectionStatus for possible values). */
  status?: string
  /** CertPathValidationPolicyID used to validate the uplink server certificate. If CertPathValidationPolicyID is not configured, uplink server certificate shall not be validated. */
  certPathValidationPolicyID?: string
  /** The configuration to be used to obtain a JWT token to authorize with the uplink server. */
  authorizationServer?: ReferenceToken
}
export type GetServiceCapabilities = Record<string, unknown>
export type GetServiceCapabilitiesResponse = {
  /** The capabilities for the uplink service is returned in the Capabilities element. */
  capabilities?: Capabilities
}
export type GetUplinks = Record<string, unknown>
export type GetUplinksResponse = {
  /** List of configured uplinks. */
  configuration?: Configuration[]
}
export type SetUplink = {
  /** Configuration to be added or modified. */
  configuration?: Configuration
}
export type SetUplinkResponse = Record<string, unknown>
export type DeleteUplink = {
  /** Uniform resource locator of the configuration to be deleted. */
  remoteAddress?: AnyURI
}
export type DeleteUplinkResponse = Record<string, unknown>
