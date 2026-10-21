# Firmware and backups

```ts
import { readFile } from 'node:fs/promises'
import { Device } from '@2bad/onvif'
import { management } from '@2bad/onvif-management'

const device = await Device.connect({ hostname: '192.0.2.10', username: 'admin', password: 'secret' })
const camera = device.use(management)

const { systemBackupUri } = await camera.management.getSystemUris()
const backup = systemBackupUri && (await camera.download(systemBackupUri)).body

const firmware = await readFile('firmware.bin')
const { expectedDownTime } = await camera.management.uploadFirmware(firmware, { timeoutMs: 600_000 })
```

`uploadFirmware()` waits the upload delay the camera asks for. A camera that rejects the file throws a `TransportError` with `status` 415.

`uploadBackup(backup)` restores a backup downloaded from `systemBackupUri`.

`GetSystemBackup`, `RestoreSystem` and `UpgradeSystemFirmware` are not supported.
