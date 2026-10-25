// Bundle the bridge (TypeScript) into one ESM file Electron's main process
// can import, independent of the Node version Electron ships.
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [resolve(here, '../../bridge/src/server.ts')],
  outfile: resolve(here, '../dist/bridge.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Optional native speedups for ws; not needed
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
