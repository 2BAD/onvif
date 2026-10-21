# Errors

A configuration that does not exist throws a `SoapFaultError` with the subcodes `['InvalidArgs', 'NoConfig']` or `['InvalidArgVal', 'NoConfig']`.

Many cameras do not implement `getRuleOptions()`, `getAnalyticsModuleOptions()` or `getSupportedMetadata()`. They throw a `SoapFaultError`, often with `ActionNotSupported` as the first subcode.
