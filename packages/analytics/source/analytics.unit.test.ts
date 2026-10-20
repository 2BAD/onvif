import { OnvifError, SoapFaultError } from '@2bad/onvif'
import { decode, parseEnvelope } from '@2bad/onvif/soap'
import { describe, expect, it } from 'vitest'
import { capturesOf, decodeCapture, operationsOf } from '../../../tools/fixtures/corpus.ts'
import {
  answer,
  cam,
  connectMock,
  dahua,
  hik,
  rawRequestOf,
  rejection,
  requestOf,
  simulator
} from '../../../tools/mock-camera/harness.ts'
import { type ActionOverride, type MockCameraOptions } from '../../../tools/mock-camera/server.ts'
import { Analytics, analytics } from '#index.ts'

const emptyResponse = (action: string): ActionOverride =>
  answer(cam('analytics.ModifyRules').replaceAll('ModifyRulesResponse', `${action}Response`))

const writes: Record<string, ActionOverride> = {
  'analytics.CreateRules': emptyResponse('CreateRules'),
  'analytics.DeleteRules': emptyResponse('DeleteRules'),
  'analytics.CreateAnalyticsModules': emptyResponse('CreateAnalyticsModules'),
  'analytics.DeleteAnalyticsModules': emptyResponse('DeleteAnalyticsModules'),
  'analytics.GetAnalyticsModuleOptions': answer(simulator('analytics.GetAnalyticsModuleOptions')),
  'analytics.GetSupportedMetadata': answer(dahua('analytics.GetSupportedMetadata'))
}

const connect = async (options?: MockCameraOptions) => {
  const { mock, device } = await connectMock(options)
  return { mock, device: device.use(analytics) }
}

// the request as the device reads it, with every QName resolved against the declarations in the request
const decodedRequestOf = (
  mock: Awaited<ReturnType<typeof connect>>['mock'],
  operation: (typeof operations)[number]
): unknown => {
  const { body } = parseEnvelope(rawRequestOf(mock, operation.name), {}, undefined, { namespaces: true })
  return decode(operation.schema, operation.request.type, body[operation.request.name] ?? '')
}

const configurationToken = 'VideoAnalytics0'

const operations = operationsOf(Analytics)

const methodName = (name: string): string => `${name.charAt(0).toLowerCase()}${name.slice(1)}`

describe('generated analytics operations', () => {
  const fixtures = capturesOf('analytics', operations)

  it('cover a capture for every operation', () => {
    const captured = new Set(fixtures.map(({ operation }) => operation.name))
    const withoutSecondModule = ['CreateAnalyticsModules', 'DeleteAnalyticsModules']
    expect(
      operations.map(({ name }) => name).filter((name) => !captured.has(name) && !withoutSecondModule.includes(name))
    ).toEqual([])
  })

  it('cover a camera capture for every read', () => {
    const captured = new Set(
      fixtures.filter(({ name }) => name.startsWith('live/')).map(({ operation }) => operation.name)
    )
    const reads = operations.map(({ name }) => name).filter((name) => name.startsWith('Get'))
    expect(reads.filter((name) => !captured.has(name))).toEqual(['GetAnalyticsModuleOptions'])
  })

  it('parse every response with a QName with namespaces', () => {
    const withoutQNames = ['GetServiceCapabilities', 'CreateAnalyticsModules', 'ModifyAnalyticsModules']
    const plain = ['DeleteAnalyticsModules', 'CreateRules', 'ModifyRules', 'DeleteRules', ...withoutQNames]
    expect(operations.filter((operation) => operation.namespaces !== true).map(({ name }) => name)).toEqual(
      operations.map(({ name }) => name).filter((name) => plain.includes(name))
    )
  })

  it.each(fixtures.map((entry) => [entry.name, entry] as const))('decode %s', (_name, capture) => {
    expect(() => decodeCapture(capture)).not.toThrow()
  })
})

