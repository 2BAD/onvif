# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `@2bad/onvif-management`: users, NTP, network interface, default gateway, dynamic DNS, zero configuration, IP address filter and relay output operations as methods on `device.management`
- Added a method on `Device` for each device service operation, such as `device.getDeviceInformation()`
- Added `device.media.v1` and `device.media.v2` with a method for each Media and Media2 operation
- Added `getEventProperties()` and `getServiceCapabilities()` to `device.events`
- These methods show the ONVIF description of their operation in the editor

### Changed

- Importing `@2bad/onvif` now uses about 2 MiB less memory

## [2.0.0] - 2026-10-05

### Highlights

- **Rewritten from scratch:** 2.0 shares no API with 1.x. Code written for 1.x needs changes.
- **Separate packages:** Media, events and discovery are their own packages. Install them next to `@2bad/onvif` when you need them.
- **Typed calls:** Every operation has request and response types generated from the ONVIF schema.
- **Faster:** Parses camera responses about 6x faster.
- **Safer:** Credentials go only to the camera you connected to. Every response is treated as untrusted input.
- **No runtime dependencies:** The core no longer depends on `fast-xml-parser`.

### Breaking Changes

- Replaced `new Onvif()` and `onvif.connect()` with `await Device.connect()`
- Replaced the `onvif.device` methods with `device.call()` and the `DeviceManagement` operations
- Moved media to `@2bad/onvif-media`, where each function takes the device first
- Moved discovery to `@2bad/onvif-discovery`, with `discover()` in place of `Discovery.probe()`
- `getSnapshotUri()` and `getStreamUri()` now take a profile instead of `{ profileToken }`
- `getStreamUri()` now returns the address as a `URL` in `uri`
- The `protocol` option of `getStreamUri()` now takes `RTSP`, `UDP` or `HTTP` only
- Renamed the `useSecure` and `timeout` options to `secure` and `timeoutMs`
- Replaced the `secureOptions` option with `tls`
- Replaced the `preserveAddress` option with `serviceAddresses`
- Service addresses on another host now use the host passed to `connect()` by default
- `connect()` now fails with an `AuthError` when the credentials are wrong
- `connect()` no longer reads profiles, video sources or device information

### Added

- Added event subscriptions with `subscribe()` in `@2bad/onvif-events`
- Added `motionOf()` and `isTopic()` to read motion and other event topics
- Added Media2 support for cameras that offer it, with Media v1 as the fallback
- H.265 encoders are now reported on cameras with Media2
- Added `defaultProfile()` to pick a profile with a video source and encoder
- Added `fetchSnapshot()` to download a snapshot with the camera's credentials
- Added `getVideoSourceConfigurations()` and `getVideoEncoderConfigurations()`
- Added `getVideoEncoderConfigurationOptions()` to list the codecs and settings an encoder accepts
- Added `setVideoEncoderConfiguration()` to change the codec, resolution, frame rate or bitrate
- Added `device.use()` to call media and events functions as `device.media` and `device.events`
- `Device` can now be declared with `using` to close its connections at the end of the block
- Added the `url` option to `Device.connect()` for connecting to an address found by `discover()`
- Added typed errors that carry the host, service and action of each failure
- Added an `AbortSignal` and a single timeout to every call
- Added the `retry` option to retry `Get*` calls on connection and gateway errors
- Added HTTP Digest authentication with MD5 and SHA-256
- Added the `basicAuth` option to allow HTTP Basic authentication
- Calls can now authenticate with cameras whose clock is set wrong
- Added `parseEnvelope()` and `serialize()` in `@2bad/onvif/soap` for reading and writing SOAP messages

### Changed

- Parsing camera responses is now about 6x faster
- Reading profiles is now about 5x faster
- Requests now reuse open connections to the camera
- Local request round trips are now about 4x faster
- `connect()` now makes 3 requests on most cameras instead of 5 or more

### Removed

- Removed PTZ control, with no replacement in 2.0 yet
- Removed `setSystemDateAndTime()`, `getNTP()`, `setNTP()`, `getDNS()` and `setScopes()`, with no replacement yet
- Removed `getVideoSources()`, `getActiveSources()`, `getOSDs()` and `getOSDOptions()`, with no replacement yet
- Removed the `defaultProfile` property, replaced by the `defaultProfile()` function
- Removed the `activeSource`, `deviceInformation` and `capabilities` properties
- Removed the `agent`, `urn` and `autoConnect` options
- Removed the 1.x types for ONVIF services that 2.0 does not cover

### Security

- Credentials are now sent only to the protocol, host and port passed to `connect()`
- Service addresses no longer move a connection from HTTPS to HTTP
- Added certificate pinning to the `tls` option, with nothing sent before the certificate matches
- Responses with a DOCTYPE, custom entities or processing instructions are now rejected
- Responses now have limits on size, nesting depth, element count and attributes
- Responses can no longer set `__proto__`, `constructor` or `prototype` on decoded objects
- Values written into requests are now XML escaped
- WS-Security nonces now come from `node:crypto` instead of `Math.random()`
- Passwords with non-ASCII characters now work with WS-Security
- Errors never contain credentials, including WS-Security headers echoed by cameras

[Unreleased]: https://github.com/2BAD/onvif/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/2BAD/onvif/compare/v1.0.0-beta.6...v2.0.0
