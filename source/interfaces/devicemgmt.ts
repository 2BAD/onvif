import type { AnyURI } from './basics.ts'
import type { IntRange, LocationEntity, ReferenceToken } from './common.ts'
import type {
  AttachmentData,
  AuxiliaryData,
  BackupFile,
  BinaryData,
  Capabilities,
  CapabilityCategory,
  Certificate,
  CertificateInformation,
  CertificateStatus,
  CertificateWithPrivateKey,
  DNSInformation,
  DNSName,
  DateTime,
  DeviceEntity,
  DiscoveryMode,
  Dot11AvailableNetworks,
  Dot11Capabilities,
  Dot11Status,
  Dot1XConfiguration,
  DynamicDNSInformation,
  DynamicDNSType,
  FactoryDefaultType,
  HostnameInformation,
  IPAddress,
  IPAddressFilter,
  IPv4Address,
  IPv6Address,
  IntList,
  NTPInformation,
  NetworkGateway,
  NetworkHost,
  NetworkInterface,
  NetworkInterfaceSetConfiguration,
  NetworkProtocol,
  NetworkZeroConfiguration,
  OnvifDate,
  OnvifVersion,
  RelayLogicalState,
  RelayOutput,
  RelayOutputSettings,
  RemoteUser,
  Scope,
  SetDateTimeType,
  StringAttrList,
  StringList,
  SupportInformation,
  SystemDateTime,
  SystemLog,
  SystemLogType,
  SystemLogUriList,
  TimeZone,
  User
} from './onvif.ts'