describe('analytics', () => {
  it('adds a method for every operation as device.analytics', async () => {
    const { device } = await connect()
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(device.analytics))
    expect(methods.filter((name) => name !== 'constructor').toSorted()).toEqual(
      [...operations.map(({ name }) => methodName(name)), 'forConfiguration'].toSorted()
    )
    expect(Object.getOwnPropertyDescriptor(device, 'analytics')).toMatchObject({ writable: false, enumerable: true })
  })

  it('adds every operation with a configuration token to forConfiguration()', async () => {
    const { device } = await connect()
    const methods = Object.getOwnPropertyNames(
      Object.getPrototypeOf(device.analytics.forConfiguration(configurationToken))
    )
    const withoutToken = ['GetServiceCapabilities', 'GetSupportedMetadata']
    expect(methods.filter((name) => name !== 'constructor').toSorted()).toEqual(
      operations
        .filter(({ name }) => !withoutToken.includes(name))
        .map(({ name }) => methodName(name))
        .toSorted()
    )
  })

  it('sends the same request through forConfiguration() as with the configuration token', async () => {
    const { mock, device } = await connect({ overrides: writes })
    const configuration = device.analytics.forConfiguration(configurationToken)
    const module = { name: 'Module', type: 'tt:CellMotionEngine', parameters: {} }
    const calls = [
      ['GetSupportedAnalyticsModules', {}],
      ['GetAnalyticsModules', {}],
      ['CreateAnalyticsModules', { analyticsModule: [module] }],
      ['ModifyAnalyticsModules', { analyticsModule: [module] }],
      ['DeleteAnalyticsModules', { analyticsModuleName: ['Module'] }],
      ['GetAnalyticsModuleOptions', { type: 'tt:CellMotionEngine' }],
      ['GetSupportedRules', {}],
      ['GetRules', {}],
      ['CreateRules', { rule: [module] }],
      ['ModifyRules', { rule: [module] }],
      ['DeleteRules', { ruleName: ['Module'] }],
      ['GetRuleOptions', { ruleType: 'tt:CellMotionDetector' }]
    ] as const
    for (const [action, request] of calls) {
      const name = methodName(action) as keyof typeof configuration
      const direct = device.analytics[name] as (request: object) => Promise<unknown>
      const scoped = configuration[name] as (request: object) => Promise<unknown>
      expect(await direct.call(device.analytics, { ...request, configurationToken })).toEqual(
        await scoped.call(configuration, request)
      )
      const [byToken, byScope] = mock.requests.filter((entry) => entry.action === action)
      expect(parseEnvelope(byScope?.body ?? '').body).toEqual(parseEnvelope(byToken?.body ?? '').body)
      expect(requestOf(mock, action)[action]).toMatchObject({ ConfigurationToken: configurationToken })
    }
  })

  it('sends every request to the analytics service', async () => {
    const { mock, device } = await connect({ overrides: writes })
    await device.analytics.getServiceCapabilities()
    await device.analytics.getSupportedMetadata()
    await device.analytics.forConfiguration(configurationToken).getRules()
    expect(
      mock.requests.filter(({ service }) => service === 'analytics').map(({ action, path }) => [action, path])
    ).toEqual([
      ['GetServiceCapabilities', '/onvif/Analytics'],
      ['GetSupportedMetadata', '/onvif/Analytics'],
      ['GetRules', '/onvif/Analytics']
    ])
  })

  it('reports a device without an analytics service before sending anything', async () => {
    const services = cam('device.GetServices').replace(
      /<tds:Service>(?:(?!<\/tds:Service>)[\s\S])*?ver20\/analytics\/wsdl[\s\S]*?<\/tds:Service>/,
      ''
    )
    const { mock, device } = await connect({ overrides: { 'device.GetServices': answer(services) } })
    const error = await rejection(() => device.analytics.getRules({ configurationToken }))
    expect(error).toBeInstanceOf(OnvifError)
    expect(error).toMatchObject({ service: 'tan', action: 'GetRules' })
    expect(mock.requests.some(({ action }) => action === 'GetRules')).toBe(false)
  })
})

