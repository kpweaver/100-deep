/**
 * Browser-only build: the engine compiled to WebAssembly runs in the page,
 * so the game is a folder of static files (no server).  Output:
 *
 *   client/dist-web/            the site (open via any static web server)
 *   build/100-deep-web.zip  the same, zipped for itch.io (HTML5 upload)
 *
 * Needs Emscripten (brew install emscripten, or emsdk) and zip.
 *
 *   npm run build:web
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmBuild = join(root, 'build/wasm');
const out = join(root, 'client/dist-web');
const zip = join(root, 'build/100-deep-web.zip');
const lib = join(root, 'engine/lib');
const run = (cmd: string, args: string[], cwd = root, env = process.env) => execFileSync(cmd, args, { cwd, env, stdio: 'inherit' });

try {
  execFileSync('emcc', ['--version'], { stdio: 'ignore' });
} catch {
  console.error('Emscripten (emcc) is not on PATH: brew install emscripten, or activate emsdk.');
  process.exit(1);
}
if (!existsSync(join(root, 'engine/upstream/src/game-world.c'))) {
  run('git', ['submodule', 'update', '--init', 'engine/upstream']);
}

// 1. Engine -> WebAssembly (build/wasm/angband.mjs, .wasm, .data; game data from engine/lib)
run('emcmake', ['cmake', '-S', 'engine', '-B', wasmBuild, '-DCMAKE_BUILD_TYPE=Release']);
run('cmake', ['--build', wasmBuild, '--target', 'angband-web', '-j', '8']);

// The engine's directory is named after its contents, so browsers never mix
// a cached old engine with a new page (the file names never change)
const engineFiles = ['angband.mjs', 'angband.wasm', 'angband.data'];
const hash = createHash('sha256');
for (const f of engineFiles) hash.update(readFileSync(join(wasmBuild, f)));
const engineDir = `engine/${hash.digest('hex').slice(0, 12)}/`;

// 2. Client with relative paths (itch.io serves games from a sub-path)
rmSync(out, { recursive: true, force: true });
run('npx', ['vite', 'build', '--mode', 'web', '--base', './', '--outDir', 'dist-web', '--emptyOutDir'], join(root, 'client'),
  { ...process.env, VITE_ENGINE_DIR: engineDir });

// 3. Engine, tiles (Gervais only, CC BY 3.0) and licences next to the page
mkdirSync(join(out, engineDir), { recursive: true });
for (const f of engineFiles) copyFileSync(join(wasmBuild, f), join(out, engineDir, f));
mkdirSync(join(out, 'tiles/gervais'), { recursive: true });
copyFileSync(join(lib, 'tiles/gervais/32x32.png'), join(out, 'tiles/gervais/32x32.png'));
mkdirSync(join(out, 'licenses'), { recursive: true });
copyFileSync(join(root, 'LICENSES.md'), join(out, 'licenses/LICENSES.md'));
copyFileSync(join(root, 'LICENSE'), join(out, 'licenses/gpl-2.0.txt'));
copyFileSync(join(root, 'engine/upstream/docs/copying.rst'), join(out, 'licenses/angband-copying.rst'));

// 4. Zip for itch.io: index.html must be at the top level of the archive
rmSync(zip, { force: true });
run('zip', ['-r', '-q', '-X', zip, '.'], out);
console.log(`\nBuilt ${out}\nZipped ${zip} (${(statSync(zip).size / 1e6).toFixed(1)} MB)`);
