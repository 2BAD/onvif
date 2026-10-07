# Fixtures

SOAP responses for the benchmark, the conformance and fuzz tests, and the mock camera.

## `live/<vendor>/<model>/`

Captured from real devices with `tools/fixtures/capture.ts`. It reads `ONVIF_TEST_HOST`, `ONVIF_TEST_USER` and `ONVIF_TEST_PASS` from `.env`. It signs requests with WS-Security and answers an HTTP Digest challenge. Files are named `<service>.<Action>.xml`, and `manifest.json` has the HTTP status and content type for each response.

```sh
pnpm fixtures:capture
```

It only calls read-only operations (plus one pull point subscription, which it unsubscribes again). It also sends two WS-Discovery probes to the camera. The replies go to `discovery.ProbeMatches.xml` and `discovery.ProbeMatchesDevice.xml`.

```sh
pnpm fixtures:capture --motion
```

Pulls events for up to five minutes and writes only `events.PullMessagesMotion.xml`, the first response in which a motion topic turns `true`, and `events.PullMessagesMotionEnd.xml`, the next one in which it turns `false`. Move in front of the camera while it runs, then leave its view. Motion detection has to be enabled on the device. The other captures and their manifest entries stay as they are.

```sh
pnpm fixtures:capture --only media2. --only media.GetVideoEncoderConfigurationOptions
```

Writes only the responses whose `<service>.<Action>` name starts with one of the prefixes.

```sh
pnpm fixtures:capture --set-encoder
```

Also captures `SetVideoEncoderConfiguration`. It sends the first encoder configuration of Media v1 and Media2 back to the device unchanged.

It skips the Media v1 call when Media2 reports an encoding that Media v1 cannot carry, such as H265. Sending that configuration back through Media v1 would switch the encoder to H264.

```sh
pnpm fixtures:capture --management
```

Writes only the device management responses: gateway, users, NTP, dynamic DNS, zero configuration, IP filter and relays. It sends Get calls only and creates no subscription.

```sh
pnpm fixtures:capture --management --set-device
```

Also captures the device management Set calls. Use it on the lab camera only. It sends the network interface, gateway, NTP, dynamic DNS, zero configuration, IP filter and relay settings back as read. Dynamic DNS that reads as nil is sent as `NoUpdate`. On a `Deny` filter it adds and removes `198.51.100.7`. It switches the first relay on and off. It creates the user `onviftest`, changes its password and deletes it.

No other call writes to the device.

```sh
pnpm fixtures:capture --management --stdout > captures.jsonl
pnpm fixtures:import fixtures/live/<vendor>/<model> < captures.jsonl
```

`--stdout` prints the scrubbed responses as JSON lines and writes nothing. Use it on a machine that reaches the device but should not keep files. `fixtures:import` writes the lines into an existing fixture directory and its manifest.

Before writing anything it scrubs:

- serial number, hardware id, username and password -> `REDACTEDn`
- user names in `Username` elements -> `REDACTEDn`
- NTP and dynamic DNS host names -> `hostn.example`
- hostname and the values of `name` and `location` scopes -> `REDACTEDn`
- echoed WS-Security `Password` and `Nonce` values -> `REDACTED`
- unicast IPv4 addresses -> `192.0.2.0/24` (TEST-NET-1). Multicast addresses stay as they are
- IPv6 addresses in URLs and address elements -> `fe80::n` for link-local, `2001:db8::n` otherwise
- MAC addresses -> locally administered `02:00:00:00:00:xx`
- UUIDs -> `00000000-0000-4000-8000-xxxxxxxxxxxx`
- credentials in URIs are stripped

Check the output before committing a new capture. The scrubbing is pattern based, so a new vendor can put identifiers somewhere the patterns don't catch.

## `upstream/`

Responses from the [agsh/onvif](https://github.com/agsh/onvif) mock server (`test/serverMockup/`, branch `v0.x`, commit `4ac697bc`). MIT licensed, see `upstream/LICENSE`. The doT templates were rendered to static XML with fixed values: `192.0.2.1:80`, dates on 2026-01-01, and the conditional fault sections removed.