describe('analytics requests', () => {
  it('sends an analytics module back with its cell layout as it was read', async () => {
    const { mock, device } = await connect()
    const configuration = device.analytics.forConfiguration(configurationToken)
    const { analyticsModule = [] } = await configuration.getAnalyticsModules()
    await configuration.modifyAnalyticsModules({ analyticsModule })
    expect(decodedRequestOf(mock, Analytics.ModifyAnalyticsModules)).toEqual({ configurationToken, analyticsModule })
    const raw = rawRequestOf(mock, 'ModifyAnalyticsModules')
    expect(raw).toContain(
      '<tt:ElementItem Name="Layout"><tt:CellLayout Columns="22" Rows="18"><tt:Transformation>' +
        '<tt:Translate x="-1" y="-1"/><tt:Scale x="0.001042" y="0.001852"/></tt:Transformation></tt:CellLayout>'
    )
    expect(raw).toContain('Type="tt:CellMotionEngine"')
    expect(raw).toContain('xmlns:tt="http://www.onvif.org/ver10/schema"')
  })

  it('sends rules copied as JSON the same as the rules it read', async () => {
    const { mock, device } = await connect({ overrides: writes })
    const configuration = device.analytics.forConfiguration(configurationToken)
    const { rule = [] } = await configuration.getRules()
    const bodyOf = () => /<s:Body>[\s\S]*<\/s:Body>/.exec(rawRequestOf(mock, 'ModifyRules'))?.[0]
    await configuration.modifyRules({ rule })
    const read = bodyOf()
    await configuration.modifyRules({ rule: JSON.parse(JSON.stringify(rule)) as typeof rule })
    expect(read).toContain('<tan:Rule Name="MotionDetectorRule0" Type="tt:CellMotionDetector">')
    expect(bodyOf()).toBe(read)
  })

  it('writes a line detector with its segments and a field detector with its field', async () => {
    const { mock, device } = await connect({ overrides: writes })
    await device.analytics.createRules({
      configurationToken,
      rule: [
        {
          name: 'Gate',
          type: 'tt:LineDetector',
          parameters: {
            simpleItem: [{ name: 'Direction', value: 'Any' }],
            elementItem: [
              {
                name: 'Segments',
                polyline: {
                  point: [
                    { x: -0.5, y: 0 },
                    { x: 0.5, y: 0 }
                  ]
                }
              }
            ]
          }
        },
        {
          name: 'Yard',
          type: 'tt:FieldDetector',
          parameters: {
            elementItem: [
              {
                name: 'Field',
                polygon: {
                  point: [
                    { x: -1, y: -1 },
                    { x: 1, y: -1 },
                    { x: 0, y: 1 }
                  ]
                }
              }
            ]
          }
        }
      ]
    })
    const raw = rawRequestOf(mock, 'CreateRules')
    expect(raw).toContain(
      '<tan:Rule Name="Gate" Type="tt:LineDetector"><tt:Parameters><tt:SimpleItem Name="Direction" Value="Any"/>' +
        '<tt:ElementItem Name="Segments"><tt:Polyline><tt:Point x="-0.5" y="0"/><tt:Point x="0.5" y="0"/>' +
        '</tt:Polyline></tt:ElementItem></tt:Parameters></tan:Rule>'
    )
    expect(raw).toContain(
      '<tt:ElementItem Name="Field"><tt:Polygon><tt:Point x="-1" y="-1"/><tt:Point x="1" y="-1"/>' +
        '<tt:Point x="0" y="1"/></tt:Polygon></tt:ElementItem>'
    )
  })

  it('writes a motion region detector in the analytics rules namespace', async () => {
    const { mock, device } = await connect({ overrides: writes })
    const motionRegionConfig = {
      polygon: {
        point: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 }
        ]
      },
      armed: true,
      sensitivity: 50
    }
    const rule = {
      name: 'Door',
      type: 'axt:MotionRegionDetector',
      parameters: { elementItem: [{ name: 'MotionRegion', motionRegionConfig }] }
    }
    await device.analytics.createRules({ configurationToken, rule: [rule] })
    const raw = rawRequestOf(mock, 'CreateRules')
    expect(raw).toContain('xmlns:axt="http://www.onvif.org/ver20/analytics"')
    expect(raw).toContain('Type="axt:MotionRegionDetector"')
    expect(raw).toContain('<axt:MotionRegionConfig Armed="true" Sensitivity="50"><tt:Polygon>')
    expect(decodedRequestOf(mock, Analytics.CreateRules)).toEqual({ configurationToken, rule: [rule] })
  })

  it('declares the namespace of a rule type in a namespace without a standard prefix', async () => {
    const { mock, device } = await connect({ overrides: writes })
    const rule = { name: 'Zone', type: '{urn:example:vendor}Intrusion', parameters: {} }
    await device.analytics.createRules({ configurationToken, rule: [rule] })
    const raw = rawRequestOf(mock, 'CreateRules')
    const prefix = /Type="(\w+):Intrusion"/.exec(raw)?.[1] ?? ''
    expect(raw).toContain(`xmlns:${prefix}="urn:example:vendor"`)
    expect(decodedRequestOf(mock, Analytics.CreateRules)).toEqual({ configurationToken, rule: [rule] })
  })

  it('rejects a rule type with an unknown prefix before sending anything', async () => {
    const { mock, device } = await connect({ overrides: writes })
    const rule = { name: 'Zone', type: 'vendor:Intrusion', parameters: {} }
    await expect(device.analytics.createRules({ configurationToken, rule: [rule] })).rejects.toThrow(
      'Unknown prefix vendor in the QName at CreateRules.rule[0].type'
    )
    expect(mock.requests.some(({ action }) => action === 'CreateRules')).toBe(false)
  })

  it('reads the device prefix of a rule type as the standard prefix', async () => {
    const rules = hik('analytics.GetRules')
      .replace('<tan:GetRulesResponse>', '<tan:GetRulesResponse xmlns:ns9="http://www.onvif.org/ver10/schema">')
      .replace('Type="tt:CellMotionDetector"', 'Type="ns9:CellMotionDetector"')
    const { device } = await connect({ overrides: { 'analytics.GetRules': answer(rules) } })
    const { rule = [] } = await device.analytics.getRules({ configurationToken })
    expect(rule.map(({ type }) => type)).toEqual(['tt:CellMotionDetector'])
  })
})

