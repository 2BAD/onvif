import type { ReferenceToken } from './common.ts'
import type { Frame } from './metaDataStream.ts'
import type { Capabilities, Config, SupportedAnalyticsModules, SupportedRules } from './onvif.ts'

export type ConfigOptions = {
  /** The RuleType the ConfigOptions applies to if the Name attribute is ambiguous. */
  ruleType?: unknown
  /**
   * The Name of the SimpleItemDescription/ElementItemDescription
   * the ConfigOptions applies to.
   */
  name: string
  /**
   * Type of the Rule Options represented by a unique QName.
   * The Type defines the element contained in this structure.
   * This attribute is deprecated since its value must be identical to the embedded element.
   */
  type?: unknown
  /** Optional name of the analytics module this constraint applies to. This option is only necessary in cases where different constraints for elements with the same Name exist. */
  analyticsModule?: unknown
  /** Minimal number of occurrences. Defaults to one. */
  minOccurs?: number
  /** Maximum number of occurrences. Defaults to one. */
  maxOccurs?: number
}
export type MetadataInfo = {
  /** Reference to an AnalyticsModule Type. */
  type: unknown
  /** Sample frame content starting with the tt:Frame node. */
  sampleFrame?: Frame
}
export type GetServiceCapabilities = Record<string, unknown>
export type GetServiceCapabilitiesResponse = {
  /** The capabilities for the analytics service is returned in the Capabilities element. */
  capabilities?: Capabilities
}
export type GetSupportedRules = {
  /**
   * References an existing Video Analytics configuration. The list of available tokens can be obtained
   * via the Media service GetVideoAnalyticsConfigurations method.
   */
  configurationToken?: ReferenceToken
}
export type GetSupportedRulesResponse = {
  supportedRules?: SupportedRules
}
export type CreateRules = {
  /** Reference to an existing VideoAnalyticsConfiguration. */
  configurationToken?: ReferenceToken
  rule?: Config[]
}
export type DeleteRules = {
  /** Reference to an existing VideoAnalyticsConfiguration. */
  configurationToken?: ReferenceToken
  /** References the specific rule to be deleted (e.g. "MyLineDetector"). */
  ruleName?: string[]
}
export type ModifyRules = {
  /** Reference to an existing VideoAnalyticsConfiguration. */
  configurationToken?: ReferenceToken
  rule?: Config[]
}
export type GetRules = {
  /** Reference to an existing VideoAnalyticsConfiguration. */
  configurationToken?: ReferenceToken
}
export type GetRulesResponse = {
  rule?: Config[]
}
export type GetRuleOptions = {
  /** Reference to an SupportedRule Type returned from GetSupportedRules. */
  ruleType?: unknown
  /** Reference to an existing analytics configuration. */
  configurationToken?: ReferenceToken
}
export type GetRuleOptionsResponse = {
  /** A device shall provide respective ConfigOptions.RuleType for each RuleOption if the request does not specify RuleType. The response Options shall not contain any AnalyticsModule attribute. */
  ruleOptions?: ConfigOptions[]
}
export type GetSupportedAnalyticsModules = {
  /** Reference to an existing VideoAnalyticsConfiguration. */
  configurationToken?: ReferenceToken
}
export type GetSupportedAnalyticsModulesResponse = {
  supportedAnalyticsModules?: SupportedAnalyticsModules
}
export type CreateAnalyticsModules = {
  /** Reference to an existing VideoAnalyticsConfiguration. */
  configurationToken?: ReferenceToken
  analyticsModule?: Config[]
}
export type DeleteAnalyticsModules = {
  /** Reference to an existing Video Analytics configuration. */
  configurationToken?: ReferenceToken
  /** Name of the AnalyticsModule to be deleted. */
  analyticsModuleName?: string[]
}
export type ModifyAnalyticsModules = {
  /** Reference to an existing VideoAnalyticsConfiguration. */
  configurationToken?: ReferenceToken
  analyticsModule?: Config[]
}
export type GetAnalyticsModules = {
  /** Reference to an existing VideoAnalyticsConfiguration. */
  configurationToken?: ReferenceToken
}
export type GetAnalyticsModulesResponse = {
  analyticsModule?: Config[]
}
export type GetAnalyticsModuleOptions = {
  /** Reference to an SupportedAnalyticsModule Type returned from GetSupportedAnalyticsModules. */
  type?: unknown
  /** Reference to an existing AnalyticsConfiguration. */
  configurationToken?: ReferenceToken
}
export type GetAnalyticsModuleOptionsResponse = {
  /** List of options for the specified analytics module. The response Options shall not contain any RuleType attribute. */
  options?: ConfigOptions[]
}
export type GetSupportedMetadata = {
  /** Optional reference to an AnalyticsModule Type returned from GetSupportedAnalyticsModules. */
  type?: unknown
}
export type GetSupportedMetadataResponse = {
  analyticsModule?: MetadataInfo[]
}
