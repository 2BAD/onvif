/**
 * Module to provide backward compatibility with versions 0.x
 */

import { EventEmitter } from 'node:events'
import type { ReferenceToken } from '../interfaces/common.ts'
import type { SetNTP } from '../interfaces/deviceManagement.ts'
import type { GetOSDs } from '../interfaces/media.2.ts'
import type { NetworkHostType } from '../interfaces/onvif.ts'
import type { GetSnapshotUriOptions, GetStreamUriOptions } from '../media.ts'
import { Onvif, type OnvifRequestOptions, type SetSystemDateAndTimeOptions } from '../onvif.ts'
import type {
  AbsoluteMoveOptions,
  ContinuousMoveOptions,
  GetPresetsOptions,
  GetStatusOptions,
  GotoHomePositionOptions,
  GotoPresetOptions,
  RelativeMoveOptions,
  RemovePresetOptions,
  SetHomePositionOptions,
  SetPresetOptions
} from '../ptz.ts'

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export type Callback = (error: any, result?: any) => void // eslint-disable-line @typescript-eslint/no-explicit-any
export type CompatibilityAbsoluteMoveOptions = AbsoluteMoveOptions & { x?: number; y?: number; zoom?: number }
export type CompatibilityRelativeMoveOptions = RelativeMoveOptions & { x?: number; y?: number; zoom?: number }
type CompatibilityContinuousMoveOptions = {
  x?: number
  y?: number
  zoom?: number
  onlySendPanTilt?: boolean
  onlySendZoom?: boolean
} & ContinuousMoveOptions

export class Cam extends EventEmitter {
  private readonly onvif: Onvif
  constructor(options: any, callback: Callback) {
    super()
    this.onvif = new Onvif({
      ...options,
      autoConnect: callback !== undefined ? false : options.autoconnect
    })
    if (callback) {
      this.onvif
        .connect()
        .then((result) => {
          callback(null, result)
        })
        .catch(callback)
    }
  }

  get port() {
    return this.onvif.port
  }
  get path() {
    return this.onvif.path
  }
  set hostname(name: string) {
    this.onvif.hostname = name
  }
  set timeout(time: number) {
    this.onvif.timeout = time
  }
  get timeout() {
    return this.onvif.timeout
  }
  get services() {
    return this.onvif.device.services
  }
  get capabilities() {
    return this.onvif.capabilities
  }
  get uri() {
    return this.onvif.uri
  }
  get videoSources() {
    return this.onvif.media.videoSources
  }
  get profiles() {
    return this.onvif.media.profiles
  }
  get defaultProfile() {
    return this.onvif.defaultProfile
  }
  get defaultProfiles() {
    return this.onvif.defaultProfiles
  }
  get activeSource() {
    return this.onvif.activeSource
  }
  get serviceCapabilities() {
    return this.onvif.device.serviceCapabilities
  }
  get deviceInformation() {
    return this.onvif.deviceInformation
  }
  get nodes() {
    return this.onvif.ptz.nodes
  }
  get configurations() {
    return this.onvif.ptz.configurations
  }
  get presets() {
    return Object.fromEntries(Object.values(this.onvif.ptz.presets).map((preset) => [preset.name, preset.token]))
  }

