# Security

## Authentication

Uses WS-Security digest and HTTP Digest. Works with cameras whose clock is wrong.

Cameras that only offer HTTP Basic need `basicAuth`. `'https'` allows it on HTTPS only. `'always'` also allows it on HTTP. Basic sends the password in clear text.

## TLS

```ts
const device = await Device.connect({
  hostname: 'camera.example',
  secure: true,
  username: 'admin',
  password: 'secret',
  tls: {
    // optional, off by default
    ca: privateCa, // trust a private CA
    cert: clientCert, // client certificate
    key: clientKey,
    fingerprint256: 'AB:CD:...', // pin a self-signed certificate
    rejectUnauthorized: false // accept any certificate
  }
})
```

## Service addresses

Credentials are only sent to the protocol, host and port you passed to `connect()`. Cameras behind NAT or a proxy often report internal service addresses. `serviceAddresses` sets what happens to them.

- `'rewrite'` (default): use your host and port, keep the path
- `'sameHost'`: allow another port or HTTPS on your host, rewrite the rest
- `'reject'`: calls to that service fail with an `OnvifError`
