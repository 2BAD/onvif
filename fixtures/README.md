# Fixtures

SOAP responses for the benchmark, the conformance and fuzz tests, and the mock camera.

## `live/<vendor>/<model>/`

Captured from real devices with `tools/fixtures/capture.ts`. It reads `ONVIF_TEST_HOST`, `ONVIF_TEST_USER` and `ONVIF_TEST_PASS` from `.env`. Files are named `<service>.<Action>.xml`, and `manifest.json` has the HTTP status and content type for each response.

```sh
pnpm fixtures:capture
```

It only calls read-only operations (plus one pull point subscription, which it unsubscribes again).

```sh
pnpm fixtures:capture --motion
```

Pulls events for up to five minutes and writes only `events.PullMessagesMotion.xml`, the first response in which a motion topic turns `true`, and `events.PullMessagesMotionEnd.xml`, the next one in which it turns `false`. Move in front of the camera while it runs, then leave its view. Motion detection has to be enabled on the device. The other captures and their manifest entries stay as they are.

```sh
pnpm fixtures:capture --only media2. --only media.GetVideoEncoderConfigurationOptions
```

Runs the full capture but writes only the responses whose `<service>.<Action>` name starts with one of the prefixes. The other captures and their manifest entries stay as they are.

```sh
pnpm fixtures:capture --set-encoder
```

Also sends the first video encoder configuration of Media v1 and Media2 back to the device unchanged, to capture `SetVideoEncoderConfiguration`. This is the only call that writes to the device.

Before writing anything it scrubs:

- serial number, hardware id, username and password -> `REDACTEDn`
- echoed WS-Security `Password` and `Nonce` values -> `REDACTED`
- unicast IPv4 addresses -> `192.0.2.0/24` (TEST-NET-1). Multicast addresses stay as they are
- MAC addresses -> locally administered `02:00:00:00:00:xx`
- UUIDs -> `00000000-0000-4000-8000-xxxxxxxxxxxx`
- credentials in URIs are stripped

Check the output before committing a new capture. The scrubbing is pattern based, so a new vendor can put identifiers somewhere the patterns don't catch.

## `snapshots/`

JPEG images served by the mock camera in the snapshot benchmark.

## `upstream/`

Responses from the [agsh/onvif](https://github.com/agsh/onvif) mock server (`test/serverMockup/`, branch `v0.x`, commit `4ac697bc`). MIT licensed, see `upstream/LICENSE`. The doT templates were rendered to static XML with fixed values: `192.0.2.1:80`, dates on 2026-01-01, and the conditional fault sections removed.
