import type { ReferenceToken } from './common.ts'
import type { Capabilities, Receiver, ReceiverConfiguration, ReceiverMode, ReceiverStateInformation } from './onvif.ts'

export type GetServiceCapabilities = Record<string, unknown>
export type GetServiceCapabilitiesResponse = {
  /** The capabilities for the receiver service is returned in the Capabilities element. */
  capabilities?: Capabilities
}
export type GetReceivers = Record<string, unknown>
export type GetReceiversResponse = {
  /** A list of all receivers that currently exist on the device. */
  receivers?: Receiver[]
}
export type GetReceiver = {
  /** The token of the receiver to be retrieved. */
  receiverToken?: ReferenceToken
}
export type GetReceiverResponse = {
  /** The details of the receiver. */
  receiver?: Receiver
}
export type CreateReceiver = {
  /** The initial configuration for the new receiver. */
  configuration?: ReceiverConfiguration
}
export type CreateReceiverResponse = {
  /** The details of the receiver that was created. */
  receiver?: Receiver
}
export type DeleteReceiver = {
  /** The token of the receiver to be deleted. */
  receiverToken?: ReferenceToken
}
export type DeleteReceiverResponse = Record<string, unknown>
export type ConfigureReceiver = {
  /** The token of the receiver to be configured. */
  receiverToken?: ReferenceToken
  /** The new configuration for the receiver. */
  configuration?: ReceiverConfiguration
}
export type ConfigureReceiverResponse = Record<string, unknown>
export type SetReceiverMode = {
  /** The token of the receiver to be changed. */
  receiverToken?: ReferenceToken
  /** The new receiver mode. Options available are: */
  mode?: ReceiverMode
}
export type SetReceiverModeResponse = Record<string, unknown>
export type GetReceiverState = {
  /** The token of the receiver to be queried. */
  receiverToken?: ReferenceToken
}
export type GetReceiverStateResponse = {
  /** Description of the current receiver state. */
  receiverState?: ReceiverStateInformation
}
