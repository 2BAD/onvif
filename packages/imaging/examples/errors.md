# Errors

A video source that does not exist throws a `SoapFaultError` with the subcodes `['InvalidArgVal', 'NoSource']`.

Some cameras without presets throw a `SoapFaultError` from `getPresets()`. Its `subcodes` start with `ActionNotSupported`.
