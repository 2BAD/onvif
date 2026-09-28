import { XMLParser } from 'fast-xml-parser'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  attributesGroupName: '$',
  textNodeName: '_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  htmlEntities: false
})

export const parseXml = (xml: string): Record<string, unknown> => parser.parse(xml) as Record<string, unknown>
