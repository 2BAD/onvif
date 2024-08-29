import type { ReferenceToken } from './common.ts'
import type {
  ArrayOfFileProgress,
  Capabilities,
  GetRecordingJobsResponseItem,
  GetRecordingsResponseItem,
  OnvifDate,
  RecordingConfiguration,
  RecordingJobConfiguration,
  RecordingJobMode,
  RecordingJobReference,
  RecordingJobStateInformation,
  RecordingReference,
  SearchScope,
  StorageReferencePath,
  StringAttrList,
  TrackConfiguration,
  TrackReference
} from './onvif.ts'

export type RecordingOptions = {
  job?: JobOptions
  track?: TrackOptions
}
export type JobOptions = {
  /** Number of spare jobs that can be created for the recording. */
  spare?: number
  /** A device that supports recording of a restricted set of Media/Media2 Service Profiles returns the list of profiles that can be recorded on the given Recording. */
  compatibleSources?: StringAttrList
}
export type TrackOptions = {
  /** Total spare number of tracks that can be added to this recording. */
  spareTotal?: number
  /** Number of spare Video tracks that can be added to this recording. */
  spareVideo?: number
  /** Number of spare Audio tracks that can be added to this recording. */
  spareAudio?: number
  /** Number of spare Metadata tracks that can be added to this recording. */
  spareMetadata?: number
}
export type GetServiceCapabilities = Record<string, unknown>
export type GetServiceCapabilitiesResponse = {
  /** The capabilities for the recording service is returned in the Capabilities element. */
  capabilities?: Capabilities
}
export type CreateRecording = {
  /** Initial configuration for the recording. */
  recordingConfiguration?: RecordingConfiguration
}
export type CreateRecordingResponse = {
  /** The reference to the created recording. */
  recordingToken?: RecordingReference
}
export type DeleteRecording = {
  /** The reference of the recording to be deleted. */
  recordingToken?: RecordingReference
}
export type DeleteRecordingResponse = Record<string, unknown>
export type GetRecordings = Record<string, unknown>
export type GetRecordingsResponse = {
  /** List of recording items. */
  recordingItem?: GetRecordingsResponseItem[]
}
export type SetRecordingConfiguration = {
  /** Token of the recording that shall be changed. */
  recordingToken?: RecordingReference
  /** The new configuration. */
  recordingConfiguration?: RecordingConfiguration
}
export type SetRecordingConfigurationResponse = Record<string, unknown>
export type GetRecordingConfiguration = {
  /** Token of the configuration to be retrieved. */
  recordingToken?: RecordingReference
}
export type GetRecordingConfigurationResponse = {
  /** Configuration of the recording. */
  recordingConfiguration?: RecordingConfiguration
}
export type CreateTrack = {
  /** Identifies the recording to which a track shall be added. */
  recordingToken?: RecordingReference
  /** The configuration of the new track. */
  trackConfiguration?: TrackConfiguration
}
export type CreateTrackResponse = {
  /**
   * The TrackToken shall identify the newly created track. The
   * TrackToken shall be unique within the recoding to which
   * the new track belongs.
   */
  trackToken?: TrackReference
}
export type DeleteTrack = {
  /** Token of the recording the track belongs to. */
  recordingToken?: RecordingReference
  /** Token of the track to be deleted. */
  trackToken?: TrackReference
}
export type DeleteTrackResponse = Record<string, unknown>
export type GetTrackConfiguration = {
  /** Token of the recording the track belongs to. */
  recordingToken?: RecordingReference
  /** Token of the track. */
  trackToken?: TrackReference
}
export type GetTrackConfigurationResponse = {
  /** Configuration of the track. */
  trackConfiguration?: TrackConfiguration
}
export type SetTrackConfiguration = {
  /** Token of the recording the track belongs to. */
  recordingToken?: RecordingReference
  /** Token of the track to be modified. */
  trackToken?: TrackReference
  /** New configuration for the track. */
  trackConfiguration?: TrackConfiguration
}
export type SetTrackConfigurationResponse = Record<string, unknown>
export type CreateRecordingJob = {
  /** The initial configuration of the new recording job. */
  jobConfiguration?: RecordingJobConfiguration
}
export type CreateRecordingJobResponse = {
  /** The JobToken shall identify the created recording job. */
  jobToken?: RecordingJobReference
  /**
   * The JobConfiguration structure shall be the configuration as it is used by the device. This may be different from the
   * JobConfiguration passed to CreateRecordingJob.
   */
  jobConfiguration?: RecordingJobConfiguration
}
export type DeleteRecordingJob = {
  /** The token of the job to be deleted. */
  jobToken?: RecordingJobReference
}
export type DeleteRecordingJobResponse = Record<string, unknown>
export type GetRecordingJobs = Record<string, unknown>
export type GetRecordingJobsResponse = {
  /** List of recording jobs. */
  jobItem?: GetRecordingJobsResponseItem[]
}
export type SetRecordingJobConfiguration = {
  /** Token of the job to be modified. */
  jobToken?: RecordingJobReference
  /** New configuration of the recording job. */
  jobConfiguration?: RecordingJobConfiguration
}
export type SetRecordingJobConfigurationResponse = {
  /**
   * The JobConfiguration structure shall be the configuration
   * as it is used by the device. This may be different from the JobConfiguration passed to SetRecordingJobConfiguration.
   */
  jobConfiguration?: RecordingJobConfiguration
}
export type GetRecordingJobConfiguration = {
  /** Token of the recording job. */
  jobToken?: RecordingJobReference
}
export type GetRecordingJobConfigurationResponse = {
  /** Current configuration of the recording job. */
  jobConfiguration?: RecordingJobConfiguration
}
export type SetRecordingJobMode = {
  /** Token of the recording job. */
  jobToken?: RecordingJobReference
  /** The new mode for the recording job. */
  mode?: RecordingJobMode
}
export type SetRecordingJobModeResponse = Record<string, unknown>
export type GetRecordingJobState = {
  /** Token of the recording job. */
  jobToken?: RecordingJobReference
}
export type GetRecordingJobStateResponse = {
  /** The current state of the recording job. */
  state?: RecordingJobStateInformation
}
export type GetRecordingOptions = {
  /** Token of the recording. */
  recordingToken?: RecordingReference
}
export type GetRecordingOptionsResponse = {
  /** Configuration of the recording. */
  options?: RecordingOptions
}
export type ExportRecordedData = {
  /** Optional parameter that specifies start time for the exporting. */
  startPoint?: OnvifDate
  /** Optional parameter that specifies end time for the exporting. */
  endPoint?: OnvifDate
  /** Indicates the selection criterion on the existing recordings. . */
  searchScope?: SearchScope
  /** Indicates which export file format to be used. */
  fileFormat?: string
  /** Indicates the target storage and relative directory path. */
  storageDestination?: StorageReferencePath
}
export type Extension = Record<string, unknown>
export type ExportRecordedDataResponse = {
  /** Unique operation token for client to associate the relevant events. */
  operationToken?: ReferenceToken
  /** List of exported file names. The device can also use AsynchronousOperationStatus event to publish this list. */
  fileNames?: string[]
  extension?: Extension
}
export type StopExportRecordedData = {
  /** Unique ExportRecordedData operation token */
  operationToken?: ReferenceToken
}
export type StopExportRecordedDataResponse = {
  /** Progress percentage of ExportRecordedData operation. */
  progress?: number
  /**/
  fileProgressStatus?: ArrayOfFileProgress
}
export type GetExportRecordedDataState = {
  /** Unique ExportRecordedData operation token */
  operationToken?: ReferenceToken
}
export type GetExportRecordedDataStateResponse = {
  /** Progress percentage of ExportRecordedData operation. */
  progress?: number
  /**/
  fileProgressStatus?: ArrayOfFileProgress
}
