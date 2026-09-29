# @2bad/onvif

ONVIF client for Node.js. Rewritten from scratch with three goals: performance, security and reliability. The core has zero runtime deps, and each ONVIF service gets its own optional package.

> [!WARNING]
> 2.0 is still in development and isn't usable yet. The `1.0.0-beta` releases on npm are the old implementation and aren't maintained anymore.

## Packages

| Package | Status |
|---|---|
| [`@2bad/onvif`](packages/onvif) | in progress: connect, device management, SOAP layer, WS-Security, HTTP transport |
| [`@2bad/onvif-events`](packages/events) | in progress: pull point subscriptions, motion events |
| [`@2bad/onvif-media`](packages/media) | in progress: profiles, snapshot and stream URIs, snapshots |

## Development

```sh
pnpm install
pnpm check            # lint, format, types
pnpm test             # unit, conformance and fuzz tests
pnpm bench            # parser and transport benchmarks
pnpm fixtures:capture # record responses from the device in .env
```

## License

MIT
