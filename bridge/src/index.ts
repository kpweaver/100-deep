/**
 * Bridge entry point: `node bridge/src/index.ts [--port N] [--save NAME] [--log]`
 */
import { startBridge } from './server.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const bridge = startBridge({
  port: arg('--port') ? Number(arg('--port')) : undefined,
  engine: { save: arg('--save') },
  log: process.argv.includes('--log'),
});

const shutdown = async () => {
  console.log('[bridge] saving and shutting down...');
  await bridge.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
