# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking Changes

- `getProfiles()` now returns `videoSource` and `videoEncoder` summaries, with the camera's response under `reported`
- `getSnapshotUri()` and `getStreamUri()` now take a profile or `{ service, token }` instead of a token
- The `protocol` option of `getStreamUri()` now takes `RTSP`, `UDP` or `HTTP` only

### Added

- Added Media2 support for cameras that offer it, with Media v1 as the fallback
- H.265 encoders are now reported on cameras with Media2
- Added `getVideoSourceConfigurations()` and `getVideoEncoderConfigurations()`
- Added `getVideoEncoderConfigurationOptions()` to list the codecs and settings an encoder accepts
- Added `setVideoEncoderConfiguration()` to change the codec, resolution, frame rate or bitrate
- Encoders now report their codec profile in `profile`
- Added `device.timeoutMs`

## [2.0.0-alpha.0] - 2026-10-01

### Highlights

- **Rewritten from scratch:** The core has no runtime dependencies. Events and media are separate packages.
- **Typed calls:** Every operation has request and response types generated from the ONVIF schema. Responses are checked against the schema at runtime.

### Breaking Changes

- Replaced the 1.x API with `Device.connect()` and `device.call()`. Code written for 1.x needs changes.
- Moved events and media into the `@2bad/onvif-events` and `@2bad/onvif-media` packages

### Added

- Added typed errors that carry the host, service and action of each failure
- Added an `AbortSignal` and a single timeout to every call
- Added the `retry` option to retry `Get*` calls on connection and gateway errors
- Added HTTP Digest authentication with MD5 and SHA-256
- Added the `basicAuth` option to allow HTTP Basic authentication
- Calls can now authenticate with cameras whose clock is set wrong
- Added the `serviceAddresses` option for cameras behind NAT or a proxy
- Added custom CA, client certificates and certificate pinning to the `tls` option
- Added `subscribe()` for event subscriptions that reconnect after network errors and reboots
- Added `motionOf()` and `isTopic()` to read motion and other event topics
- Added `getProfiles()`, `getSnapshotUri()`, `getStreamUri()` and `fetchSnapshot()` for media
- Added `defaultProfile()` to pick a profile with a video source and encoder

### Changed

- Prereleases are now published under the `next` npm tag
- Replaced `fast-xml-parser` with a built-in XML parser

### Removed

- Removed WS-Discovery device search, with no replacement in 2.0 yet
- Removed PTZ camera control, with no replacement in 2.0 yet
- Removed the 1.x types for ONVIF services that 2.0 does not cover

[Unreleased]: https://github.com/2BAD/onvif/compare/v2.0.0-alpha.0...HEAD
[2.0.0-alpha.0]: https://github.com/2BAD/onvif/compare/v1.0.0-beta.6...v2.0.0-alpha.0