export type AutoGeoModes = 'Location' | 'Heading' | 'Leveling'
export type StorageType = 'NFS' | 'CIFS' | 'CDMI' | 'FTP' | 'ObjectStorageS3' | 'ObjectStorageAzure'
export type Service = {
  /** Namespace of the service being described. This parameter allows to match the service capabilities to the service. Note that only one set of capabilities is supported per namespace. */
  namespace?: AnyURI
  /** The transport addresses where the service can be reached. The scheme and IP part shall match the one used in the request (i.e. the GetServices request). */
  XAddr?: AnyURI
  capabilities?: Capabilities
  /** The version of the service (not the ONVIF core spec version). */
  version?: OnvifVersion
}
export type DeviceServiceCapabilities = {
  /** Network capabilities. */
  network?: NetworkCapabilities
  /** Security capabilities. */
  security?: SecurityCapabilities
  /** System capabilities. */
  system?: SystemCapabilities
  /** Capabilities that do not fit in any of the other categories. */
  misc?: MiscCapabilities
}
export type NetworkCapabilities = {
  /** Indicates support for IP filtering. */
  IPFilter?: boolean
  /** Indicates support for zeroconf. */
  zeroConfiguration?: boolean
  /** Indicates support for IPv6. */
  IPVersion6?: boolean
  /** Indicates support for dynamic DNS configuration. */
  dynDNS?: boolean
  /** Indicates support for IEEE 802.11 configuration. */
  dot11Configuration?: boolean
  /** Indicates the maximum number of Dot1X configurations supported by the device */
  dot1XConfigurations?: number
  /** Indicates support for retrieval of hostname from DHCP. */
  hostnameFromDHCP?: boolean
  /** Maximum number of NTP servers supported by the devices SetNTP command. */
  NTP?: number
  /** Indicates support for Stateful IPv6 DHCP. */
  DHCPv6?: boolean
}
export type SecurityCapabilities = {
  /** Indicates support for TLS 1.0. */
  'TLS1.0'?: boolean
  /** Indicates support for TLS 1.1. */
  'TLS1.1'?: boolean
  /** Indicates support for TLS 1.2. */
  'TLS1.2'?: boolean
  /** Indicates support for onboard key generation. */
  onboardKeyGeneration?: boolean
  /** Indicates support for access policy configuration. */
  accessPolicyConfig?: boolean
  /** Indicates support for the ONVIF default access policy. */
  defaultAccessPolicy?: boolean
  /** Indicates support for IEEE 802.1X configuration. */
  dot1X?: boolean
  /** Indicates support for remote user configuration. Used when accessing another device. */
  remoteUserHandling?: boolean
  /** Indicates support for WS-Security X.509 token. */
  'X.509Token'?: boolean
  /** Indicates support for WS-Security SAML token. */
  SAMLToken?: boolean
  /** Indicates support for WS-Security Kerberos token. */
  kerberosToken?: boolean
  /** Indicates support for WS-Security Username token. */
  usernameToken?: boolean
  /** Indicates support for WS over HTTP digest authenticated communication layer. */
  httpDigest?: boolean
  /** Indicates support for WS-Security REL token. */
  RELToken?: boolean
  /** Indicates support for JWT-based authentication with WS-Security Binary Security token. */
  jsonWebToken?: boolean
  /** EAP Methods supported by the device. The int values refer to the IANA EAP Registry. */
  supportedEAPMethods?: IntList
  /** The maximum number of users that the device supports. */
  maxUsers?: number
  /** Maximum number of characters supported for the username by CreateUsers. */
  maxUserNameLength?: number
  /** Maximum number of characters supported for the password by CreateUsers and SetUser. */
  maxPasswordLength?: number
  /** Indicates which security policies are supported. Options are: ModifyPassword, PasswordComplexity, AuthFailureWarnings */
  securityPolicies?: StringList
  /** Maximum number of passwords that the device can remember for each user */
  maxPasswordHistory?: number
  /** Supported hashing algorithms as part of HTTP and RTSP Digest authentication.Example: MD5,SHA-256 */
  hashingAlgorithms?: StringList
}
export type SystemCapabilities = {
  /** Indicates support for WS Discovery resolve requests. */
  discoveryResolve?: boolean
  /** Indicates support for WS-Discovery Bye. */
  discoveryBye?: boolean
  /** Indicates support for remote discovery. */
  remoteDiscovery?: boolean
  /** Indicates support for system backup through MTOM. */
  systemBackup?: boolean
  /** Indicates support for retrieval of system logging through MTOM. */
  systemLogging?: boolean
  /** Indicates support for firmware upgrade through MTOM. */
  firmwareUpgrade?: boolean
  /** Indicates support for firmware upgrade through HTTP. */
  httpFirmwareUpgrade?: boolean
  /** Indicates support for system backup through HTTP. */
  httpSystemBackup?: boolean
  /** Indicates support for retrieval of system logging through HTTP. */
  httpSystemLogging?: boolean
  /** Indicates support for retrieving support information through HTTP. */
  httpSupportInformation?: boolean
  /** Indicates support for storage configuration interfaces. */
  storageConfiguration?: boolean
  /** Indicates maximum number of storage configurations supported. */
  maxStorageConfigurations?: number
  /** If present signals support for geo location. The value signals the supported number of entries. */
  geoLocationEntries?: number
  /** List of supported automatic GeoLocation adjustment supported by the device. Valid items are defined by tds:AutoGeoMode. */
  autoGeo?: StringAttrList
  /** Enumerates the supported StorageTypes, see tds:StorageType. */
  storageTypesSupported?: StringAttrList
  /** Indicates no support for network discovery. */
  discoveryNotSupported?: boolean
  /** Indicates no support for network configuration. */
  networkConfigNotSupported?: boolean
  /** Indicates no support for user configuration. */
  userConfigNotSupported?: boolean
  /** List of supported Addons by the device. */
  addons?: StringAttrList
}
export type MiscCapabilities = {
  /** Lists of commands supported by SendAuxiliaryCommand. */
  auxiliaryCommands?: StringAttrList
}
export type Extension = Record<string, unknown>
export type UserCredential = {
  /** User name */
  userName?: string
  /** optional password */
  password?: string
  extension?: Extension
}
export type StorageConfigurationData = {
  /** tds:StorageType lists the acceptable values for type attribute */
  type: string
  /** Optional region of the storage server */
  region?: string
  /** Local path */
  localPath?: AnyURI
  /** Storage server address */
  storageUri?: AnyURI
  /** User credential for the storage server */
  user?: UserCredential
  extension?: Extension
}
export type StorageConfiguration = {
  data?: StorageConfigurationData
} & DeviceEntity
export type GetServices = {
  /** Indicates if the service capabilities (untyped) should be included in the response. */
  includeCapability?: boolean
}
export type GetServicesResponse = {
  /** Each Service element contains information about one service. */
  service?: Service[]
}
export type GetServiceCapabilities = Record<string, unknown>
export type GetServiceCapabilitiesResponse = {
  /** The capabilities for the device service is returned in the Capabilities element. */
  capabilities?: DeviceServiceCapabilities
}
export type GetDeviceInformation = Record<string, unknown>
export type GetDeviceInformationResponse = {
  /** The manufactor of the device. */
  manufacturer?: string
  /** The device model. */
  model?: string
  /** The firmware version in the device. */
  firmwareVersion?: string
  /** The serial number of the device. */
  serialNumber?: string
  /** The hardware ID of the device. */
  hardwareId?: string
}
export type SetSystemDateAndTime = {
  /** Defines if the date and time is set via NTP or manually. */
  dateTimeType?: SetDateTimeType
  /** Automatically adjust Daylight savings if defined in TimeZone. */
  daylightSavings?: boolean
  /** The time zone in POSIX 1003.1 format */
  timeZone?: TimeZone
  /** Date and time in UTC. If time is obtained via NTP, UTCDateTime has no meaning */
  UTCDateTime?: DateTime
}
export type SetSystemDateAndTimeResponse = Record<string, unknown>
export type GetSystemDateAndTime = Record<string, unknown>
export type GetSystemDateAndTimeResponse = {
  /** Contains information whether system date and time are set manually or by NTP, daylight savings is on or off, time zone in POSIX 1003.1 format and system date and time in UTC and also local system date and time. */
  systemDateAndTime?: SystemDateTime
}
export type SetSystemFactoryDefault = {
  /** Specifies the factory default action type. */
  factoryDefault?: FactoryDefaultType
}
export type SetSystemFactoryDefaultResponse = Record<string, unknown>
export type UpgradeSystemFirmware = {
  firmware?: AttachmentData
}
export type UpgradeSystemFirmwareResponse = {
  message?: string
}
export type SystemReboot = Record<string, unknown>
export type SystemRebootResponse = {
  /** Contains the reboot message sent by the device. */
  message?: string
}
export type RestoreSystem = {
  backupFiles?: BackupFile[]
}
export type RestoreSystemResponse = Record<string, unknown>
export type GetSystemBackup = Record<string, unknown>
export type GetSystemBackupResponse = {
  backupFiles?: BackupFile[]
}
export type GetSystemSupportInformation = Record<string, unknown>
export type GetSystemSupportInformationResponse = {
  /** Contains the arbitary device diagnostics information. */
  supportInformation?: SupportInformation
}
export type GetSystemLog = {
  /** Specifies the type of system log to get. */
  logType?: SystemLogType
}
export type GetSystemLogResponse = {
  /** Contains the system log information. */
  systemLog?: SystemLog
}
export type GetScopes = Record<string, unknown>
export type GetScopesResponse = {
  /** Contains a list of URI definining the device scopes. Scope parameters can be of two types: fixed and configurable. Fixed parameters can not be altered. */
  scopes?: Scope[]
}
export type SetScopes = {
  /** Contains a list of scope parameters that will replace all existing configurable scope parameters. */
  scopes?: AnyURI[]
}
export type SetScopesResponse = Record<string, unknown>
export type AddScopes = {
  /** Contains a list of new configurable scope parameters that will be added to the existing configurable scope. */
  scopeItem?: AnyURI[]
}
export type AddScopesResponse = Record<string, unknown>
export type RemoveScopes = {
  /**
   * Contains a list of URIs that should be removed from the device scope.
   * Note that the response message always will match the request or an error will be returned. The use of the response is for that reason deprecated.
   */
  scopeItem?: AnyURI[]
}
export type RemoveScopesResponse = {
  /** Contains a list of URIs that has been removed from the device scope */
  scopeItem?: AnyURI[]
}
export type GetDiscoveryMode = Record<string, unknown>
export type GetDiscoveryModeResponse = {
  /** Indicator of discovery mode: Discoverable, NonDiscoverable. */
  discoveryMode?: DiscoveryMode
}
export type SetDiscoveryMode = {
  /** Indicator of discovery mode: Discoverable, NonDiscoverable. */
  discoveryMode?: DiscoveryMode
}
export type SetDiscoveryModeResponse = Record<string, unknown>
export type GetRemoteDiscoveryMode = Record<string, unknown>
export type GetRemoteDiscoveryModeResponse = {
  /** Indicator of discovery mode: Discoverable, NonDiscoverable. */
  remoteDiscoveryMode?: DiscoveryMode
}
export type SetRemoteDiscoveryMode = {
  /** Indicator of discovery mode: Discoverable, NonDiscoverable. */
  remoteDiscoveryMode?: DiscoveryMode
}
export type SetRemoteDiscoveryModeResponse = Record<string, unknown>
export type GetDPAddresses = Record<string, unknown>
export type GetDPAddressesResponse = {
  DPAddress?: NetworkHost[]
}
export type SetDPAddresses = {
  DPAddress?: NetworkHost[]
}
export type SetDPAddressesResponse = Record<string, unknown>
export type GetEndpointReference = Record<string, unknown>
export type GetEndpointReferenceResponse = {
  GUID?: string
}
export type GetRemoteUser = Record<string, unknown>
export type GetRemoteUserResponse = {
  remoteUser?: RemoteUser
}
export type SetRemoteUser = {
  remoteUser?: RemoteUser
}
export type SetRemoteUserResponse = Record<string, unknown>
export type GetUsers = Record<string, unknown>
export type GetUsersResponse = {
  /** Contains a list of the onvif users and following information is included in each entry: username and user level. */
  user?: User[]
}
export type CreateUsers = {
  /** Creates new device users and corresponding credentials. Each user entry includes: username, password and user level. Either all users are created successfully or a fault message MUST be returned without creating any user. If trying to create several users with exactly the same username the request is rejected and no users are created. If password is missing, then fault message Too weak password is returned. */
  user?: User[]
}
export type CreateUsersResponse = Record<string, unknown>
export type DeleteUsers = {
  /** Deletes users on an device and there may exist users that cannot be deleted to ensure access to the unit. Either all users are deleted successfully or a fault message MUST be returned and no users be deleted. If a username exists multiple times in the request, then a fault message is returned. */
  username?: string[]
}
export type DeleteUsersResponse = Record<string, unknown>
export type SetUser = {
  /** Updates the credentials for one or several users on an device. Either all change requests are processed successfully or a fault message MUST be returned. If the request contains the same username multiple times, a fault message is returned. */
  user?: User[]
}
export type SetUserResponse = Record<string, unknown>
export type GetWsdlUrl = Record<string, unknown>
export type GetWsdlUrlResponse = {
  wsdlUrl?: AnyURI
}
export type GetPasswordComplexityOptions = Record<string, unknown>
export type GetPasswordComplexityOptionsResponse = {
  minLenRange?: IntRange
  uppercaseRange?: IntRange
  numberRange?: IntRange
  specialCharsRange?: IntRange
  blockUsernameOccurrenceSupported?: boolean
  policyConfigurationLockSupported?: boolean
}
export type GetPasswordComplexityConfiguration = Record<string, unknown>
export type GetPasswordComplexityConfigurationResponse = {
  minLen?: number
  uppercase?: number
  number?: number
  specialChars?: number
  blockUsernameOccurrence?: boolean
  policyConfigurationLocked?: boolean
}
export type SetPasswordComplexityConfiguration = {
  minLen?: number
  uppercase?: number
  number?: number
  specialChars?: number
  blockUsernameOccurrence?: boolean
  policyConfigurationLocked?: boolean
}
export type SetPasswordComplexityConfigurationResponse = Record<string, unknown>
export type GetPasswordHistoryConfiguration = Record<string, unknown>
export type GetPasswordHistoryConfigurationResponse = {
  enabled?: boolean
  length?: number
}
export type SetPasswordHistoryConfiguration = {
  enabled?: boolean
  length?: number
}
export type SetPasswordHistoryConfigurationResponse = Record<string, unknown>
export type GetAuthFailureWarningOptions = Record<string, unknown>
export type GetAuthFailureWarningOptionsResponse = {
  monitorPeriodRange?: IntRange
  authFailureRange?: IntRange
}
export type GetAuthFailureWarningConfiguration = Record<string, unknown>
export type GetAuthFailureWarningConfigurationResponse = {
  enabled?: boolean
  monitorPeriod?: number
  maxAuthFailures?: number
}
export type SetAuthFailureWarningConfiguration = {
  enabled?: boolean
  monitorPeriod?: number
  maxAuthFailures?: number
}
export type SetAuthFailureWarningConfigurationResponse = Record<string, unknown>
export type GetCapabilities = {
  /** List of categories to retrieve capability information on. */
  category?: CapabilityCategory[]
}
export type GetCapabilitiesResponse = {
  /** Capability information. */
  capabilities?: Capabilities
}
export type GetHostname = Record<string, unknown>
export type GetHostnameResponse = {
  /** Contains the hostname information. */
  hostnameInformation?: HostnameInformation
}
export type SetHostname = {
  /** The hostname to set. */
  name?: string
}
export type SetHostnameResponse = Record<string, unknown>
export type SetHostnameFromDHCP = {
  /** True if the hostname shall be obtained via DHCP. */
  fromDHCP?: boolean
}
export type SetHostnameFromDHCPResponse = {
  /** Indicates whether or not a reboot is required after configuration updates. */
  rebootNeeded?: boolean
}
export type GetDNS = Record<string, unknown>
export type GetDNSResponse = {
  /** DNS information. */
  DNSInformation?: DNSInformation
}
export type SetDNS = {
  /** Indicate if the DNS address is to be retrieved using DHCP. */
  fromDHCP?: boolean
  /** DNS search domain. */
  searchDomain?: string[]
  /** DNS address(es) set manually. */
  DNSManual?: IPAddress[]
}
export type SetDNSResponse = Record<string, unknown>
export type GetNTP = Record<string, unknown>
export type GetNTPResponse = {
  /** NTP information. */
  NTPInformation?: NTPInformation
}
export type SetNTP = {
  /** Indicate if NTP address information is to be retrieved using DHCP. */
  fromDHCP?: boolean
  /** Manual NTP settings. */
  NTPManual?: NetworkHost[]
}
export type SetNTPResponse = Record<string, unknown>
export type GetDynamicDNS = Record<string, unknown>
export type GetDynamicDNSResponse = {
  /** Dynamic DNS information. */
  dynamicDNSInformation?: DynamicDNSInformation
}
export type SetDynamicDNS = {
  /** Dynamic DNS type. */
  type?: DynamicDNSType
  /** DNS name. */
  name?: DNSName
  /** DNS record time to live. */
  TTL?: unknown
}
export type SetDynamicDNSResponse = Record<string, unknown>
export type GetNetworkInterfaces = Record<string, unknown>
export type GetNetworkInterfacesResponse = {
  /** List of network interfaces. */
  networkInterfaces?: NetworkInterface[]
}
export type SetNetworkInterfaces = {
  /** Symbolic network interface name. */
  interfaceToken?: ReferenceToken
  /** Network interface name. */
  networkInterface?: NetworkInterfaceSetConfiguration
}
export type SetNetworkInterfacesResponse = {
  /**
   * Indicates whether or not a reboot is required after configuration updates.
   * If a device responds with RebootNeeded set to false, the device can be reached
   * via the new IP address without further action. A client should be aware that a device
   * may not be responsive for a short period of time until it signals availability at
   * the new address via the discovery Hello messages.
   * If a device responds with RebootNeeded set to true, it will be further available under
   * its previous IP address. The settings will only be activated when the device is
   * rebooted via the SystemReboot command.
   */
  rebootNeeded?: boolean
}
export type GetNetworkProtocols = Record<string, unknown>
export type GetNetworkProtocolsResponse = {
  /** Contains an array of defined protocols supported by the device. There are three protocols defined; HTTP, HTTPS and RTSP. The following parameters can be retrieved for each protocol: port and enable/disable. */
  networkProtocols?: NetworkProtocol[]
}
export type SetNetworkProtocols = {
  /** Configures one or more defined network protocols supported by the device. There are currently three protocols defined; HTTP, HTTPS and RTSP. The following parameters can be set for each protocol: port and enable/disable. */
  networkProtocols?: NetworkProtocol[]
}
export type SetNetworkProtocolsResponse = Record<string, unknown>
export type GetNetworkDefaultGateway = Record<string, unknown>
export type GetNetworkDefaultGatewayResponse = {
  /** Gets the default IPv4 and IPv6 gateway settings from the device. */
  networkGateway?: NetworkGateway
}
export type SetNetworkDefaultGateway = {
  /** Sets IPv4 gateway address used as default setting. */
  IPv4Address?: IPv4Address[]
  /** Sets IPv6 gateway address used as default setting. */
  IPv6Address?: IPv6Address[]
}
export type SetNetworkDefaultGatewayResponse = Record<string, unknown>
export type GetZeroConfiguration = Record<string, unknown>
export type GetZeroConfigurationResponse = {
  /** Contains the zero-configuration. */
  zeroConfiguration?: NetworkZeroConfiguration
}
export type SetZeroConfiguration = {
  /** Unique identifier referencing the physical interface. */
  interfaceToken?: ReferenceToken
  /** Specifies if the zero-configuration should be enabled or not. */
  enabled?: boolean
}
export type SetZeroConfigurationResponse = Record<string, unknown>
export type GetIPAddressFilter = Record<string, unknown>
export type GetIPAddressFilterResponse = {
  IPAddressFilter?: IPAddressFilter
}
export type SetIPAddressFilter = {
  IPAddressFilter?: IPAddressFilter
}
export type SetIPAddressFilterResponse = Record<string, unknown>
export type AddIPAddressFilter = {
  IPAddressFilter?: IPAddressFilter
}
export type AddIPAddressFilterResponse = Record<string, unknown>
export type RemoveIPAddressFilter = {
  IPAddressFilter?: IPAddressFilter
}
export type RemoveIPAddressFilterResponse = Record<string, unknown>
export type GetAccessPolicy = Record<string, unknown>
export type GetAccessPolicyResponse = {
  policyFile?: BinaryData
}
export type SetAccessPolicy = {
  policyFile?: BinaryData
}
export type SetAccessPolicyResponse = Record<string, unknown>
export type CreateCertificate = {
  /** Certificate id. */
  certificateID?: string
  /** Identification of the entity associated with the public-key. */
  subject?: string
  /** Certificate validity start date. */
  validNotBefore?: OnvifDate
  /** Certificate expiry start date. */
  validNotAfter?: OnvifDate
}
export type CreateCertificateResponse = {
  /** base64 encoded DER representation of certificate. */
  nvtCertificate?: Certificate
}
export type GetCertificates = Record<string, unknown>
export type GetCertificatesResponse = {
  /** Id and base64 encoded DER representation of all available certificates. */
  nvtCertificate?: Certificate[]
}
export type GetCertificatesStatus = Record<string, unknown>
export type GetCertificatesStatusResponse = {
  /** Indicates if a certificate is used in an optional HTTPS configuration of the device. */
  certificateStatus?: CertificateStatus[]
}
export type SetCertificatesStatus = {
  /** Indicates if a certificate is to be used in an optional HTTPS configuration of the device. */
  certificateStatus?: CertificateStatus[]
}
export type SetCertificatesStatusResponse = Record<string, unknown>
export type DeleteCertificates = {
  /** List of ids of certificates to delete. */
  certificateID?: string[]
}
export type DeleteCertificatesResponse = Record<string, unknown>
export type GetPkcs10Request = {
  /** List of ids of certificates to delete. */
  certificateID?: string
  /** Relative Dinstinguished Name(RDN) CommonName(CN). */
  subject?: string
  /** Optional base64 encoded DER attributes. */
  attributes?: BinaryData
}
export type GetPkcs10RequestResponse = {
  /** base64 encoded DER representation of certificate. */
  pkcs10Request?: BinaryData
}
export type LoadCertificates = {
  /** Optional id and base64 encoded DER representation of certificate. */
  NVTCertificate?: Certificate[]
}
export type LoadCertificatesResponse = Record<string, unknown>
export type GetClientCertificateMode = Record<string, unknown>
export type GetClientCertificateModeResponse = {
  /** Indicates whether or not client certificates are required by device. */
  enabled?: boolean
}
export type SetClientCertificateMode = {
  /** Indicates whether or not client certificates are required by device. */
  enabled?: boolean
}
export type SetClientCertificateModeResponse = Record<string, unknown>
export type GetCACertificates = Record<string, unknown>
export type GetCACertificatesResponse = {
  CACertificate?: Certificate[]
}
export type LoadCertificateWithPrivateKey = {
  certificateWithPrivateKey?: CertificateWithPrivateKey[]
}
export type LoadCertificateWithPrivateKeyResponse = Record<string, unknown>
export type GetCertificateInformation = {
  certificateID?: string
}
export type GetCertificateInformationResponse = {
  certificateInformation?: CertificateInformation
}
export type LoadCACertificates = {
  CACertificate?: Certificate[]
}
export type LoadCACertificatesResponse = Record<string, unknown>
export type CreateDot1XConfiguration = {
  dot1XConfiguration?: Dot1XConfiguration
}
export type CreateDot1XConfigurationResponse = Record<string, unknown>
export type SetDot1XConfiguration = {
  dot1XConfiguration?: Dot1XConfiguration
}
export type SetDot1XConfigurationResponse = Record<string, unknown>
export type GetDot1XConfiguration = {
  dot1XConfigurationToken?: ReferenceToken
}
export type GetDot1XConfigurationResponse = {
  dot1XConfiguration?: Dot1XConfiguration
}
export type GetDot1XConfigurations = Record<string, unknown>
export type GetDot1XConfigurationsResponse = {
  dot1XConfiguration?: Dot1XConfiguration[]
}
export type DeleteDot1XConfiguration = {
  dot1XConfigurationToken?: ReferenceToken[]
}
export type DeleteDot1XConfigurationResponse = Record<string, unknown>
export type GetRelayOutputs = Record<string, unknown>
export type GetRelayOutputsResponse = {
  relayOutputs?: RelayOutput[]
}
export type SetRelayOutputSettings = {
  relayOutputToken?: ReferenceToken
  properties?: RelayOutputSettings
}
export type SetRelayOutputSettingsResponse = Record<string, unknown>
export type SetRelayOutputState = {
  relayOutputToken?: ReferenceToken
  logicalState?: RelayLogicalState
}
export type SetRelayOutputStateResponse = Record<string, unknown>
export type SendAuxiliaryCommand = {
  auxiliaryCommand?: AuxiliaryData
}
export type SendAuxiliaryCommandResponse = {
  auxiliaryCommandResponse?: AuxiliaryData
}
export type GetDot11Capabilities = Record<string, unknown>
export type GetDot11CapabilitiesResponse = {
  capabilities?: Dot11Capabilities
}
export type GetDot11Status = {
  interfaceToken?: ReferenceToken
}
export type GetDot11StatusResponse = {
  status?: Dot11Status
}
export type ScanAvailableDot11Networks = {
  interfaceToken?: ReferenceToken
}
export type ScanAvailableDot11NetworksResponse = {
  networks?: Dot11AvailableNetworks[]
}
export type GetSystemUris = Record<string, unknown>
export type GetSystemUrisResponse = {
  systemLogUris?: SystemLogUriList
  supportInfoUri?: AnyURI
  systemBackupUri?: AnyURI
  extension?: Extension
}
export type StartFirmwareUpgrade = Record<string, unknown>
export type StartFirmwareUpgradeResponse = {
  uploadUri?: AnyURI
  uploadDelay?: unknown
  expectedDownTime?: unknown
}
export type StartSystemRestore = Record<string, unknown>
export type StartSystemRestoreResponse = {
  uploadUri?: AnyURI
  expectedDownTime?: unknown
}
export type SetHashingAlgorithm = {
  /** Hashing algorithm(s) used in HTTP and RTSP Digest Authentication. */
  algorithm?: StringList
}
export type SetHashingAlgorithmResponse = Record<string, unknown>
export type GetStorageConfigurations = Record<string, unknown>
export type GetStorageConfigurationsResponse = {
  storageConfigurations?: StorageConfiguration[]
}
export type CreateStorageConfiguration = {
  storageConfiguration?: StorageConfigurationData
}
export type CreateStorageConfigurationResponse = {
  token?: ReferenceToken
}
export type GetStorageConfiguration = {
  token?: ReferenceToken
}
export type GetStorageConfigurationResponse = {
  storageConfiguration?: StorageConfiguration
}
export type SetStorageConfiguration = {
  storageConfiguration?: StorageConfiguration
}
export type SetStorageConfigurationResponse = Record<string, unknown>
export type DeleteStorageConfiguration = {
  token?: ReferenceToken
}
export type DeleteStorageConfigurationResponse = Record<string, unknown>
export type GetGeoLocation = Record<string, unknown>
export type GetGeoLocationResponse = {
  location?: LocationEntity[]
}
export type SetGeoLocation = {
  location?: LocationEntity[]
}
export type SetGeoLocationResponse = Record<string, unknown>
export type DeleteGeoLocation = {
  location?: LocationEntity[]
}
export type DeleteGeoLocationResponse = Record<string, unknown>
