# Browser build and itch.io

Status: **working**. The WebAssembly build runs the whole game in the
browser: the same unmodified Angband core and adapter as the native engine,
compiled with Emscripten. It was tested from a sub-path static server (as
itch.io serves it) in Chromium: new character, play, autosave, reload, then
Continue. It has not yet been uploaded to itch.io (that needs your account),
nor tried in Safari or Firefox.

## How it works

- `engine/CMakeLists.txt` has an Emscripten target (`angband-web`). Upstream's
  CMake insists on a native frontend, so for this target the core source list
  is read from upstream's `CMakeLists.txt` instead (the submodule stays
  unedited).
- `proto.c` sends protocol lines to JavaScript (`thang_emit`) and awaits the
  next client line (`thang_next_line`). **Asyncify** suspends the engine at
  that wait, so every blocking prompt in the engine works unchanged, on any
  static host (no SharedArrayBuffer or cross-origin isolation headers).
- The engine runs in a **Web Worker** (`client/src/wasm/engine-worker.ts`),
  so it never blocks rendering. `WorkerConnection` replaces the WebSocket in
  the client, which otherwise doesn't change.
- **Saves** live in the browser's IndexedDB (Emscripten IDBFS, `/data`). The
  engine saves quietly once it has been idle for a second after play (at
  most every 5 s), plus Angband's own level-change autosave, so closing the
  tab loses at most a few seconds. Save and quit saves explicitly.
- Game data from `engine/lib` (`gamedata`, `customize`, `help`, `screens`, tile prefs) is
  packed into `engine/angband.data`. The client loads the Gervais tile
  image separately.

Size: about 2.4 MB zipped (1.8 MB WebAssembly, 1.3 MB game data, 0.6 MB client,
and the tile sheet).

## Building

```bash
brew install emscripten        # or install emsdk (Linux, Windows)
npm run build:web              # -> client/dist-web/ and build/100-deep-web.zip
npm run serve:web              # try it at http://localhost:4173
npm run test:wasm              # engine tests against the WebAssembly build
```

Any static web server works, from a sub-path too: all paths are relative.
`?engine=bridge` / `?engine=wasm` on any build overrides which engine the
client uses.

## Uploading to itch.io

1. Create a project (Dashboard > Create new project):
   - **Kind of project:** HTML
   - **Uploads:** `build/100-deep-web.zip`, and tick *This file will be
     played in the browser*.
2. Embed options:
   - **Viewport:** 1280 × 720 (the UI scales; 960 × 600 also works).
   - Tick **Fullscreen button**.
   - *Click to launch in fullscreen* is optional. The game captures the
     keyboard, so launching on click keeps itch's page scrollable.
   - Leave *SharedArrayBuffer support* off: it isn't needed.
   - *Mobile friendly:* off (needs a keyboard or controller).
3. Description: credit **Angband** (GPLv2), **David Gervais' tiles**
   (CC BY 3.0) and link the source repository (see LICENSES.md, which is
   also included in the zip under `licenses/`).
4. Save, then press *View page* and check that a controller works in the
   embedded frame and in fullscreen.

### Pushing updates with butler

[butler](https://itch.io/docs/butler/) uploads only what changed:

```bash
butler login
npm run build:web
ITCH_TARGET=yourname/100-deep npm run publish:itch
```

CI does the same on pushes to `main` once you set the repository secret
`BUTLER_API_KEY` and the variable `ITCH_TARGET` (see `.github/workflows/ci.yml`).
Every CI run also uploads the built site as the `100-deep-web` artifact.

## Limitations

- Saves belong to one browser on one device. Clearing site data, or a
  private window, loses them. itch.io runs games in a frame on its own
  domain, which browsers store separately from your other sites.
- The browser build runs one character slot (`hero`), like local play.
- Asyncify makes the engine somewhat slower than native. Turns still take
  well under a frame, but long auto-explores or rests are where it would
  show.
