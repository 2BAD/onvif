import type { ReferenceToken } from './common.ts'
import type { Capabilities, CodingCapabilities, Layout, LayoutOptions, PaneConfiguration } from './onvif.ts'

export type GetServiceCapabilities = Record<string, unknown>
export type GetServiceCapabilitiesResponse = {
  /** The capabilities for the display service is returned in the Capabilities element. */
  capabilities?: Capabilities
}
export type GetLayout = {
  /** Token of the Video Output whose Layout is requested */
  videoOutput?: ReferenceToken
}
export type GetLayoutResponse = {
  /** Current layout of the video output. */
  layout?: Layout
}
export type SetLayout = {
  /** Token of the Video Output whose Layout shall be changed. */
  videoOutput?: ReferenceToken
  /** Layout to be set */
  layout?: Layout
}
export type SetLayoutResponse = Record<string, unknown>
export type GetDisplayOptions = {
  /** Token of the Video Output whose options are requested */
  videoOutput?: ReferenceToken
}
export type GetDisplayOptionsResponse = {
  /**
   * The LayoutOptions describe the fixed and predefined layouts of a device. If the device does
   * not offer fixed layouts and allows setting the layout free this element is empty.
   */
  layoutOptions?: LayoutOptions
  /** decoding and encoding capabilities of the device */
  codingCapabilities?: CodingCapabilities
}
export type GetPaneConfigurations = {
  /** Reference Token of the Video Output whose Pane Configurations are requested */
  videoOutput?: ReferenceToken
}
export type GetPaneConfigurationsResponse = {
  /** Contains a list of defined Panes of the specified VideoOutput. Each VideoOutput has at least one PaneConfiguration. */
  paneConfiguration?: PaneConfiguration[]
}
export type GetPaneConfiguration = {
  /** Reference Token of the Video Output the requested pane belongs to */
  videoOutput?: ReferenceToken
  /** Reference Token of the Pane whose Configuration is requested */
  pane?: ReferenceToken
}
export type GetPaneConfigurationResponse = {
  /** returns the configuration of the requested pane. */
  paneConfiguration?: PaneConfiguration
}
export type SetPaneConfigurations = {
  /** Token of the video output whose panes to set. */
  videoOutput?: ReferenceToken
  /** Pane Configuration to be set. */
  paneConfiguration?: PaneConfiguration[]
}
export type SetPaneConfigurationsResponse = Record<string, unknown>
export type SetPaneConfiguration = {
  /** Token of the video output whose panes to set. */
  videoOutput?: ReferenceToken
  /** Pane Configuration to be set. */
  paneConfiguration?: PaneConfiguration
}
export type SetPaneConfigurationResponse = Record<string, unknown>
export type CreatePaneConfiguration = {
  /** Token of the video output where the pane shall be created. */
  videoOutput?: ReferenceToken
  /** Configuration of the pane to be created. */
  paneConfiguration?: PaneConfiguration
}
export type CreatePaneConfigurationResponse = {
  /** Token of the new pane configuration. */
  paneToken?: ReferenceToken
}
export type DeletePaneConfiguration = {
  /** Token of the video output where the pane shall be deleted. */
  videoOutput?: ReferenceToken
  /** Token of the pane to be deleted. */
  paneToken?: ReferenceToken
}
export type DeletePaneConfigurationResponse = Record<string, unknown>
