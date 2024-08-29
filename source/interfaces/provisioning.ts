import type { ReferenceToken } from './common.ts'
import type { PositiveInteger } from './types.ts'

/** The direction for PanMove to move the device. */
export type PanDirection = 'Left' | 'Right'
/** The direction for TiltMove to move the device. */
export type TiltDirection = 'Up' | 'Down'
/** The direction for ZoomMove to change the focal length in relation to the video source. */
export type ZoomDirection = 'Wide' | 'Telephoto'
/** The direction for RollMove to move the device. */
export type RollDirection = 'Clockwise' | 'Counterclockwise' | 'Auto'
/** The direction for FocusMove to move the focal plane in relation to the video source. */
export type FocusDirection = 'Near' | 'Far' | 'Auto'
/** The quantity of movement events that have occured over the lifetime of the device. */
export type Usage = {
  /** The quantity of pan movement events over the life of the device. */
  pan?: PositiveInteger
  /** The quantity of tilt movement events over the life of the device. */
  tilt?: PositiveInteger
  /** The quantity of zoom movement events over the life of the device. */
  zoom?: PositiveInteger
  /** The quantity of roll movement events over the life of the device. */
  roll?: PositiveInteger
  /** The quantity of focus movement events over the life of the device. */
  focus?: PositiveInteger
}
/** The provisioning capabilities of a video source on the device. */
export type SourceCapabilities = {
  /** Unique identifier of a video source. */
  videoSourceToken: ReferenceToken
  /** Lifetime limit of pan moves for this video source.  Presence of this attribute indicates support of pan move. */
  maximumPanMoves?: PositiveInteger
  /** Lifetime limit of tilt moves for this video source.  Presence of this attribute indicates support of tilt move. */
  maximumTiltMoves?: PositiveInteger
  /** Lifetime limit of zoom moves for this video source.  Presence of this attribute indicates support of zoom move. */
  maximumZoomMoves?: PositiveInteger
  /** Lifetime limit of roll moves for this video source.  Presence of this attribute indicates support of roll move. */
  maximumRollMoves?: PositiveInteger
  /** Indicates "auto" as a valid enum for Direction in RollMove. */
  autoLevel?: boolean
  /** Lifetime limit of focus moves for this video source.  Presence of this attribute indicates support of focus move. */
  maximumFocusMoves?: PositiveInteger
  /** Indicates "auto" as a valid enum for Direction in FocusMove. */
  autoFocus?: boolean
}
/** The capabilities of Provisioning Service on the device. */
export type Capabilities = {
  /** Maximum time before stopping movement after a move operation. */
  defaultTimeout?: unknown
  /** Capabilities per video source. */
  source?: SourceCapabilities[]
}
export type GetServiceCapabilities = Record<string, unknown>
export type GetServiceCapabilitiesResponse = {
  /** The capabilities for the provisioning service on this device. */
  capabilities?: Capabilities
}
export type PanMove = {
  /** The video source associated with the provisioning. */
  videoSource?: ReferenceToken
  /** "left" or "right". */
  direction?: PanDirection
  /** "Operation timeout, if less than default timeout. */
  timeout?: unknown
}
export type PanMoveResponse = Record<string, unknown>
export type TiltMove = {
  /** The video source associated with the provisioning. */
  videoSource?: ReferenceToken
  /** "up" or "down". */
  direction?: TiltDirection
  /** "Operation timeout, if less than default timeout. */
  timeout?: unknown
}
export type TiltMoveResponse = Record<string, unknown>
export type ZoomMove = {
  /** The video source associated with the provisioning. */
  videoSource?: ReferenceToken
  /** "wide" or "telephoto". */
  direction?: ZoomDirection
  /** "Operation timeout, if less than default timeout. */
  timeout?: unknown
}
export type ZoomMoveResponse = Record<string, unknown>
export type RollMove = {
  /** The video source associated with the provisioning. */
  videoSource?: ReferenceToken
  /** "clockwise", "counterclockwise", or "auto". */
  direction?: RollDirection
  /** "Operation timeout, if less than default timeout. */
  timeout?: unknown
}
export type RollMoveResponse = Record<string, unknown>
export type FocusMove = {
  /** The video source associated with the provisioning. */
  videoSource?: ReferenceToken
  /** "near", "far", or "auto". */
  direction?: FocusDirection
  /** "Operation timeout, if less than default timeout. */
  timeout?: unknown
}
export type FocusMoveResponse = Record<string, unknown>
export type Stop = {
  /** The video source associated with the provisioning. */
  videoSource?: ReferenceToken
}
export type StopResponse = Record<string, unknown>
export type GetUsage = {
  /** The video source associated with the provisioning. */
  videoSource?: ReferenceToken
}
export type GetUsageResponse = {
  /** The set of lifetime usage values for the provisioning associated with the video source. */
  usage?: Usage
}
