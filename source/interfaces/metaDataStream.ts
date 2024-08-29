import type { AnyURI } from './basics.ts'
import type {
  ColorDescriptor,
  GeoLocation,
  GeoOrientation,
  Polygon,
  PTZStatus,
  Rectangle,
  SphericalCoordinate,
  Transformation,
  Vector
} from './common.ts'
import type { HumanBody } from './humanbody.2.ts'
import type { HumanFace } from './humanface.2.ts'
import type { OnvifDate } from './onvif.ts'

export type VehicleType = 'Bus' | 'Car' | 'Truck' | 'Bicycle' | 'Motorcycle'
export type PlateType = 'Normal' | 'Police' | 'Diplomat' | 'Temporary'
export type BarcodeType =
  | 'Code-39'
  | 'Code-49'
  | 'Code-93'
  | 'Code-128'
  | 'Code-11'
  | 'Code-25-Interleaved'
  | 'Code-25-NonInterleaved'
  | 'DataMatrix'
  | 'Maxicode'
  | 'Postnet'
  | 'RM4SCC'
  | 'ISBN-13'
  | 'ISBN-13-Dual'
  | 'ISBN-10'
  | 'ITF-14'
  | 'EAN-2'
  | 'EAN-8'
  | 'EAN-13'
  | 'EAN-14'
  | 'EAN-18'
  | 'EAN-99'
  | 'EAN-128'
  | 'SCC-14'
  | 'SSCC-18'
  | 'UPC-A'
  | 'UPC-E'
  | 'PDF417'
  | 'QRCode'
export type ObjectType = 'Animal' | 'HumanFace' | 'Human' | 'Bicycle' | 'Vehicle' | 'LicensePlate' | 'Bike' | 'Barcode'
export type ClassType = 'Animal' | 'Face' | 'Human' | 'Vehical' | 'Other'
export interface Appearance {
  transformation?: Transformation
  shape?: ShapeDescriptor
  color?: ColorDescriptor
  class?: ClassDescriptor
  extension?: AppearanceExtension
  geoLocation?: GeoLocation
  vehicleInfo?: VehicleInfo[]
  licensePlateInfo?: LicensePlateInfo
  humanFace?: HumanFace
  humanBody?: HumanBody
  imageRef?: AnyURI
  image?: unknown
  barcodeInfo?: BarcodeInfo
  sphericalCoordinate?: SphericalCoordinate
}
export type AppearanceExtension = {}
export interface BarcodeInfo {
  /** Information encoded in barcode */
  data?: StringLikelihood
  /** Acceptable values are defined in tt:BarcodeType */
  type?: StringLikelihood
  /** Refers to the pixels per module */
  PPM?: number
}
export interface VehicleInfo {
  type?: StringLikelihood
  brand?: StringLikelihood
  model?: StringLikelihood
}
export interface LicensePlateInfo {
  /** A string of vehicle license plate number. */
  plateNumber?: StringLikelihood
  /** A description of the vehicle license plate, e.g., "Normal", "Police", "Diplomat" */
  plateType?: StringLikelihood
  /** Describe the country of the license plate, in order to avoid the same license plate number. */
  countryCode?: StringLikelihood
  /** State province or authority that issue the license plate. */
  issuingEntity?: StringLikelihood
}
export interface ShapeDescriptor {
  boundingBox?: Rectangle
  centerOfGravity?: Vector
  polygon?: Polygon[]
  extension?: ShapeDescriptorExtension
}
export type ShapeDescriptorExtension = {}
export type StringLikelihood = {}
export interface ClassCandidate {
  type?: ClassType
  likelihood?: number
}
export interface ClassDescriptor {
  classCandidate?: ClassCandidate[]
  extension?: ClassDescriptorExtension
  /** ONVIF recommends to use this 'Type' element instead of 'ClassCandidate' and 'Extension' above for new design. Acceptable values are defined in tt:ObjectType. */
  type?: StringLikelihood[]
}
export interface ClassDescriptorExtension {
  otherTypes?: OtherType[]
  extension?: ClassDescriptorExtension2
}
export type ClassDescriptorExtension2 = {}
export interface OtherType {
  /** Object Class Type */
  type?: string
  /** A likelihood/probability that the corresponding object belongs to this class. The sum of the likelihoods shall NOT exceed 1 */
  likelihood?: number
}
export interface OnvifObject extends ObjectId {
  appearance?: Appearance
  behaviour?: Behaviour
  extension?: ObjectExtension
}
export type ObjectExtension = {}
export interface Frame {
  utcTime: OnvifDate
  /** Default color space of Color definitions in frame. Valid values are "RGB" and "YCbCr". Defaults to "YCbCr". */
  colorspace?: string
  /** Optional name of the analytics module that generated this frame. */
  source?: string
  PTZStatus?: PTZStatus
  transformation?: Transformation
  object?: unknown[]
  objectTree?: ObjectTree
  extension?: FrameExtension
  sceneImageRef?: AnyURI
  sceneImage?: unknown
}
export interface FrameExtension {
  motionInCells?: MotionInCells
  extension?: FrameExtension2
}
export type FrameExtension2 = {}
export interface Merge {
  from?: ObjectId[]
  to?: ObjectId
}
export interface Split {
  from?: ObjectId
  to?: ObjectId[]
}
export interface Rename {
  from?: ObjectId
  to?: ObjectId
}
export interface ObjectId {
  objectId?: number
}
export type Removed = {}
export type Idle = {}
export interface Behaviour {
  removed?: Removed
  idle?: Idle
  extension?: BehaviourExtension
  speed?: number
  /** Direction the object is moving. Yaw describes the horizontal direction in the range [-180..180] where 0 is towards the right of the device and 90 is away from the device. Pitch describes the vertical direction in the range [-90..90] where 90 is upwards. */
  direction?: GeoOrientation
}
export type BehaviourExtension = {}
export interface ObjectTree {
  rename?: Rename[]
  split?: Split[]
  merge?: Merge[]
  delete?: ObjectId[]
  extension?: ObjectTreeExtension
}
export type ObjectTreeExtension = {}
export interface MotionInCells {
  /** Number of columns of the cell grid (x dimension) */
  columns: number
  /** Number of rows of the cell grid (y dimension) */
  rows: number
  /** A “1” denotes a cell where motion is detected and a “0” an empty cell. The first cell is in the upper left corner. Then the cell order goes first from left to right and then from up to down.  If the number of cells is not a multiple of 8 the last byte is filled with zeros. The information is run length encoded according to Packbit coding in ISO 12369 (TIFF, Revision 6.0). */
  cells: unknown
}
export type MetadataStream = {}
export interface MetadataStreamExtension {
  audioAnalyticsStream?: AudioAnalyticsStream
  extension?: MetadataStreamExtension2
}
export type MetadataStreamExtension2 = {}
export interface AudioAnalyticsStream {
  audioDescriptor?: AudioDescriptor[]
  extension?: AudioAnalyticsStreamExtension
}
export interface AudioDescriptor {
  utcTime: OnvifDate
}
export type AudioAnalyticsStreamExtension = {}
export type VideoAnalyticsStream = {}
export type VideoAnalyticsStreamExtension = {}
export type PTZStream = {}
export type PTZStreamExtension = {}
export type EventStream = {}
export type EventStreamExtension = {}
