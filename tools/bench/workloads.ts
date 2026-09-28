import { corpus, fixture } from '#tools/fixtures/corpus.ts'

const live = 'live/dvc/dcn-bm2220lpr'

const repeatElement = (xml: string, open: RegExp, close: string, times: number): string => {
  const start = xml.search(open)
  const end = xml.lastIndexOf(close) + close.length
  if (start === -1 || end < close.length) throw new Error(`Element ${open} not found`)
  const block = xml.slice(start, end)
  const copies = Array.from({ length: times }, (_, index) =>
    block.replaceAll(/token="([^"]+)"/g, `token="$1-${index}"`)
  )
  return xml.slice(0, start) + copies.join('') + xml.slice(end)
}

export const workloads = {
  small: fixture(`${live}/device.GetSystemDateAndTime.xml`).xml,
  medium: fixture(`${live}/device.GetServices.xml`).xml,
  large: fixture(`${live}/media.GetProfiles.xml`).xml,
  nvrProfiles: repeatElement(fixture(`${live}/media.GetProfiles.xml`).xml, /<trt:Profiles /, '</trt:Profiles>', 32),
  eventBatch: repeatElement(
    fixture(`${live}/events.PullMessages.xml`).xml,
    /<wsnt:NotificationMessage>/,
    '</wsnt:NotificationMessage>',
    30
  )
}

export const successCorpus = corpus.filter((entry) => entry.status === 200 && !/Fault|Error/.test(entry.name))
