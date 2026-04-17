/* eslint-disable import-x/no-default-export */
import { defineConfig } from 'tsdown'

// biome-ignore lint/style/noDefaultExport: allow default export for tsdown config
export default defineConfig({
  entry: ['source/index.ts'],
  format: 'esm',
  dts: true,
  clean: true,
  outDir: 'build',
  target: 'node22',
  deps: {
    onlyBundle: ['fast-xml-parser', 'strnum', 'path-expression-matcher', '@nodable/entities']
  }
})
