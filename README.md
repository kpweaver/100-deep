# 100 Deep

A first-person, controller-friendly frontend for **Angband**, inspired by
[Orbrun](https://orbrun.app). Every game rule (combat, monster AI, dungeon
generation, item identification, energy and speed, the RNG, saving) is
handled by the **real, unmodified Angband 4.2.6 C engine**. The browser client
only renders what the engine says the player knows, and it only issues
native Angband commands.

```
Angband 4.2.6 core (unmodified, git submodule)
        │  links
engine/adapter (C)  ── headless frontend: command queue, game-input hooks,
        │              knowledge-restricted snapshots, Gervais tile lookup
        │  JSON lines over stdin/stdout (protocol v1)
bridge (Node)       ── spawns the engine, relays to WebSocket, serves tiles
        │  WebSocket /ws
client (TS + Three.js + Vite) ── first-person renderer, HUD, menus, gamepad
```

## Quick start

Requirements: macOS or Linux, a C compiler, CMake ≥ 3.16, ncurses headers
(only so upstream's CMake configures), and Node.js ≥ 23.6. The bridge and
tests run TypeScript directly through Node's type stripping.

### One click (macOS)

Double-click **`100 Deep.command`** in the repository folder. A Terminal
window opens; it installs dependencies and builds on first run, then starts
the game and opens it in your browser. Close the window (or press Ctrl+C) to
save and quit.

For an app you can keep in the Dock or Applications:

```bash
npm run make-app          # creates "100 Deep.app" (icon: Smaug's Gervais tile)
```

If the game is already running, launching again just opens the browser.

### One command

```bash
git clone --recurse-submodules <this repo> && cd <repo folder>
npm install
npm start                 # builds engine + client, serves http://127.0.0.1:8787 and opens it
```

On Linux, `sh scripts/launch.sh` does the same as the double-click launcher.

### Hosting online, desktop and Steam

- `npm run build:web` builds a **browser-only** version: the engine compiled
  to WebAssembly, saves in the browser, a static site ready for itch.io. See
  [docs/itch.md](docs/itch.md).
- `node bridge/src/index.ts --hosted` (or the Docker image) runs a
  multi-player server: see [docs/hosting.md](docs/hosting.md).
- `desktop/` is an Electron shell for a downloadable build (groundwork
  for Steam): see [docs/desktop-and-steam.md](docs/desktop-and-steam.md).

### Development

```bash
npm run dev               # bridge on :8787 + Vite (hot reload) on :5173
                          # (rebuilding the engine restarts it automatically; your game reloads)
```

Open <http://localhost:5173>. `npm run dev` and `npm start` both use port
8787, so run one at a time. A second instance on the same port refuses to
start rather than touching your save.

Useful environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `THANG_PORT` | `8787` | Bridge HTTP/WebSocket port |
| `THANG_SAVE` | `hero` | Savefile name (under `var/data/save/`) |
| `THANG_DATA` | `var/data` | Writable dir for saves, scores, lore |
| `THANG_DEBUG` | unset | Log all protocol traffic (engine stderr + `var/logs/session-*.jsonl`) |

Add `?debug` to the client URL to log protocol messages in the browser console.

## Controls

Turning only changes your view. Angband has no facing, so turning never
costs a game turn.

| Action | Keyboard | Controller |
|---|---|---|
| Move forward / back | W / S, ↑ / ↓ | Left stick, D-pad ↑/↓ |
| Strafe | A / D | Left stick ←/→ |
| Turn 45° | Q / E, ← / → | Right stick, D-pad ←/→ |
| Run | Shift+W | — |
| Interact (stairs, pick up, open/close door, enter shop, clear rubble, disarm) | Space / Enter | A |
| Attack (melee adjacent, else fire at nearest if you have a launcher) | F | RT |
| Auto-explore (repeats until something happens) | X | X |
| Cycle target (turns to face it) | Tab / Shift+Tab | RB |
| Inventory & equipment | I | Y |
| Cast a spell / study | Z / Shift+Z | LT |
| Quick actions (rest, stairs travel, doors, tunnel, throw, save…) | V | LB |
| Rest as needed | R | LB ▸ Rest |
| Wait a turn | . / Numpad 5 | R3 |
| Map (cursor + travel there) | M | Select |
| Character sheet (stock `C` screen, 2 pages) | C | LB ▸ Character sheet |
| Visible monster list / item list / recall popups (←/→ to switch) | [ / ] | LB ▸ lists |
| Show/hide the monster & item lists under the minimap | \\ | Options |
| Absolute 8-way walk | Numpad 1–9 | — |
| Pause / system menu (options, save, save & return to title, save & quit) | Esc | Start |
| Menus | ↑↓ + Enter, letter shortcuts a–z, Esc | D-pad/stick + A, B to go back |

Every implemented feature can be used without a mouse. Button prompts match
your controller: Xbox, PlayStation (✕○□△) or Nintendo labels are detected
automatically, or chosen under Options.

## What works (engine-backed)

- Character creation with Angband's own races, classes, point-based or
  rolled stats, and interface/birth options.
- Load and continue a savefile. The game autosaves on level change (native
  autosave), when you choose Save, and when the client goes away (stdin
  EOF, the same path as SIGHUP).
- First-person exploration of genuine procedurally generated levels and the
  town, with fog of war and remembered/visible distinction.
- Movement, running, native pathfinding (`CMD_PATHFIND` from the map
  cursor), auto-explore (`CMD_EXPLORE`), travel to stairs
  (`CMD_NAVIGATE_UP/DOWN`), stairs, doors, tunnelling, disarming, jumping.
- Melee (walking into monsters), firing (`fire_at_nearest` and `CMD_FIRE`),
  throwing, targeting with native targetability rules.
- Inventory, equipment, quiver, floor: wield, take off, drop, pick up, eat,
  quaff, read, use staffs/wands/rods, activate, refuel, inscribe, ignore,
  examine (native `object_info` text), browse books.
- Spellcasting and studying through the engine's own spell prompts.
- Every engine prompt (item, direction, aim/target, spell, quantity,
  confirmation, text, curse and effect choices), each validated by the
  engine.
- Stores and the Home: buy, sell/give, stash, retrieve at native prices.
- Every stock Angband subwindow, drawn by Angband's own code: visible
  monster list (with directions), visible item list, monster recall, object
  recall (side panels and popups), and the full character sheet including
  the resistance/flag grid.
- Monster recall text, level feelings, status effects, monster health bar
  for the tracked monster, death and tombstone, then starting a new
  character.
- Gervais 32×32 tiles for monsters, objects (including flavours), traps,
  stairs and shop entrances, mapped by Angband's own `graf-dvg.prf`,
  `xtra-dvg.prf` and `flvr-dvg.prf`.
- Engine crash recovery: the bridge restarts the engine and the client
  reloads the last save. Client reconnection gets a full resync.

See [docs/limitations.md](docs/limitations.md) for what is not yet
accessible.

## Tests

```bash
npm test                  # engine + bridge + client tests
npm run test:engine       # 18 tests against the real native engine
npm run test:bridge       # 9 hosted/local server tests with real engines
npm run test:client       # 21 isolated client unit tests (vitest)
npm run test:wasm         # the WebAssembly engine (after npm run build:web)
```

The engine tests never use fabricated game state. They spawn the real
executable with a fixed seed and check movement, wall blocking, time
accounting, stairs, information restriction (no secret doors, fog of war),
Gervais tile mappings against the pref file, melee, item prompts, drop and
pick-up, error handling, consistency under rapid input, save/reload,
save-on-disconnect, and death followed by a new character.

## Repository layout

```
engine/upstream/      Angband 4.2.6 (submodule, commit f3082213b73f…), unmodified
engine/lib/           The game data: our fork of Angband's lib (edit this to change the game)
engine/adapter/src/   Headless frontend (C): main, protocol, snapshot, hooks, commands, store
engine/CMakeLists.txt Links upstream's OurCoreLib with the adapter
shared/protocol/      Protocol v1 TypeScript types (source of truth for the client)
bridge/               Node WebSocket bridge and engine process wrapper
client/               Vite + Three.js client (renderer, camera, sprites, input, ui, protocol)
client/src/wasm/      Browser-only engine: worker, Emscripten host, transport
tests/engine/         Native engine integration tests
scripts/              build-engine.sh, build-web.ts, dev.ts
docs/                 Architecture, protocol, limitations
```

## Game data (engine/lib)

The game's data lives in [engine/lib](engine/lib): our own fork of Angband
4.2.6's `lib` (monsters, items, artifacts, classes, races, dungeon profiles,
stores, help text and the Gervais tile mapping). Edit it directly to change
the game. The engine code still comes unmodified from the upstream
submodule.

