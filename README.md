# @2bad/onvif

[![NPM version](https://img.shields.io/npm/v/@2bad/onvif.svg)](https://www.npmjs.com/package/@2bad/onvif)
[![License](https://img.shields.io/npm/l/@2bad/onvif)](https://opensource.org/license/MIT)
[![GitHub Build Status](https://img.shields.io/github/actions/workflow/status/2BAD/onvif/build.yml)](https://github.com/2BAD/onvif/actions/workflows/build.yml)
[![Code coverage](https://img.shields.io/codecov/c/github/2BAD/onvif)](https://codecov.io/gh/2BAD/onvif)
[![Written in TypeScript](https://img.shields.io/github/languages/top/2BAD/onvif)](https://www.typescriptlang.org/)

A TypeScript implementation of the ONVIF Client protocol supporting Profile S (Live Streaming) and Profile G (Replay). This is a stable, typed fork of the original [onvif](https://github.com/agsh/onvif) package.

## Features

This library provides a wrapper for the ONVIF protocol, allowing you to:
- Get information about your NVT (Network Video Transmitter) devices
- Access media sources
- Control PTZ (Pan-Tilt-Zoom) movements
- Manage presets
- Detect devices in your network
- Control device events
- Get information about NVR (Network Video Recorder) Profile G devices
- Obtain recordings lists

## Installation

```bash
npm install @2bad/onvif
```

## Key Improvements

- Full TypeScript support with interfaces describing ONVIF data structures
- Stable npm package with regular maintenance
- Improved error handling and stability fixes
- Maintained type definitions
- Compatible with the original API structure

## Usage

```typescript
import { Onvif } from '@2bad/onvif';

// Connect to a camera
const cam = new Onvif({
  hostname: '192.168.1.123',
  username: 'admin',
  password: 'password',
  port: 80
});

await device.connect()

// Get snapshot URI
const snapshotUri = await device.media.getSnapshotUri({ profileToken: 'profile1' })
```

## Compatibility

This package maintains compatibility with code written for the original onvif package (v0.6.x) through a compatibility layer. If you're migrating from the original package, your existing code should work with minimal changes.

## Documentation

For detailed API documentation and supported ONVIF commands, please visit our [GitHub repository](https://github.com/2bad/onvif).

## Acknowledgments

This package is based on the excellent work done by [agsh](https://github.com/agsh/onvif) and the ONVIF community. We've built upon their foundation to provide a stable, typed implementation for the Node.js ecosystem.

[![ONVIF](https://www.onvif.org/wp-content/themes/onvif-public/images/logo.png)](http://onvif.org)

## Contributing

Contributions are welcome! Feel free to submit issues and pull requests.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