describe('analytics failure modes of other clients', () => {
  it('sends an element item it cannot write back as an error instead of an empty item', async () => {
    const rules = hik('analytics.GetRules').replace(
      '</tt:Parameters>',
      '<tt:ElementItem Name="Zone"><v:Area xmlns:v="urn:example:vendor"><v:Corner>1</v:Corner></v:Area>' +
        '</tt:ElementItem></tt:Parameters>'
    )
    const { mock, device } = await connect({ overrides: { ...writes, 'analytics.GetRules': answer(rules) } })
    const { rule = [] } = await device.analytics.getRules({ configurationToken })
    expect(JSON.parse(JSON.stringify(rule[0]?.parameters.elementItem))).toEqual([
      { name: 'Zone', $any: { Area: { Corner: { _: '1' } } } }
    ])
    await expect(device.analytics.modifyRules({ configurationToken, rule })).rejects.toThrow(
      'Expected one of cellLayout, polygon, polyline, motionRegionConfig at ModifyRules.rule[0].parameters.elementItem[0]'
    )
    expect(mock.requests.some(({ action }) => action === 'ModifyRules')).toBe(false)
  })

  it('keeps parameter values as the strings the device sent', async () => {
    const rules = hik('analytics.GetRules')
      .replace('Value="5"', 'Value="0"')
      .replace('Value="1000"', 'Value="0.50"')
      .replace('Value="1000"', 'Value="false"')
      .replace('Value="0P8A8A=="', 'Value="01"')
    const { mock, device } = await connect({ overrides: { ...writes, 'analytics.GetRules': answer(rules) } })
    const { rule = [] } = await device.analytics.getRules({ configurationToken })
    expect(rule[0]?.parameters.simpleItem?.map(({ value }) => value)).toEqual(['0', '0.50', 'false', '01'])
    await device.analytics.modifyRules({ configurationToken, rule })
    expect(rawRequestOf(mock, 'ModifyRules')).toContain(
      '<tt:SimpleItem Name="MinCount" Value="0"/><tt:SimpleItem Name="AlarmOnDelay" Value="0.50"/>' +
        '<tt:SimpleItem Name="AlarmOffDelay" Value="false"/><tt:SimpleItem Name="ActiveCells" Value="01"/>'
    )
  })

  it('reads one rule, one item and one message group as arrays', async () => {
    const { device } = await connect({
      overrides: {
        'analytics.GetRules': answer(
          hik('analytics.GetRules').replace(/<tt:SimpleItem Name="Alarm[\s\S]*?Value="0P8A8A=="\/>\s*/, '')
        ),
        'analytics.GetSupportedRules': answer(hik('analytics.GetSupportedRules'))
      }
    })
    const configuration = device.analytics.forConfiguration(configurationToken)
    const { rule } = await configuration.getRules()
    expect(rule).toEqual([
      {
        name: 'MyMotionDetectorRule',
        type: 'tt:CellMotionDetector',
        parameters: { simpleItem: [{ name: 'MinCount', value: '5' }] }
      }
    ])
    const { supportedRules } = await configuration.getSupportedRules()
    const [messages] = supportedRules.ruleDescription?.[0]?.messages ?? []
    expect(messages?.data).toEqual({ simpleItemDescription: [{ name: 'IsMotion', type: 'xs:boolean' }] })
    expect(messages?.key).toBeUndefined()
  })

  it('reads the typed content of rule options without coercing it', async () => {
    const { device } = await connect({
      overrides: { 'analytics.GetRuleOptions': answer(simulator('analytics.GetRuleOptions')) }
    })
    const { ruleOptions = [] } = await device.analytics.getRuleOptions({ configurationToken })
    expect(ruleOptions.find(({ name }) => name === 'Mode')?.stringItems?.item).toEqual([
      'GlobalSceneChange',
      'ImageTooDark',
      'ImageTooBright',
      'SignalLoss',
      'ImageTooBlurry'
    ])
    expect(ruleOptions.find(({ name }) => name === 'Duration')?.durationRange).toEqual({ min: 'PT1S', max: 'PT1M' })
    expect(ruleOptions.find(({ name }) => name === 'MotionRegion')).toMatchObject({
      type: 'axt:MotionRegionConfigOptions',
      motionRegionConfigOptions: { polygonSupport: true, polygonLimits: { min: 1, max: 20 } }
    })
  })

  it('reads supported metadata without analytics modules as no array', async () => {
    const empty = dahua('analytics.GetSupportedMetadata').replace(
      /<tan:GetSupportedMetadataResponse>[\s\S]*<\/tan:GetSupportedMetadataResponse>/,
      '<tan:GetSupportedMetadataResponse/>'
    )
    const { device } = await connect({ overrides: { 'analytics.GetSupportedMetadata': answer(empty) } })
    expect(await device.analytics.getSupportedMetadata()).toEqual({})
  })
})

describe('analytics on the DCN-BM2220LPR', () => {
  it('reads nil supported rules as no rule descriptions', async () => {
    const { device } = await connect()
    expect(await device.analytics.getSupportedRules({ configurationToken })).toEqual({ supportedRules: {} })
  })

  it('reads a cell layout described as a simple item, with the xsd prefix as xs', async () => {
    const { device } = await connect()
    const { supportedAnalyticsModules } = await device.analytics.getSupportedAnalyticsModules({ configurationToken })
    expect(supportedAnalyticsModules.analyticsModuleDescription).toEqual([
      {
        name: 'tt:CellMotionEngine',
        parameters: {
          simpleItemDescription: [
            { name: 'Sensitivity', type: 'xs:integer' },
            { name: 'Layout', type: 'tt:CellLayout' }
          ]
        }
      }
    ])
  })

  it('reads the cell layout of the motion module as numbers', async () => {
    const { device } = await connect()
    const { analyticsModule } = await device.analytics.getAnalyticsModules({ configurationToken })
    expect(analyticsModule?.[0]?.parameters.elementItem).toEqual([
      {
        name: 'Layout',
        cellLayout: {
          columns: 22,
          rows: 18,
          transformation: { translate: { x: -1, y: -1 }, scale: { x: 0.001042, y: 0.001852 } }
        }
      }
    ])
  })

  it('reads the service capabilities without rule support', async () => {
    const { device } = await connect()
    expect(await device.analytics.getServiceCapabilities()).toEqual({
      capabilities: { ruleSupport: false, analyticsModuleSupport: true, cellBasedSceneDescriptionSupported: false }
    })
  })

  it('reports an operation it does not implement as a SOAP fault', async () => {
    const { device } = await connect()
    const error = await rejection(() => device.analytics.getSupportedMetadata())
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ service: 'tan', action: 'GetSupportedMetadata' })
  })
})

