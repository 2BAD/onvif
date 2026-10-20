import { Device, SoapFaultError } from '@2bad/onvif'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { media } from '../../media/source/index.ts'
import { type AnalyticsClient, type AnalyticsConfigurationClient, analytics } from '#index.ts'

const hostname = process.env['ONVIF_TEST_HOST']
const username = process.env['ONVIF_TEST_USER']
const password = process.env['ONVIF_TEST_PASS']

describe.skipIf(!hostname)('analytics on a live camera', () => {
  let device: Device & { analytics: AnalyticsClient }
  let configuration: AnalyticsConfigurationClient

  beforeAll(async () => {
    const connected = await Device.connect({
      hostname: hostname ?? '',
      username: username ?? '',
      password: password ?? ''
    })
    device = connected.use(analytics)
    const { profiles = [] } = await connected.use(media).media.v1.getProfiles()
    const token = profiles.find((profile) => profile.videoAnalyticsConfiguration)?.videoAnalyticsConfiguration?.token
    configuration = device.analytics.forConfiguration(token ?? '')
  })

  afterAll(() => device.close())

  it('reads the rules and analytics modules with types from the supported lists', async () => {
    await device.analytics.getServiceCapabilities()
    const { supportedRules } = await configuration.getSupportedRules()
    const { rule = [] } = await configuration.getRules()
    const ruleTypes = (supportedRules.ruleDescription ?? []).map(({ name }) => name)
    expect(rule.filter(({ type }) => ruleTypes.length > 0 && !ruleTypes.includes(type))).toEqual([])
    const { supportedAnalyticsModules } = await configuration.getSupportedAnalyticsModules()
    const { analyticsModule = [] } = await configuration.getAnalyticsModules()
    const moduleTypes = (supportedAnalyticsModules.analyticsModuleDescription ?? []).map(({ name }) => name)
    expect(analyticsModule.filter(({ type }) => !moduleTypes.includes(type))).toEqual([])
  })

  it('sends the rules back and reads the same', async (context) => {
    const { rule = [] } = await configuration.getRules()
    if (rule.length === 0) return context.skip('No rules')
    await configuration.modifyRules({ rule })
    expect((await configuration.getRules()).rule).toEqual(rule)
  })

  it('creates and deletes a copy of a rule', async (context) => {
    const { supportedRules } = await configuration.getSupportedRules()
    const { rule = [] } = await configuration.getRules()
    const copyable = rule.find(({ type }) => {
      const description = supportedRules.ruleDescription?.find(({ name }) => name === type)
      const instances = rule.filter((candidate) => candidate.type === type).length
      return description && description.fixed !== true && instances < (description.maxInstances ?? Infinity)
    })
    if (!copyable) return context.skip('No rule type allows another rule')
    await configuration.createRules({ rule: [{ ...copyable, name: 'onviftest' }] })
    try {
      const { rule: created = [] } = await configuration.getRules()
      expect(created.find(({ name }) => name === 'onviftest')).toEqual({ ...copyable, name: 'onviftest' })
    } finally {
      await configuration.deleteRules({ ruleName: ['onviftest'] })
    }
    expect((await configuration.getRules()).rule ?? []).toEqual(rule)
  })

  it('reads the rule options or reports them as not supported', async () => {
    let fault: SoapFaultError | undefined
    try {
      await configuration.getRuleOptions()
    } catch (error) {
      if (!(error instanceof SoapFaultError)) throw error
      fault = error
    }
    expect(fault?.subcodes ?? ['ActionNotSupported']).toContain('ActionNotSupported')
  })

  it('reports a rule that does not exist as a SOAP fault', async () => {
    await expect(configuration.deleteRules({ ruleName: ['missing'] })).rejects.toThrow(SoapFaultError)
  })
})
