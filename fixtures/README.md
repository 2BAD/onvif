# Fixtures

SOAP responses for the benchmark, the conformance and fuzz tests, and the mock camera.

## `live/<vendor>/<model>/`

Captured from real devices with `tools/fixtures/capture.ts`. It reads `ONVIF_TEST_HOST`, `ONVIF_TEST_USER` and `ONVIF_TEST_PASS` from `.env`. Files are named `<service>.<Action>.xml`, and `manifest.json` has the HTTP status and content type for each response.

```sh
pnpm fixtures:capture
```

It only calls read-only operations (plus one pull point subscription, which it unsubscribes again). Before writing anything it scrubs:

* serial number, hardware id, username and password -> `REDACTEDn`
* echoed WS-Security `Password` and `Nonce` values -> `REDACTED`
* unicast IPv4 addresses -> `192.0.2.0/24` (TEST-NET-1). Multicast addresses stay as they are
* MAC addresses -> locally administered `02:00:00:00:00:xx`
* UUIDs -> `00000000-0000-4000-8000-xxxxxxxxxxxx`
* credentials in URIs are stripped

Check the output before committing a new capture. The scrubbing is pattern based, so a new vendor can put identifiers somewhere the patterns don't catch.

## `upstream/`

Responses from the [agsh/onvif](https://github.com/agsh/onvif) mock server (`test/serverMockup/`, branch `v0.x`, commit `4ac697bc`). MIT licensed, see `upstream/LICENSE`. The doT templates were rendered to static XML with fixed values: `192.0.2.1:80`, dates on 2026-01-01, and the conditional fault sections removed.
