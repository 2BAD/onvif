import { existsSync } from 'node:fs'
import { coverageConfigDefaults, defineConfig } from 'vitest/config'

if (existsSync('.env')) process.loadEnvFile('.env')

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@2bad\/onvif$/, replacement: `${import.meta.dirname}/packages/onvif/source/index.ts` },
      { find: /^@2bad\/onvif\/soap$/, replacement: `${import.meta.dirname}/packages/onvif/source/soap/index.ts` },
      { find: /^@2bad\/onvif-([a-z]+)$/, replacement: `${import.meta.dirname}/packages/$1/source/index.ts` }
    ]
  },
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
    testTimeout: 30000
  }
})