  connect(callback: Callback): void {
    this.onvif
      .connect()
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  _request(options: OnvifRequestOptions, callback: Callback): void {
    if (typeof callback !== 'function') {
      throw new Error('`callback` must be a function')
    }
    this.onvif
      .request(options)
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  getSystemDateAndTime(callback: Callback): void {
    this.onvif.device
      .getSystemDateAndTime()
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  setSystemDateAndTime(value: SetSystemDateAndTimeOptions, callback: Callback): void {
    this.onvif.device
      .setSystemDateAndTime(value)
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  getHostname(callback: Callback): void {
    this.onvif.device
      .getHostname()
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  getScopes(callback: Callback): void {
    this.onvif.device
      .getScopes()
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  setScopes(value: string[], callback: Callback): void {
    this.onvif.device
      .setScopes(value)
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  getCapabilities(callback: Callback): void {
    this.onvif.device
      .getCapabilities()
      .then((result) => {
        callback(null, result.capabilities)
      })
      .catch(callback)
  }

  getServiceCapabilities(callback: Callback): void {
    this.onvif.device
      .getServiceCapabilities()
      .then((result) => {
        callback(null, result.capabilities)
      })
      .catch(callback)
  }

  getActiveSources(callback: Callback): void {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.onvif
      .getActiveSources()
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  getVideoSources(callback: Callback): void {
    this.onvif.media
      .getVideoSources()
      .then((result) => {
        callback(null, result.videoSources)
      })
      .catch(callback)
  }

  getVideoSourceConfigurations(callback: Callback): void {
    this.onvif.media
      .getVideoSourceConfigurations()
      .then((result) => {
        callback(null, result.configurations)
      })
      .catch(callback)
  }

  getVideoEncoderConfigurations(callback: Callback): void {
    this.onvif.media
      .getVideoEncoderConfigurations()
      .then((result) => {
        callback(null, result.configurations)
      })
      .catch(callback)
  }

  getServices(includeCapability: boolean | Callback, callback: Callback): void {
    if (callback) {
      this.onvif.device
        .getServices({ includeCapability: includeCapability as boolean })
        .then((result) => {
          callback(null, result.service)
        })
        .catch(callback)
    } else {
      this.onvif.device
        .getServices()
        .then((result) => {
          ;(includeCapability as Callback)(null, result.service)
        })
        .catch(callback)
    }
  }

  getDeviceInformation(callback: Callback): void {
    this.onvif.device
      .getDeviceInformation()
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  getStreamUri(options: GetStreamUriOptions, callback: Callback): void
  getStreamUri(callback: Callback): void
  getStreamUri(options: GetStreamUriOptions | Callback, callback?: Callback): void {
    if (callback) {
      this.onvif.media
        .getStreamUri(options as GetStreamUriOptions)
        .then((result) => {
          callback(null, result)
        })
        .catch(callback)
    }
    this.onvif.media
      .getStreamUri()
      .then((result) => {
        ;(options as Callback)(null, result)
      })
      .catch(options as Callback)
  }

  getSnapshotUri(options: GetSnapshotUriOptions, callback: Callback): void
  getSnapshotUri(callback: Callback): void
  getSnapshotUri(options: GetSnapshotUriOptions | Callback, callback?: Callback): void {
    if (callback) {
      this.onvif.media
        .getSnapshotUri(options as GetSnapshotUriOptions)
        .then((result) => {
          callback(null, result)
        })
        .catch(callback)
    }
    this.onvif.media
      .getSnapshotUri()
      .then((result) => {
        ;(options as Callback)(null, result)
      })
      .catch(options as Callback)
  }

  getNodes(callback: Callback): void {
    this.onvif.ptz
      .getNodes()
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  getConfigurations(callback: Callback): void {
    this.onvif.ptz
      .getConfigurations()
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  getConfigurationOptions(configurationToken: ReferenceToken, callback: Callback): void {
    this.onvif.ptz
      .getConfigurationOptions({ configurationToken })
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  systemReboot(callback: Callback): void {
    this.onvif.device
      .systemReboot()
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  getPresets(options: GetPresetsOptions, callback: Callback): void
  getPresets(callback: Callback): void
  getPresets(options: GetPresetsOptions | Callback, callback?: Callback): void {
    if (callback) {
      this.onvif.ptz
        .getPresets(options as GetPresetsOptions)
        .then((result) => {
          callback(null, Object.fromEntries(Object.values(result).map((preset) => [preset.name, preset.token])))
        })
        .catch(callback)
    }
    this.onvif.ptz
      .getPresets()
      .then((result) => {
        ;(options as Callback)(
          null,
          Object.fromEntries(Object.values(result).map((preset) => [preset.name, preset.token]))
        )
      })
      .catch(options as Callback)
  }

  gotoPreset(options: GotoPresetOptions, callback: Callback): void {
    this.onvif.ptz
      .gotoPreset(options)
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  setPreset(options: SetPresetOptions, callback: Callback): void {
    this.onvif.ptz
      .setPreset(options)
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  removePreset(options: RemovePresetOptions, callback: Callback): void {
    this.onvif.ptz
      .removePreset(options)
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  gotoHomePosition(options: GotoHomePositionOptions, callback: Callback): void {
    this.onvif.ptz
      .gotoHomePosition(options)
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  setHomePosition(options: SetHomePositionOptions, callback: Callback): void {
    this.onvif.ptz
      .setHomePosition(options)
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  getStatus(options: GetStatusOptions, callback: Callback): void
  getStatus(callback: Callback): void
  getStatus(options: GetStatusOptions | Callback, callback?: Callback): void {
    if (callback) {
      this.onvif.ptz
        .getStatus(options as GetStatusOptions)
        .then((result) => {
          callback(null, result)
        })
        .catch(callback)
    }
    this.onvif.ptz
      .getStatus()
      .then((result) => {
        ;(options as Callback)(null, result)
      })
      .catch(options as Callback)
  }

  absoluteMove(compatibilityOptions: CompatibilityAbsoluteMoveOptions, callback?: Callback): void {
    const options: AbsoluteMoveOptions = {
      ...compatibilityOptions,
      position: {
        panTilt: {
          x: compatibilityOptions.x!,
          y: compatibilityOptions.y!
        },
        zoom: { x: compatibilityOptions.zoom! }
      }
    }
    if (callback) {
      this.onvif.ptz
        .absoluteMove(options)
        .then((result) => {
          callback(null, result)
        })
        .catch(callback)
    } else {
      this.onvif.ptz.absoluteMove(options).catch((err) => this.emit('error', err))
    }
  }

  relativeMove(compatibilityOptions: CompatibilityRelativeMoveOptions, callback?: Callback): void {
    const options: RelativeMoveOptions = {
      ...compatibilityOptions,
      translation: {
        panTilt: {
          x: compatibilityOptions.x!,
          y: compatibilityOptions.y!
        },
        zoom: { x: compatibilityOptions.zoom! }
      }
    }
    if (callback) {
      this.onvif.ptz
        .relativeMove(options)
        .then((result) => {
          callback(null, result)
        })
        .catch(callback)
    } else {
      this.onvif.ptz.relativeMove(options).catch((err) => this.emit('error', err))
    }
  }

  continuousMove(compatibilityOptions: CompatibilityContinuousMoveOptions, callback?: Callback): void {
    const options: ContinuousMoveOptions = {
      ...compatibilityOptions,
      velocity: {
        ...(compatibilityOptions.x &&
          compatibilityOptions.y &&
          !compatibilityOptions.onlySendZoom && {
            panTilt: {
              x: compatibilityOptions.x,
              y: compatibilityOptions.y
            }
          }),
        ...(compatibilityOptions.zoom &&
          !compatibilityOptions.onlySendPanTilt && {
            zoom: { x: compatibilityOptions.zoom }
          })
      }
    }
    if (callback) {
      this.onvif.ptz
        .continuousMove(options)
        .then((result) => {
          callback(null, result)
        })
        .catch(callback)
    } else {
      this.onvif.ptz.continuousMove(options).catch((err) => this.emit('error', err))
    }
  }

  stop(): void
  stop(options: GetStatusOptions, callback: Callback): void
  stop(callback: Callback): void
  stop(options?: GetStatusOptions | Callback, callback?: Callback): void {
    if (callback) {
      this.onvif.ptz
        .stop(options as GetStatusOptions)
        .then((result) => {
          callback(null, result)
        })
        .catch(callback)
    }
    this.onvif.ptz
      .stop()
      .then((result) => {
        if (typeof options === 'function') {
          options(null, result)
        }
      })
      .catch(options ? (options as Callback) : (error) => this.emit('error', error))
  }

  getNTP(callback: Callback): void {
    this.onvif.device
      .getNTP()
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  setNTP(options: SetNTPOptions, callback: Callback): void {
    if (!Array.isArray(options.NTPManual)) {
      options.NTPManual = []
    }
    // For backward compatibility
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    if (options.type || options.ipv4Address || options.ipv6Address || options.dnsName || options.extension) {
      // Note the case changes to follow the xml parser rules
      options.NTPManual.push({
        type: options.type,
        IPv4Address: options.ipv4Address,
        IPv6Address: options.ipv6Address,
        DNSname: options.dnsName,
        // @ts-expect-error TODO check this, probably wrong type def
        extension: options.extension
      })
    }
    this.onvif.device
      .setNTP(options)
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  getDNS(callback: Callback): void {
    this.onvif.device
      .getDNS()
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  getNetworkInterfaces(callback: Callback): void {
    this.onvif.device
      .getNetworkInterfaces()
      .then((result) => {
        callback(null, result)
      })
      .catch(callback)
  }

  getOSDs(options?: GetOSDs | Callback, callback?: Callback): void {
    if (callback) {
      this.onvif.media
        .getOSDs(options as GetOSDs)
        .then((result) => {
          callback(null, result)
        })
        .catch(callback)
    }
    this.onvif.media
      .getOSDs()
      .then((result) => {
        if (typeof options === 'function') {
          options(null, result)
        }
      })
      .catch(options ? (options as Callback) : (error) => this.emit('error', error))
  }

  getOSDOptions(options?: GetOSDOptions | Callback, callback?: Callback): void {
    if (callback) {
      this.onvif.media
        .getOSDOptions({
          configurationToken: (options as GetOSDOptions).videoSourceConfigurationToken
        })
        .then((result) => {
          callback(null, result)
        })
        .catch(callback)
    }
    this.onvif.media
      .getOSDOptions()
      .then((result) => {
        if (typeof options === 'function') {
          options(null, result)
        }
      })
      .catch(options ? (options as Callback) : (error) => this.emit('error', error))
  }
}

type GetOSDOptions = {
  videoSourceConfigurationToken: string
}

type SetNTPOptions = {
  // For backward compatibility
  type?: NetworkHostType
  ipv4Address?: string
  ipv6Address?: string
  dnsName?: string
  extension?: string
} & SetNTP