describe('analytics on the Hikvision DS-2DE2C400IG-W-W', () => {
  it('reports rule options as not supported although its capabilities list them', async () => {
    const { device } = await connect({
      overrides: {
        'analytics.GetServiceCapabilities': answer(hik('analytics.GetServiceCapabilities')),
        'analytics.GetRuleOptions': answer(hik('analytics.GetRuleOptions'), 500)
      }
    })
    const { capabilities } = await device.analytics.getServiceCapabilities()
    expect(capabilities.ruleOptionsSupported).toBe(true)
    const error = await rejection(() => device.analytics.getRuleOptions({ configurationToken }))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: ['ActionNotSupported', 'InvalidOperation'], action: 'GetRuleOptions' })
  })

  it('reports a configuration that does not exist as a SOAP fault with its subcodes', async () => {
    const { device } = await connect({
      overrides: { 'analytics.GetRules': answer(hik('analytics.GetRulesMissingFault'), 500) }
    })
    const error = await rejection(() => device.analytics.getRules({ configurationToken: 'missing' }))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: ['InvalidArgs', 'NoConfig'], service: 'tan', action: 'GetRules' })
  })
})

describe('analytics on the HappyTime server', () => {
  it('reports a rule that does not exist as a SOAP fault with its subcodes', async () => {
    const { device } = await connect({
      overrides: { 'analytics.DeleteRules': answer(simulator('analytics.DeleteRulesMissingFault'), 400) }
    })
    const error = await rejection(() => device.analytics.deleteRules({ configurationToken, ruleName: ['missing'] }))
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes: ['InvalidArgVal', 'RuleNotExistent'], action: 'DeleteRules' })
  })

  it('reads an option type it has no schema for under $any', async () => {
    const { device } = await connect({
      overrides: { 'analytics.GetRuleOptions': answer(simulator('analytics.GetRuleOptions')) }
    })
    const { ruleOptions = [] } = await device.analytics.getRuleOptions({ configurationToken })
    expect(JSON.parse(JSON.stringify(ruleOptions[0]))).toEqual({
      ruleType: 'tt:CellMotionDetector',
      name: 'MinCount',
      type: 'tt:IntegerRange',
      $any: { IntegerRange: { Min: { _: '1' }, Max: { _: '100' } } }
    })
  })
})

