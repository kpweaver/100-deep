/**
 * Thangorodrim desktop shell (Electron).
 *
 * Runs the same bridge and native engine as the web build, in-process, on a
 * private localhost port, and shows the client in a single window.  Saves
 * live in the per-user application data directory.  Quitting saves.
 *
 *   npm start            run from a source checkout (after npm run build at the root)
 *   npm run smoke        headless boot test: loads the game and exits
 *   npm run dist         package with electron-builder
 */
import { app, BrowserWindow, shell } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startBridge } from '../dist/bridge.mjs';
import { initSteam } from './steam.mjs';

const smokeTest = process.argv.includes('--smoke-test');
const here = dirname(fileURLToPath(import.meta.url));
const exe = process.platform === 'win32' ? '.exe' : '';

/** Packaged: electron-builder extraResources; source checkout: the repo */
function paths() {
  if (app.isPackaged) {
    const r = process.resourcesPath;
    return {
      binary: join(r, 'engine', `angband-headless${exe}`),
      libDir: join(r, 'lib'),
      clientDir: join(r, 'client'),
    };
  }
  const repo = resolve(here, '../..');
  return {
    binary: join(repo, 'build/engine', `angband-headless${exe}`),
    libDir: join(repo, 'engine/upstream/lib'),
    clientDir: join(repo, 'client/dist'),
  };
}

if (!app.requestSingleInstanceLock()) app.quit();

let bridge = null;
let win = null;
let quitting = false;

async function createWindow() {
  const p = paths();
  for (const [what, path] of Object.entries(p)) {
    if (!existsSync(path)) throw new Error(`Missing ${what} at ${path}; run "npm run build" in the repository root`);
  }
  bridge = startBridge({
    mode: 'local',
    clientDir: p.clientDir,
    engine: { binary: p.binary, libDir: p.libDir, dataDir: join(app.getPath('userData'), 'data'), save: 'hero' },
    config: { host: '127.0.0.1', port: 0 },
  });
  await bridge.ready;
  const origin = `http://127.0.0.1:${bridge.port}`;

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#000000',
    title: 'Thangorodrim',
    show: false,
    autoHideMenuBar: true,
    // Steam Deck (gamescope) and big-picture setups expect fullscreen
    fullscreen: process.env.SteamDeck === '1',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  if (!smokeTest) win.once('ready-to-show', () => win.show());

  // Stay on the game's own origin; open anything else in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) e.preventDefault();
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
  });

  await win.loadURL(`${origin}/`);
  if (smokeTest) await runSmokeTest();
}

/** Boot the real game headlessly and check the client got the engine's hello */
async function runSmokeTest() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const status = await win.webContents.executeJavaScript(
      `(() => { const t = window.thang; return t && t.state.hello ? { engine: t.state.hello.engine, phase: t.state.phase, font: document.fonts.check('16px "Angband 8x16"') } : null; })()`,
    );
    if (status) {
      console.log(`[smoke] ok: ${status.engine}, phase ${status.phase}, font loaded: ${status.font}`);
      await shutdown(0);
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  console.error('[smoke] failed: the client never received the engine hello');
  await shutdown(1);
}

async function shutdown(code = 0) {
  if (quitting) return;
  quitting = true;
  try {
    await bridge?.close();   // engines save on close
  } finally {
    app.exit(code);
  }
}

app.whenReady().then(async () => {
  await initSteam();
  try {
    await createWindow();
  } catch (e) {
    console.error(e);
    await shutdown(1);
  }
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('before-quit', (e) => {
  if (quitting) return;
  e.preventDefault();
  void shutdown(0);
});

app.on('window-all-closed', () => void shutdown(0));
