import type { AnyURI } from './basics.ts'
import type { ReferenceToken } from './common.ts'
import type { ItemList, ItemListDescription } from './onvif.ts'
import type { PositiveInteger } from './types.ts'

export type AddressFormatType = 'hostname' | 'ipv4' | 'ipv6' | 'Extended'
export type EMailAuthenticationMode = 'none' | 'SMTP' | 'POPSMTP' | 'Extended'
export type HttpProtocolType = 'http' | 'https' | 'Extended'
export type HttpAuthenticationMethodType = 'none' | 'MD5Digest' | 'Extended'
export type FileSuffixType = 'none' | 'sequence' | 'dateTime' | 'Extended'
/** Describes the configuration parameters of an action. */
export type ActionConfigDescription = {
  /** Action type name */
  name: unknown
  /** Action configuration parameter descriptions */
  parameterDescription?: ItemListDescription
}
/** SupportedActions data structure lists the available action types that service provider supports. For each action type, data structure contains the action configuration parameters. */
export type SupportedActions = {
  /** Lists the location of all schemas that are referenced in the supported actions. If the action descriptions reference data types in the ONVIF schema file,the ONVIF schema file MUST be explicitly listed. */
  actionContentSchemaLocation?: AnyURI[]
  /** List of actions supported by Action Engine Service provider. */
  actionDescription?: ActionConfigDescription[]
  extension?: SupportedActionsExtension
}
export type SupportedActionsExtension = Record<string, unknown>
/** Action Engine Capabilities data structure contains the maximum number of supported actions and number of actions in use for generic as well as specific action types */
export type ActionEngineCapabilities = {
  /** The maximum number of trigger configurations that the service provider can concurrently support */
  maximumTriggers?: PositiveInteger
  /** The maximum number of actions that the service provider can concurrently support */
  maximumActions?: PositiveInteger
  /** Limits for each action type */
  actionCapabilities?: ActionTypeLimits[]
  extension?: ActionEngineCapabilitiesExtension
}
export type ActionEngineCapabilitiesExtension = Record<string, unknown>
/** ActionTypeLimits data structure contains maximum and current usage information for a specific action type in the service provider */
export type ActionTypeLimits = {
  /** Action Type */
  type: unknown
  /** For the specific action type, the maximum number of actions that could be concurrently supported by the service provider */
  maximum: PositiveInteger
  /** For the specific action type, the number of actions in use by the service provider */
  inUse?: number
}
/** Action Configuration data type contains the configuration settings of action configuration parameters, service requester given action Name, and service provider supported action type value */
export type ActionConfiguration = {
  /** User given name. */
  name: string
  /** Denotes the action type. */
  type: unknown
  /** Action configuration parameter settings. */
  parameters?: ItemList
}
/** Action data type contains the configuration settings of one action instance and service provider assigned unique identifier for this action configuration. */
export type Action = {
  /** Unique Action identifier that service provider assigned to the action configuration. */
  token: ReferenceToken
  /** Action configuration contains action type, user given action name, and configuratin parameter settings. */
  configuration?: ActionConfiguration
}
/** Action Trigger configuration data type contains mandatory Topic Expression (Section Topic Filter in [Core Specification]), optional Message content expression (Section Message Content Filter in [Core Specification]), and set of actions to be triggered. */
export type ActionTriggerConfiguration = {
  /** Topic expression, for example, to trigger only for relays. Trigger based on event topic. */
  topicExpression?: unknown
  /** Content expression, for example, to trigger only when the relay value is on. Trigger based on content data in event. */
  contentExpression?: unknown
  /** Reference to actions to be triggered when the conditions are satisfied. */
  actionToken?: ReferenceToken[]
  extension?: ActionTriggerConfigurationExtension
}
export type ActionTriggerConfigurationExtension = Record<string, unknown>
/** Action Trigger data type contains the service provider assigned unique identifier for the configuration and action trigger configuration data. */
export type ActionTrigger = {
  /** Unique Action Trigger identifier that service provider assigned to the action trigger configuration. */
  token: ReferenceToken
  /** Action Trigger Configuration */
  configuration?: ActionTriggerConfiguration
}
export type onvif_action = {
  actionDescription?: ActionConfigDescription[]
}
export type EMailServerConfiguration = {
  /** SMTP EMail Server configuration */
  SMTPConfig?: SMTPConfig
  /** POP EMail Server configuration */
  POPConfig?: POPConfig
  /** Credentials configuration */
  authenticationConfig?: AuthenticationConfig
}
export type SMTPConfig = {
  /**/
  portNo?: PositiveInteger
  /** Destination SMTP Address configuration */
  hostAddress?: HostAddress
}
export type POPConfig = {
  /** Destination POP Server Address configuration */
  hostAddress?: HostAddress
}
export type HostAddress = {
  /** IP Address format type such as IPv4 or IPv6 */
  formatType: AddressFormatType
  /** IP Address */
  value?: string
}
export type UserCredentials = {
  /** Username */
  username?: string
  /** Password */
  password?: unknown
  extension?: UserCredentialsExtension
}
export type UserCredentialsExtension = Record<string, unknown>
export type AuthenticationConfig = {
  /** Email server authentication mode */
  mode: EMailAuthenticationMode
  /** Username-password */
  user?: UserCredentials
}
export type EMailReceiverConfiguration = {
  /** Configuration for E-mail TO */
  TO?: string[]
  /** Configuration for E-mail CC */
  CC?: string[]
  /**/
  extension?: EMailReceiverConfigurationExtension
}
export type EMailReceiverConfigurationExtension = Record<string, unknown>
export type EMailAttachmentConfiguration = {
  /**/
  fileName?: string
  /**/
  doSuffix?: FileSuffixType
  /**/
  extension?: EMailAttachmentConfigurationExtension
}
export type EMailAttachmentConfigurationExtension = Record<string, unknown>
export type EMailBodyTextConfiguration = {
  /** Whether content of E-mail message contains event data */
  includeEvent?: boolean
  /**/
  type?: string
}
export type MediaSource = {
  /** MediaSource profile reference token */
  profileToken?: ReferenceToken
}
export type HttpHostConfigurations = {
  /** Destination HTTP Server configuration */
  httpDestination?: HttpDestinationConfiguration[]
  /**/
  extension?: HttpHostConfigurationsExtension
}
export type HttpHostConfigurationsExtension = Record<string, unknown>
export type HttpDestinationConfiguration = {
  /** URI for POST Message destination */
  uri?: string
  /** HTTP/HTTPS protocol selection (default is http) */
  protocol?: HttpProtocolType
  /** Destination HTTP Server address configuration */
  hostAddress?: HttpHostAddress
  /** User Credentials configuration for destination HTTP Server */
  httpAuthentication?: HttpAuthenticationConfiguration
  /**/
  extension?: HttpDestinationConfigurationExtension
}
export type HttpDestinationConfigurationExtension = Record<string, unknown>
export type HttpAuthenticationConfiguration = {
  /** HTTP Authentication Method */
  method?: HttpAuthenticationMethodType
  /** User credentials */
  user?: UserCredentials
  /**/
  extension?: HttpAuthenticationConfigurationExtension
}
export type HttpAuthenticationConfigurationExtension = Record<string, unknown>
export type HttpHostAddress = {
  /** IPv4 or IPv6 */
  formatType: AddressFormatType
  /** Port Number if different from 80 */
  portNo?: number
  /** Destination HTTP Server IP Address */
  value?: string
}
export type PostContentConfiguration = {
  /** MediaSource reference when the media is attached to POST message */
  mediaReference?: MediaSource
  /** Configuration for POST Message content */
  postBody?: PostBodyConfiguration
}
export type PostBodyConfiguration = {
  /**/
  formData?: string
  /** Whether include event into POST message */
  includeEvent?: boolean
  /** Whether attach media into POST message */
  includeMedia?: boolean
}
export type FtpHostConfigurations = {
  /** FTP Action destination configuration */
  ftpDestination?: FtpDestinationConfiguration[]
  /**/
  extension?: FtpHostConfigurationsExtension
}
export type FtpHostConfigurationsExtension = Record<string, unknown>
export type FtpDestinationConfiguration = {
  /** FTP Server IP Address */
  hostAddress?: FtpHostAddress
  /** Upload Directory Path */
  uploadPath?: string
  /** User credentials confguration for target FTP Server */
  ftpAuthentication?: FtpAuthenticationConfiguration
  extension?: FtpDestinationConfigurationExtension
}
export type FtpDestinationConfigurationExtension = Record<string, unknown>
export type FtpAuthenticationConfiguration = {
  /** User Credentials */
  user?: UserCredentials
  extension?: FtpAuthenticationConfigurationExtension
}
export type FtpAuthenticationConfigurationExtension = Record<string, unknown>
export type FtpHostAddress = {
  /** IPv4 or IPv6 */
  formatType: AddressFormatType
  /** Port Number */
  portNo?: number
  /** FTP Server IP Address */
  value?: string
}
export type FtpContent = {
  /**/
  ftpContentConfig?: FtpContentConfiguration
}
export type FtpFileNameConfigurations = {
  /** Name of file */
  file_name?: string
  /** Suffix of file */
  suffix?: FileSuffixType
}
export type FtpContentConfiguration = {
  /** Type of FTP Upload action */
  type: string
}
export type FtpContentConfigurationUploadImages = {
  /** Upload Image action; how long? */
  howLong?: unknown
  /** Upload Image action; sample interval? */
  sampleInterval?: unknown
  /** Upload Image action; name of destination file */
  fileName?: FtpFileNameConfigurations
}
export type FtpContentConfigurationUploadFile = {
  /** Name of source file */
  sourceFileName?: string
  /** Name of destination file */
  destinationFileName?: string
}
export type SMSProviderConfiguration = {
  /** SMS Provider's URL */
  providerURL?: AnyURI
  /** Username and password */
  user?: UserCredentials
}
export type SMSSenderConfiguration = {
  /** Sender's e-mail address */
  EMail?: string
}
export type SMSMessage = {
  /** Text Message */
  text?: string
}
export type TriggeredRecordingConfiguration = {
  /** Length of recording time before the triggering event */
  preRecordDuration?: unknown
  /** Recording after alarm recording duration */
  postRecordDuration?: unknown
  /** Record duration */
  recordDuration?: unknown
  /** Recording frame rate */
  recordFrameRate?: PositiveInteger
  /** Whether Audio recording on/off */
  doRecordAudio?: boolean
}
export type RecordingActionConfiguration = {
  /** Recording configuration */
  recordConfig?: TriggeredRecordingConfiguration
}
export type GetSupportedActionsResponse = {
  /** Array of supported Action types */
  supportedActions?: SupportedActions
}
export type GetActionsResponse = {
  /** Array of current Action configurations */
  action?: Action[]
}
export type CreateActions = {
  /** Array of Actions to be configured on service provider */
  action?: ActionConfiguration[]
}
export type CreateActionsResponse = {
  /** Array of configured Actions with service provider assigned unique identifiers */
  action?: Action[]
}
export type DeleteActions = {
  /** Array of tokens referencing existing Action configurations to be removed */
  token?: ReferenceToken[]
}
export type ModifyActions = {
  /** Array of Action configurations to update the existing action configurations */
  action?: Action[]
}
export type GetServiceCapabilitiesResponse = {
  capabilities?: ActionEngineCapabilities
}
export type GetActionTriggersResponse = {
  /** Array of current Action Trigger configurations */
  actionTrigger?: ActionTrigger[]
}
export type CreateActionTriggers = {
  /** Action Triggers to be configured */
  actionTrigger?: ActionTriggerConfiguration[]
}
export type CreateActionTriggersResponse = {
  /** Returns configured Action Triggers with service provider assigned unique identifers */
  actionTrigger?: ActionTrigger[]
}
export type ModifyActionTriggers = {
  /** Array of Action Trigger configurations to be updated. */
  actionTrigger?: ActionTrigger[]
}
export type DeleteActionTriggers = {
  /** Array of tokens referencing existing Action Trigger configurations to be removed */
  token?: ReferenceToken[]
}
