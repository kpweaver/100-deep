/**
 * Development launcher: builds the engine if needed, then runs the bridge
 * (engine subprocess + WebSocket, port 8787) and the Vite client (5173).
 *   npm run dev            -> open http://localhost:5173
 *   THANG_DEBUG=1 npm run dev   logs all protocol traffic to var/logs
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(resolve(root, 'build/engine/angband-headless'))) {
  console.log('[dev] building the engine first…');
  const r = spawnSync('sh', ['scripts/build-engine.sh'], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const procs = [
  spawn(process.execPath, ['bridge/src/index.ts'], { cwd: root, stdio: 'inherit' }),
  spawn('npx', ['vite', '--host', '127.0.0.1'], { cwd: resolve(root, 'client'), stdio: 'inherit' }),
];

const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1500);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { if (code) stop(); });
