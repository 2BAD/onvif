# Errors

A token that does not exist throws a `SoapFaultError`, such as with the subcodes `['InvalidArgVal', 'RelayToken']`.

Cameras without a kind of IO throw a `SoapFaultError` from its calls. Its `subcodes` often start with `ActionNotSupported` or `InvalidArgVal`.
