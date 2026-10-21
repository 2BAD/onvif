# Fixtures

SOAP responses for the unit, conformance, fuzz and benchmark tests and the mock camera.

```text
live/<vendor>/<model>/       real devices
simulator/<vendor>/<model>/  Happytime ONVIF server
tls/                         test certificates
```

Responses are named `<service>.<Action>.xml`. `manifest.json` has the HTTP status and content type of each.

## Capturing

`.env` sets `ONVIF_TEST_HOST`, `ONVIF_TEST_USER` and `ONVIF_TEST_PASS`. The same variables in the shell take precedence.

```sh
pnpm fixtures:capture                        # every read-only suite
pnpm fixtures:capture ptz imaging            # only these suites
pnpm fixtures:capture --only media2.         # only names with this prefix
pnpm fixtures:capture media --write          # the Set calls too
pnpm fixtures:capture --stdout > out.jsonl   # print instead of writing
pnpm fixtures:import <dir> < out.jsonl       # write printed captures into <dir>
```

Suites are `device`, `management`, `media`, `ptz`, `imaging`, `analytics`, `deviceio`, `recording`, `events`, `discovery`, `motion` and `reset`.

- `motion` waits up to five minutes for motion to start and stop. Walk through the camera's view while it runs.
- `reset` resets the device to factory defaults and reboots it. Simulator only.
- `--write` sends settings back as read and creates and deletes a test user, role, scope, geo location, storage configuration, certificate, 802.1X configuration, preset, profile, OSD, privacy mask, audio clip, analytics rule, recording, track and recording job named `onviftest`. Test cameras and simulators only.
- `media --write` skips `SetVideoSourceMode` when the mode needs a reboot.
- `deviceio --write` switches the first relay to active and back to inactive and sends a serial command with no data.
- `--write` also sends an invalid hostname, time zone and date, and restores them. Some cameras rewrite their time zone when it is sent back.
- `management --write` needs `openssl` for the test certificates.

`motion` and `reset` run only when named.

## Scrubbing

- serial number, hardware id, user names, password, hostname, `name` and `location` scopes: `REDACTEDn`
- NTP and dynamic DNS hosts: `hostn.example`
- Wi-Fi SSIDs, certificate DNs and serial numbers: `REDACTEDn`
- certificate data: base64 of `REDACTEDn`
- geo location coordinates: `0`
- echoed WS-Security `Password` and `Nonce`: `REDACTED`
- unicast IPv4: `192.0.2.0/24`
- IPv6: `fe80::n` or `2001:db8::n`
- MAC: `02:00:00:00:00:xx`
- UUID: `00000000-0000-4000-8000-xxxxxxxxxxxx`
- credentials in URLs: removed

Scrubbing is pattern based. Review every capture before committing it.
