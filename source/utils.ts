import xml2js from 'xml2js'

const numberRE = /^-?([1-9]\d*|0)(\.\d*)?$/
const dateRE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(.\d+)?Z$/
const prefixMatch = /(?!xmlns)^.*:/

type LineRaseOptions = {
  array: string[]
  name?: string
}

/**
 * Parse SOAP object to a pretty JS-object
 *
 * @param xml - The XML object to parse
 * @param options - Options for parsing
 * @returns The parsed JS object
 */
export function linerase(xml: unknown, options: LineRaseOptions = { array: [] }): unknown {
  if (Array.isArray(xml)) {
    if (xml.length === 1 && !options.array.includes(options.name ?? '')) {
      return linerase(xml[0], options)
    }
    return xml.map((item) => linerase(item, options))
  }

  if (typeof xml === 'object' && xml !== null) {
    const obj: Record<string, unknown> = {}
    Object.entries(xml).forEach(([key, value]) => {
      if (key === '$') {
        // for xml attributes
        Object.assign(obj, linerase(value, options))
      } else {
        obj[key] = linerase(value, { ...options, name: key })
      }
    })
    return obj
  }

  if (xml === 'true') {
    return true
  }
  if (xml === 'false') {
    return false
  }
  if (typeof xml === 'string') {
    if (numberRE.test(xml)) {
      return Number.parseFloat(xml)
    }
    if (dateRE.test(xml)) {
      return new Date(xml)
    }
  }
  return xml
}

/**
 * Generate a random hexadecimal string
 *
 * @returns A 4-character hexadecimal string
 */
function s4(): string {
  return Math.floor((1 + Math.random()) * 0x10000)
    .toString(16)
    .substring(1)
}

/**
 * Generate a GUID (Globally Unique Identifier)
 *
 * @returns A GUID string
 */
export function guid(): string {
  return `${s4() + s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`
}

export type CamResponse = Promise<[Record<string, unknown>, string]>

/**
 * Parse SOAP response
 *
 * @param rawXml - The raw XML string to parse
 * @returns A promise that resolves to a tuple containing the parsed body and the filtered XML string
 * @throws {Error} If the SOAP response is invalid or contains a fault
 */
export async function parseSOAPString(rawXml: string): CamResponse {
  // Filter out XML namespaces
  const xml = rawXml.replace(/xmlns([^=]*?)=(".*?")/g, '')

  const result = await xml2js.parseStringPromise(xml, {
    tagNameProcessors: [
      (tag: string) => {
        const str = tag.replace(prefixMatch, '')
        const secondLetter = str.charAt(1)
        if (secondLetter && secondLetter.toUpperCase() !== secondLetter) {
          return str.charAt(0).toLowerCase() + str.slice(1)
        }
        return str
      }
    ]
  })

  if (!result?.envelope?.body) {
    throw new Error('Invalid ONVIF SOAP response')
  }

  const body = result.envelope.body[0]

  if (body.fault) {
    const fault = body.fault[0]
    let reason = ''
    let detail = ''

    try {
      reason = fault.reason[0].text[0]._ || JSON.stringify(linerase(fault.code[0]))
    } catch (e) {
      // Ignore error if reason extraction fails
    }

    try {
      ;[detail] = fault.detail[0].text
    } catch (e) {
      // Ignore error if detail extraction fails
    }

    throw new Error(`ONVIF SOAP Fault: ${reason}${detail}`)
  }

  return [body, xml]
}
