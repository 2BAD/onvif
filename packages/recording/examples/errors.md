# Errors

A recording that does not exist throws a `SoapFaultError` with the subcodes `['InvalidArgVal', 'NoRecording']`.

A camera without a memory card can throw a `SoapFaultError` from `getRecordingInformation()` and `getMediaAttributes()`.