describe('analytics on the Dahua DHI-ITC413-PW4D-Z1', () => {
  it.each([
    ['GetRuleOptions', 'analytics.GetRuleOptions', ['ActionNotSupported', 'NotImplemented']],
    ['GetRules', 'analytics.GetRulesMissingFault', ['InvalidArgVal', 'NoConfig']],
    ['ModifyRules', 'analytics.ModifyRulesRuleNotExistentFault', ['InvalidArgVal', 'RuleNotExistent']]
  ] as const)('reports a %s fault sent with HTTP 200 as a SOAP fault', async (action, name, subcodes) => {
    const { device } = await connect({ overrides: { [`analytics.${action}`]: answer(dahua(name)) } })
    const configuration = device.analytics.forConfiguration('missing')
    const calls = {
      GetRuleOptions: () => configuration.getRuleOptions(),
      GetRules: () => configuration.getRules(),
      // the rule the camera reports from GetRules
      ModifyRules: () =>
        configuration.modifyRules({ rule: [{ name: 'Region', type: 'tt:CellMotionDetector', parameters: {} }] })
    }
    const call = calls[action]
    const error = await rejection(call)
    expect(error).toBeInstanceOf(SoapFaultError)
    expect(error).toMatchObject({ subcodes, service: 'tan', action })
  })

  it('reads the sample frames of the supported metadata with times without a zone as UTC', async () => {
    const { device } = await connect({
      overrides: { 'analytics.GetSupportedMetadata': answer(dahua('analytics.GetSupportedMetadata')) }
    })
    const { analyticsModule = [] } = await device.analytics.getSupportedMetadata()
    expect(analyticsModule.map(({ type }) => type)).toEqual([
      'tt:CellMotionEngine',
      'tt:VehicleInfo',
      'tt:LicensePlateRecognition'
    ])
    expect(analyticsModule[0]?.sampleFrame.utcTime).toEqual(new Date('2008-10-10T12:24:57.721Z'))
  })

  it('reads a license plate region described as a polygon', async () => {
    const { device } = await connect({
      overrides: {
        'analytics.GetSupportedAnalyticsModules': answer(dahua('analytics.GetSupportedAnalyticsModules'))
      }
    })
    const { supportedAnalyticsModules } = await device.analytics.getSupportedAnalyticsModules({ configurationToken })
    expect(supportedAnalyticsModules.analyticsModuleDescription?.[2]?.parameters.elementItemDescription).toEqual([
      { name: 'Region', type: 'tt:Polygon' }
    ])
  })
})

describe('analytics responses the schema does not allow', () => {
  it('rejects a rule type with a prefix the device did not declare', async () => {
    const rules = hik('analytics.GetRules').replace('Type="tt:CellMotionDetector"', 'Type="hik:CellMotionDetector"')
    const { device } = await connect({ overrides: { 'analytics.GetRules': answer(rules) } })
    await expect(device.analytics.getRules({ configurationToken })).rejects.toThrow(
      "Undeclared prefix in QName 'hik:CellMotionDetector' at GetRulesResponse.Rule[0].Type"
    )
  })

  it('rejects a cell layout without its transformation', async () => {
    const modules = cam('analytics.GetAnalyticsModules').replace(/<tt:Transformation>[\s\S]*<\/tt:Transformation>/, '')
    const { device } = await connect({ overrides: { 'analytics.GetAnalyticsModules': answer(modules) } })
    await expect(device.analytics.getAnalyticsModules({ configurationToken })).rejects.toThrow(
      'Missing required element Transformation at GetAnalyticsModulesResponse.AnalyticsModule[0].Parameters.ElementItem[0].CellLayout'
    )
  })
})
