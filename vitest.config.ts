import { readFileSync } from 'node:fs'
import tsconfigPaths from 'vite-tsconfig-paths'
import { coverageConfigDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['build', 'node_modules'],
    coverage: {
      include: ['source/**/*.{ts,tsx}'],
      exclude: ['build', ...coverageConfigDefaults.exclude],
      provider: 'v8'
    },
    env: loadDotenv('.env'),
    testTimeout: 30000
  },
  plugins: [tsconfigPaths()]
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
