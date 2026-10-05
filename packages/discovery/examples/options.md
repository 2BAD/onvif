# Options

```ts
discover({
  // optional, values are the defaults
  timeoutMs: 3_000, // how long to wait for replies
  xaddrs: 'sender', // keep only addresses on the host that answered

  // optional, off by default
  interfaces: ['eth0'], // probe only these interfaces, every IPv4 interface except loopback otherwise
  hosts: ['192.0.2.10'], // probe these hosts directly instead of multicast
  port: 3702, // fixed local port for replies, for firewalls
  onError: (error) => logger.warn(error), // receives each reply that cannot be read
  signal // ends the discovery
})
```

## Stopping early

```ts
for await (const found of discover()) {
  console.log(found.endpoint) // urn:uuid:...
  break
}
```

An aborted `signal` also ends the loop.

## Addresses on other hosts

Anyone on the network can answer a probe. By default `xaddrs` only has addresses on the host that answered. The others are in `droppedXAddrs`.

Pass `xaddrs: 'any'` for cameras that report an address behind NAT.
