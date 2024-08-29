import type { AnyURI } from './basics.ts'
import type { Capabilities, OnvifDate } from './onvif.ts'

export type AppState = 'Active' | 'Inactive' | 'Installing' | 'Uninstalling' | 'Removed' | 'InstallationFailed'
export type AppInfo = {
  /** Unique app identifier of the application instance. */
  appID?: string
  /** User readable application name */
  name?: string
  /** Version of the installed application. The details of the format are outside of the scope of this specification. */
  version?: string
  /** Licenses associated with the application. */
  licenses?: LicenseInfo[]
  /** List of privileges granted to the application. */
  privileges?: string[]
  /** Date and time when the application has been installed. */
  installationDate?: OnvifDate
  /** Time of last update to this app, i.e. the time when this particular version was installed. */
  lastUpdate?: OnvifDate
  /** InstallationFailed state shall not be used here. */
  state?: AppState
  /** Supplemental information why the application is in the current state. In error cases this field contains the error reason. */
  status?: string
  /** If set the application will start automatically after booting of the device. */
  autostart?: boolean
  /** Link to supplementary information about the application or its vendor. */
  website?: AnyURI
  /** Link to a list of open source licenses used by the application. */
  openSource?: AnyURI
  /** Optional Uri for backup and restore of the application configuration. */
  configuration?: AnyURI
  /** Optional reference to the interface definition of the application. */
  interfaceDescription?: AnyURI[]
}
export type LicenseInfo = {
  /** Textual name of the license */
  name?: string
  /** Start time of validity */
  validFrom?: OnvifDate
  /** End time of validity */
  validUntil?: OnvifDate
}
export type Uninstall = {
  /** App to be uninstalled. Possible failures during de-installation will be delivered via an event. */
  appID?: string
}
export type UninstallResponse = Record<string, unknown>
export type GetAppsInfo = {
  /** Optional ID to only retrieve information for a single application. */
  appID?: string
}
export type GetAppsInfoResponse = {
  info?: AppInfo[]
}
export type GetInstalledApps = Record<string, unknown>
export type App = {
  name?: string
  appID?: string
}
export type GetInstalledAppsResponse = {
  /** List of installed apps providing both user readable name and token. */
  app?: App[]
}
export type Activate = {
  /** App identifier. */
  appID?: string
}
export type ActivateResponse = Record<string, unknown>
export type Deactivate = {
  /** App identifier. */
  appID?: string
}
export type DeactivateResponse = Record<string, unknown>
export type InstallLicense = {
  /** Application the license shall be associated to. */
  appID?: string
  /** Opaque machine readable license string. */
  license?: string
}
export type InstallLicenseResponse = Record<string, unknown>
export type GetServiceCapabilities = Record<string, unknown>
export type GetServiceCapabilitiesResponse = {
  /** The capabilities of the service. */
  capabilities?: Capabilities
}
export type GetDeviceId = Record<string, unknown>
export type GetDeviceIdResponse = {
  deviceId?: string
}
