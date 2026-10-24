# Thangorodrim

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

```bash
git clone --recurse-submodules <this repo> && cd Thangorodrim
npm install
npm run build:engine      # builds build/engine/angband-headless
npm run dev               # bridge on :8787 + Vite on :5173
```

Open <http://localhost:5173>. Choose **New character**, or **Continue** if a
save exists.

Single-port production mode, where the bridge serves the built client:

```bash
npm start                 # builds engine + client, then http://127.0.0.1:8787
```

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
| Character sheet | C | — |
| Absolute 8-way walk | Numpad 1–9 | — |
| Pause / system menu (options, save, controls) | Esc | Start |
| Menus | ↑↓ + Enter, letter shortcuts a–z, Esc | D-pad/stick + A, B to go back |

Every implemented feature can be used without a mouse.

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
npm test                  # engine integration tests + client unit tests
npm run test:engine       # 15 tests against the real native engine
npm run test:client       # 12 isolated client unit tests (vitest)
```

The engine tests never use fabricated game state. They spawn the real
executable with a fixed seed and check movement, wall blocking, time
accounting, stairs, information restriction (no secret doors, fog of war),
Gervais tile mappings against the pref file, melee, item prompts, drop and
pick-up, error handling, consistency under rapid input, save/reload and
save-on-disconnect.

## Repository layout

```
engine/upstream/      Angband 4.2.6 (submodule, commit f3082213b73f…), unmodified
engine/adapter/src/   Headless frontend (C): main, protocol, snapshot, hooks, commands, store
engine/CMakeLists.txt Links upstream's OurCoreLib with the adapter
shared/protocol/      Protocol v1 TypeScript types (source of truth for the client)
bridge/               Node WebSocket bridge and engine process wrapper
client/               Vite + Three.js client (renderer, camera, sprites, input, ui, protocol)
tests/engine/         Native engine integration tests
scripts/              build-engine.sh, dev.ts
docs/                 Architecture, protocol, limitations
```

## Updating Angband

The upstream checkout is a pristine submodule. To move to a newer release:

```bash
git -C engine/upstream fetch --tags && git -C engine/upstream checkout <tag>
npm run build:engine && npm run test:engine
```

The adapter only uses public core interfaces: the command queue, events,
`game-input.h` hooks, `map_info()`, `player->cave`, and the `ui-prefs`
visual tables. See [docs/architecture.md](docs/architecture.md) for which
upstream functions it depends on.

## Licensing

See [LICENSES.md](LICENSES.md). In short, Angband is GPLv2 or the Angband
licence, the adapter that links it is GPLv2, and the Gervais tiles are
CC BY 3.0 with attribution.
