# Desktop builds and Steam

Status: **groundwork**. The Electron shell boots the real game (smoke-tested
from source and from a packaged macOS build). Steamworks is stubbed, not
integrated, and Windows and Linux builds are untested.

## The desktop shell (`desktop/`)

An Electron app that runs the same bridge and native engine as the web build,
in-process, on a private `127.0.0.1` port, and shows the client in one
window:

- Saves live in the per-user app data directory (macOS:
  `~/Library/Application Support/100 Deep/data`; saves from when the game was called Thangorodrim are picked up automatically).
- Quitting (window close, Cmd+Q, Alt+F4) saves the game first.
- F11 toggles fullscreen. On Steam Deck (`SteamDeck=1`, set by gamescope) it
  starts fullscreen.
- There is a single instance, and navigation is locked to the game's own
  origin; external links open in the system browser.
- Electron bundles Chromium, so the Gamepad API (Xbox, PlayStation and Steam
  Input) behaves the same everywhere.

`desktop/` is deliberately **not** an npm workspace, so web and Docker builds
never download Electron.

```bash
npm run build                 # at the repo root: engine + client
cd desktop
npm install
npm start                     # run the desktop app from source
npm run smoke                 # headless boot test (no window), exits 0 on success
npm run pack                  # unpacked app in desktop/release/ (quick check)
npm run dist                  # installers: dmg (mac), nsis (win), AppImage (linux)
```

`scripts/bundle.mjs` bundles the TypeScript bridge into `dist/bridge.mjs`
with esbuild, so the shell doesn't depend on Electron's Node version
understanding TypeScript. Packaged builds carry the engine binary, Angband's
game data, the Gervais tiles, the client and the licence files as
`extraResources`.

## Platform builds

The engine must be compiled natively for each target. Build each platform on
its own OS, or in CI with a matrix:

- **macOS:** works today (`npm run dist`). For distribution, sign and
  notarize: set `CSC_LINK` / `CSC_KEY_PASSWORD` and Apple notarization
  credentials for electron-builder.
- **Linux / Steam Deck:** the engine builds with gcc/cmake (see the
  Dockerfile). Target the Steam Linux Runtime (Sniper) for Steam.
- **Windows:** `proto.c` has `_WIN32` guards for stdio, but upstream's CMake
  requires a frontend and our build forces GCU (ncurses). A Windows build
  needs either MinGW + PDCurses for configuration, or a small CMake change to
  configure upstream's core without a frontend. This is the main remaining
  porting task.

## Steam integration checklist

1. Create the Steamworks app and depots (one per OS).
2. `cd desktop && npm i steamworks.js`, then set `STEAM_APP_ID`, or ship
   `steam_appid.txt` for local testing. `src/steam.mjs` initialises Steam and
   the overlay when available, and is a no-op otherwise.
3. **Controller support:** the game is fully playable with a gamepad. Mark
   "Full controller support" once a physical-controller pass is done (see
   limitations.md), and add Steam Input default configurations mapping to
   the standard gamepad layout.
4. **Steam Deck verification:** fullscreen at 1280×800, readable text (the
   UI uses the 16px Angband font; check at Deck scale), and no keyboard-only
   flows. Character naming offers controller-pickable names.
5. **Cloud saves:** point Steam Auto-Cloud at the app data `data/save/`
   directory.
6. **Achievements:** map engine messages or state (depth reached, uniques
   slain, level) to achievement calls in the main process. This needs a
   small hook that forwards selected state from the bridge.
7. **Store and legal:** Angband is GPLv2 (or the Angband licence), which
   allows commercial distribution under GPLv2 if source is offered. The
   Gervais tiles are CC BY 3.0 (attribution in-game and in the store). Do
   **not** ship the Shockbolt tiles. Include LICENSES.md (packaged under
   `resources/licenses/`).
