import { readFileSync } from 'node:fs'
import { coverageConfigDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/build', '**/node_modules'],
    coverage: {
      include: ['packages/*/source/**/*.ts'],
      exclude: ['**/build', ...coverageConfigDefaults.exclude],
      provider: 'v8',
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90
      }
    },
    env: loadDotenv('.env'),
    testTimeout: 30000
  }
})

function loadDotenv(path: string): Record<string, string> {
  try {
    const out: Record<string, string> = {}
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (m) out[m[1]!] = m[2]!
    }
    return out
  } catch {
    return {}
  }
}