The fork started from upstream's data with every Tolkien-specific name
replaced (Sauron became Azazel, hobbits became halflings, Andúril became
Caliburn, and so on; the full list is
[docs/renames-from-tolkien.txt](docs/renames-from-tolkien.txt)). The engine
tests check that no Tolkien names creep back in, and that every monster in
the tile prefs exists. Angband stops reading a pref file at the first
unknown name, which would silently drop the tiles after it.

Angband savefiles store monster, race and artifact names, so renaming one of
those makes older saves unloadable.

## Updating Angband

The upstream checkout is a pristine submodule. To move to a newer release:

```bash
git -C engine/upstream fetch --tags && git -C engine/upstream checkout <tag>
npm run build:engine && npm run test:engine
```

The data is a fork, so upstream data changes are ported by hand: review
`git -C engine/upstream diff <old-tag> <new-tag> -- lib/gamedata lib/tiles`
and apply what you want to `engine/lib`, renaming as in
docs/renames-from-tolkien.txt. The engine refuses to start if the data no
longer matches what the new code expects, and the tests catch stray names.

The adapter only uses public core interfaces: the command queue, events,
`game-input.h` hooks, `map_info()`, `player->cave`, and the `ui-prefs`
visual tables. See [docs/architecture.md](docs/architecture.md) for which
upstream functions it depends on.

## Licensing

See [LICENSES.md](LICENSES.md). In short, Angband is GPLv2 or the Angband
licence, the adapter that links it is GPLv2, and the Gervais tiles are
CC BY 3.0 with attribution.
