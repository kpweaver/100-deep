/**
 * Browser-only build: the engine compiled to WebAssembly runs in the page,
 * so the game is a folder of static files (no server).  Output:
 *
 *   client/dist-web/            the site (open via any static web server)
 *   build/thangorodrim-web.zip  the same, zipped for itch.io (HTML5 upload)
 *
 * Needs Emscripten (brew install emscripten, or emsdk) and zip.
 *
 *   npm run build:web
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmBuild = join(root, 'build/wasm');
const out = join(root, 'client/dist-web');
const zip = join(root, 'build/thangorodrim-web.zip');
const lib = join(root, 'engine/upstream/lib');
const run = (cmd: string, args: string[], cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

try {
  execFileSync('emcc', ['--version'], { stdio: 'ignore' });
} catch {
  console.error('Emscripten (emcc) is not on PATH: brew install emscripten, or activate emsdk.');
  process.exit(1);
}
if (!existsSync(join(root, 'engine/upstream/src/game-world.c'))) {
  run('git', ['submodule', 'update', '--init', 'engine/upstream']);
}

// 1. Engine -> WebAssembly (build/wasm/angband.mjs, .wasm, .data)
run('emcmake', ['cmake', '-S', 'engine', '-B', wasmBuild, '-DCMAKE_BUILD_TYPE=Release']);
run('cmake', ['--build', wasmBuild, '--target', 'angband-web', '-j', '8']);

// 2. Client with relative paths (itch.io serves games from a sub-path)
rmSync(out, { recursive: true, force: true });
run('npx', ['vite', 'build', '--mode', 'web', '--base', './', '--outDir', 'dist-web', '--emptyOutDir'], join(root, 'client'));

// 3. Engine, tiles (Gervais only, CC BY 3.0) and licences next to the page
mkdirSync(join(out, 'engine'), { recursive: true });
for (const f of ['angband.mjs', 'angband.wasm', 'angband.data']) copyFileSync(join(wasmBuild, f), join(out, 'engine', f));
mkdirSync(join(out, 'tiles/gervais'), { recursive: true });
copyFileSync(join(lib, 'tiles/gervais/32x32.png'), join(out, 'tiles/gervais/32x32.png'));
mkdirSync(join(out, 'licenses'), { recursive: true });
copyFileSync(join(root, 'LICENSES.md'), join(out, 'licenses/LICENSES.md'));
copyFileSync(join(root, 'engine/upstream/docs/copying.rst'), join(out, 'licenses/angband-copying.rst'));

// 4. Zip for itch.io: index.html must be at the top level of the archive
rmSync(zip, { force: true });
run('zip', ['-r', '-q', '-X', zip, '.'], out);
console.log(`\nBuilt ${out}\nZipped ${zip} (${(statSync(zip).size / 1e6).toFixed(1)} MB)`);
