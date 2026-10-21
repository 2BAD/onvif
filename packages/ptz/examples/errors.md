# Errors

A move the camera cannot do throws a `SoapFaultError`. Its `subcodes` say why, such as `['InvalidArgVal', 'SpaceNotSupported']`.

Some cameras answer `gotoHomePosition()` with success and do not move. Check `homeSupported` from `getNodes()` first.
