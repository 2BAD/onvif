import type { ReferenceToken } from './common.ts'
import type { Description, Name } from './onvif.ts'
import type { DataEntity } from './types.ts'

/**
 * The service capabilities reflect optional functionality of a service. The information is static
 * and does not change during device operation. The following capabilities are available:
 */
export type ServiceCapabilities = {
  /**
   * The maximum number of entries returned by a single Get&lt;Entity&gt;List or Get&lt;Entity&gt;
   * request. The device shall never return more than this number of entities in a single
   * response.
   */
  maxLimit: unknown
  /** Indicates the maximum number of access profiles supported by the device. */
  maxAccessProfiles: unknown
  /** Indicates the maximum number of access policies per access profile supported by the device. */
  maxAccessPoliciesPerAccessProfile: unknown
  /**
   * Indicates whether or not several access policies can refer to the same access point in an
   * access profile.
   */
  multipleSchedulesPerAccessPointSupported: boolean
  /**
   * Indicates that the client is allowed to supply the token when creating access profiles. To
   * enable the use of the command SetAccessProfile, the value must be set to true.
   */
  clientSuppliedTokenSupported?: boolean
}
/**
 * The access policy is an association of an access point and a schedule. It defines when an access
 * point can be accessed using an access profile which contains this access policy. If an access
 * profile contains several access policies specifying different schedules for the same access
 * point will result in a union of the schedules.
 */
export type AccessPolicy = {
  /** Reference to the schedule used by the access policy. */
  scheduleToken?: ReferenceToken
  /**
   * Reference to the entity used by the rule engine, the entity type may be specified by the
   * optional EntityType field explained below but is typically an access point.
   */
  entity?: ReferenceToken
  /**
   * Optional entity type; if missing, an access point type as defined by the ONVIF Access
   * Control Service Specification should be assumed. This can also be represented by the
   * QName value	“tac:AccessPoint” where tac is the namespace of ONVIF Access Control
   * Service Specification. This field is provided for future extensions; it will allow an
   * access policy being	extended to cover entity types other than access points as well.
   */
  entityType?: unknown
  extension?: AccessPolicyExtension
}
export type AccessPolicyExtension = {}
/**
 * The AccessProfileInfo structure contains basic information about an access profile. The device
 * shall provide the following fields for each access profile instance.
 */
export type AccessProfileInfo = {
  /** A user readable name. It shall be up to 64 characters. */
  name?: Name
  /**
   * User readable description for the access profile. It shall be up
   * to 1024 characters.
   */
  description?: Description
} & DataEntity
/**
 * The access profile structure contains information about the collection of access policies. The
 * device shall include all properties of the AccessProfileInfo structure and also a list of access
 * policies.
 */
export type AccessProfile = {
  /**
   * A list of access policy structures, where each access policy
   * defines during which schedule an access point can be accessed.
   */
  accessPolicy?: AccessPolicy[]
  extension?: AccessProfileExtension
} & AccessProfileInfo
export type AccessProfileExtension = {}
export type GetServiceCapabilities = {}
export type GetServiceCapabilitiesResponse = {
  /**
   * The capability response message contains the requested access rules
   * service capabilities using a hierarchical XML capability structure.
   */
  capabilities?: ServiceCapabilities
}
export type GetAccessProfileInfo = {
  /** Tokens of AccessProfileInfo items to get. */
  token?: ReferenceToken[]
}
export type GetAccessProfileInfoResponse = {
  /** List of AccessProfileInfo items. */
  accessProfileInfo?: AccessProfileInfo[]
}
export type GetAccessProfileInfoList = {
  /**
   * Maximum number of entries to return. If not specified, less than one
   * or higher than what the device supports, the number of items is determined by the
   * device.
   */
  limit?: number
  /**
   * Start returning entries from this start reference. If not specified,
   * entries shall start from the beginning of the dataset.
   */
  startReference?: string
}
export type GetAccessProfileInfoListResponse = {
  /**
   * StartReference to use in next call to get the following items. If
   * absent, no more items to get.
   */
  nextStartReference?: string
  /** List of AccessProfileInfo items. */
  accessProfileInfo?: AccessProfileInfo[]
}
export type GetAccessProfiles = {
  /** Tokens of AccessProfile items to get. */
  token?: ReferenceToken[]
}
export type GetAccessProfilesResponse = {
  /** List of Access Profile items. */
  accessProfile?: AccessProfile[]
}
export type GetAccessProfileList = {
  /**
   * Maximum number of entries to return. If not specified, less than one
   * or higher than what the device supports, the number of items is determined by the
   * device.
   */
  limit?: number
  /**
   * Start returning entries from this start reference. If not specified,
   * entries shall start from the beginning of the dataset.
   */
  startReference?: string
}
export type GetAccessProfileListResponse = {
  /**
   * StartReference to use in next call to get the following items. If
   * absent, no more items to get.
   */
  nextStartReference?: string
  /** List of Access Profile items. */
  accessProfile?: AccessProfile[]
}
export type CreateAccessProfile = {
  /** The AccessProfile to create. */
  accessProfile?: AccessProfile
}
export type CreateAccessProfileResponse = {
  /** The Token of created AccessProfile. */
  token?: ReferenceToken
}
export type ModifyAccessProfile = {
  /** The details of Access Profile */
  accessProfile?: AccessProfile
}
export type ModifyAccessProfileResponse = {}
export type SetAccessProfile = {
  /** The AccessProfile item to create or modify */
  accessProfile?: AccessProfile
}
export type SetAccessProfileResponse = {}
export type DeleteAccessProfile = {
  /** The token of the access profile to delete. */
  token?: ReferenceToken
}
export type DeleteAccessProfileResponse = {}
