export const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'

export const prefixes: Readonly<Record<string, string>> = {
  'http://www.onvif.org/ver10/schema': 'tt',
  'http://www.onvif.org/ver10/device/wsdl': 'tds',
  'http://www.onvif.org/ver10/media/wsdl': 'trt',
  'http://www.onvif.org/ver20/media/wsdl': 'tr2',
  'http://www.onvif.org/ver10/events/wsdl': 'tev',
  'http://www.onvif.org/ver20/ptz/wsdl': 'tptz',
  'http://www.onvif.org/ver20/imaging/wsdl': 'timg',
  'http://www.onvif.org/ver20/analytics/wsdl': 'tan',
  'http://www.onvif.org/ver10/deviceIO/wsdl': 'tmd',
  'http://www.onvif.org/ver10/recording/wsdl': 'trc',
  'http://www.onvif.org/ver10/search/wsdl': 'tse',
  'http://www.onvif.org/ver10/replay/wsdl': 'trp',
  'http://www.onvif.org/ver10/receiver/wsdl': 'trv',
  'http://docs.oasis-open.org/wsn/b-2': 'wsnt',
  'http://docs.oasis-open.org/wsn/t-1': 'wstop',
  'http://docs.oasis-open.org/wsrf/bf-2': 'wsrfbf',
  'http://www.w3.org/2005/08/addressing': 'wsa',
  'http://www.w3.org/2005/05/xmlmime': 'xmime',
  'http://www.w3.org/2004/08/xop/include': 'xop',
  'http://www.w3.org/2003/05/soap-envelope': 's',
  [XML_NAMESPACE]: 'xml'
}
