# Architecture and engine investigation

This document records what we learned from Angband 4.2.6's source
(`engine/upstream`, commit `f3082213b73f`) and how the adapter is built on it.

## 1. How the stock game is structured

| Area | Where | Notes |
|---|---|---|
| Entry point | `src/main.c` | Parses args, `init_file_paths()`, picks a frontend module (`main-gcu.c`, `main-sdl2.c`, …), then `init_display(); init_angband(); textui_init(); play_game()`. |
| Game flow | `src/ui-game.c` `play_game()` / `start_game()` / `close_game()` | Load or birth, then loop `cmd_get_hook(CTX_GAME); run_game_loop();` until death or quit. This is UI layer code. |
| Main loop | `src/game-world.c` `run_game_loop()` | Processes the player's queued command, then monsters, world ticks every 10 game turns, energy, level changes. Returns when the player needs a new command. Running, resting and repeated commands re-queue themselves (`cmdq_push(CMD_RUN)`, `cmd_set_repeat`), so one call can cover many steps. |
| Commands | `src/cmd-core.[ch]` | `cmdq_push()` and typed args (`cmd_set_arg_direction/item/target/point/number/choice/string`). Handlers live in `cmd-cave.c`, `cmd-obj.c`, `cmd-pickup.c`, `player-attack.c`, `store.c`, `player-birth.c`. Missing or invalid args fall back to `game-input.h` hooks. |
| Input hooks | `src/game-input.[ch]` | Function pointers: `get_item_hook`, `get_aim_dir_hook`, `get_rep_dir_hook`, `get_check_hook`, `get_quantity_hook`, `get_string_hook`, `get_com_hook`, `get_spell(_from_book)_hook`, `get_curse_hook`, `get_effect_from_list_hook`, plus panel/map hooks. These are the engine→UI seam for "the command needs more input". |
| Events | `src/game-event.[ch]` | `EVENT_MESSAGE`, `EVENT_BOLT`, `EVENT_EXPLOSION`, `EVENT_MISSILE`, `EVENT_NEW_LEVEL_DISPLAY`, `EVENT_USE_STORE`, `EVENT_CHECK_INTERRUPT`, `EVENT_REFRESH`, … The core signals them; the textui draws in its handlers. |
| Map knowledge | `player->cave` (a `struct chunk`) | The player's remembered terrain, traps and object piles (known copies). `cave` is the true level. |
| Per-grid display | `src/cave-map.c` `map_info()` | Fills a `struct grid_data` (known feature with mimics applied, lighting, in-view, known trap, first known object kind, visible monster, hallucination) from `player->cave` and visibility flags. This is exactly what the stock map draws. |
| Tiles | `lib/tiles/list.txt`, `lib/tiles/gervais/*.prf`, `src/grafmode.c`, `src/ui-prefs.c` | Mode 3 = Gervais. `reset_visuals(true)` loads `graf-dvg.prf`, which fills `feat_x_attr/char`, `monster_x_attr/char`, `kind_x_attr/char`, `trap_x_attr/char`, `flavor_x_attr/char`. In graphics mode, `attr & 0x7f` is the atlas row and `char & 0x7f` the column. `%:` includes resolve via `current_graphics_mode->path`. |
| Saving | `src/savefile.c` `savefile_save/load`; `ui-game.c` `save_game()` | Autosave is triggered by `player->upkeep->autosave` and handled by the UI on `EVENT_NEW_LEVEL_DISPLAY`. |
| Tests | `src/tests/game/basic.c` | Upstream's own tests already drive the core headlessly with `cmdq_push()` + `run_game_loop()`. This confirmed the approach. |

### Coupling we had to work around

The command queue and events separate the core from the textui well, but not
completely:

- **Birth, game start, death and autosave** live in UI code (`ui-game.c`,
  `ui-birth.c`, `ui-display.c`). The adapter reimplements those *flows*,
  calling the same core functions in the same order (`CMD_BIRTH_*` commands,
  `prepare_next_level()`, `on_new_level()`, `death_knowledge()`,
  `savefile_save()`). It does not reimplement any rules.
- **Stores** run a modal menu inside the `EVENT_USE_STORE` handler, and the
  core removes store handlers after each visit (`event_remove_handler_type`).
  The adapter re-registers them before each game-loop run and runs a nested
  protocol loop in the handler, using `CMD_BUY/SELL/STASH/RETRIEVE` +
  `cmdq_pop(CTX_STORE)` exactly as `ui-store.c` does.
- **Visual tables** (`monster_x_attr` etc.) are owned by `ui-prefs.c`. The
  adapter calls `textui_prefs_init()` and `reset_visuals()`.
  `xtra-dvg.prf` tests `$RACE`/`$CLASS`, so, as in `ui_leave_init()`, the
  full set loads only once a character exists.
- **Panel hooks** (`get_panel`, `panel_contains`) affect targeting candidates
  (`target_get_monsters(…, restrict_to_panel)`) and some message wording. The
  client presents the whole level (minimap plus map), so the adapter reports
  the full level as the panel. This is equivalent to a stock frontend with a
  map window large enough to show the whole dungeon.
- **RNG use by display code**: `map_info()` and the textui's hallucination
  drawing call the game RNG. The adapter saves and restores the full
  WELL1024a state around every snapshot and query (`rng_save/rng_restore`),
  so the frontend cannot perturb outcomes, even indirectly.
- **`CMD_PATHFIND`** does no argument validation ("XXX-AS"). The adapter
  checks bounds and that the target grid is known. Pathing itself only uses
  the player's memory (`is_valid_pf`), so it cannot probe hidden terrain.

## 2. Integration strategy chosen

We evaluated three options:

1. **New `main-xxx.c` terminal frontend**: Angband renders text into a fake
   terminal and we scrape it. Rejected: lossy, no structured state, and it
   ties us to keymaps and menus.
2. **WebAssembly build**: possible later, but more toolchain risk for the
   first milestone, and the same adapter work is needed anyway.
3. **Headless executable linking the unmodified core (chosen)**: upstream's
   CMake already builds the core as an object library (`OurCoreLib`).
   `engine/CMakeLists.txt` includes upstream with `add_subdirectory(... EXCLUDE_FROM_ALL)`
   and links `$<TARGET_OBJECTS:OurCoreLib>` with our adapter sources. No
   upstream file is modified.

The native process speaks JSON lines on stdin/stdout. The Node bridge relays
them to a WebSocket and owns restarts. The client never sees anything the
adapter did not explicitly export.

## 3. Adapter modules (`engine/adapter/src`)

| File | Responsibility |
|---|---|
| `main-headless.c` | Arg parsing, path setup, init order (mirrors `main.c` + `textui_init()`), birth/load/death/save flows, main command loop, read-only queries (item info, monster recall, book browse). |
| `proto.c` | Transport. Protocol output goes to a private dup of stdout, and fd 1 is redirected to stderr so stray `printf`s can't corrupt the stream. Handles `hello` (resync) and `ping` everywhere, including inside prompts and stores. Saves on EOF. |
| `commands.c` | Maps protocol actions onto `cmd_code`s and native args. The textui-only conveniences (target cycling, `fire_at_nearest`, ignore-this-item, unignore toggle, level feeling) call the same core functions the textui calls. Prereq checks (`player_can_fire_prereq()` etc.) match `ui-game.c`'s command table. |
| `hooks.c` | Implements every `game-input.h` hook as a blocking prompt: sends a state, then the prompt, then waits for an answer with the matching id. Candidates come from native testers (`object_test`, `scan_floor`, `spell_collect_from_book` + filters, `target_get_monsters`), and answers are re-validated. Item choices also run `get_item_allow()` for `!x` inscriptions. |
| `snapshot.c` | State export with delta-encoded map (cache of last sent cell per grid), visible monsters, known object piles, player, status line, gear, target, store, messages and effects. Tile coordinates come from the visual tables. |
| `store.c` | Modal store loop (see above). |
| `panels.c` | Stock subwindows. It runs the textui's own subwindow functions (`monster_list_show_subwindow`, `object_list_show_subwindow`, `lore_show_subwindow`, `display_object_recall`, `display_player`) into offscreen virtual terminals (`term_init`) and exports the cells as colour runs plus tile glyphs. Panels are re-sent only when their content changes. |
| `json.c` | Small JSON writer and parser. |

## 4. Information restriction

What reaches the client, and why it is safe:

- **Terrain**: only `map_info()` output, i.e. `player->cave` features with
  mimics applied (secret doors look like granite). Grids that were never
  known are not sent, even on a full map refresh. Tests assert that no
  secret door is ever sent and that a new level starts with only the
  player's surroundings.
- **Monsters**: `monster_is_visible()` and not camouflaged. Monsters sensed
  only by detection or telepathy carry `inView: false`. While hallucinating,
  race, name and status are replaced as the textui does. Exact health is
  only given for the tracked monster (the stock health bar); everyone else
  gets the `look_mon_desc()` wording ("wounded, asleep").
- **Objects**: from the player's known piles. Unknown items appear as
  "unknown item/treasure", and ignored items are hidden.
- **Traps**: known, visible, untimed-out traps only.
- **Queries**: monster recall only for visible monsters, using the player's
  lore (not spoilers).

## 5. Client architecture (`client/src`)

- `protocol/connection.ts`: WebSocket with exponential back-off reconnect.
- `state/`: `GameState` mirrors engine messages, `KnownMap` stores
  feature/light/view arrays, and `features.ts` classifies Angband terrain
  flags into render shapes.
- `renderer/`: `dungeon-mesh.ts` builds instanced walls, floors, ceilings,
  doors, steps and rubble from the known map, with brightness baked into
  instance colours (in view vs remembered). `entities.ts` draws Gervais
  billboards with interpolation, `effects.ts` animates bolts and explosions
  from engine events, and `scene.ts` renders at full display resolution
  with MSAA, torch light sized by the engine's light radius, and fog. A
  low-resolution "retro pixel size" mode is optional. Lighting is a
  hybrid: terrain gets a warm torch light (sized by the engine's light
  radius), soft ambient light and distance fog on top of per-grid
  brightness baked from the engine's in-view/remembered state. Monsters,
  objects, traps and effects ignore lights and fog, so anything Angband
  shows is always drawn clearly.
- Facing during engine-driven movement (`camera/heading.ts`) follows the
  average of recent steps with hysteresis, so diagonal zig-zags don't swing
  the view.
- Text uses Angband's classic 8x16 bitmap font, converted pixel-for-pixel
  to a web font. UI sizes are multiples of 16px.
- Tile rendering: every Gervais tile gets its own 32×32 texture (no atlas
  bleeding). Textures use nearest filtering when magnified, so tile pixels
  stay crisp squares up close, and mipmaps plus anisotropic filtering when
  minified, so distant and grazing-angle surfaces stay stable. Transparent
  pixels have neighbouring colours dilated into them to avoid dark fringes,
  and sprites use alpha-to-coverage for smooth outlines.
- `camera/grid-camera.ts`: 8-way facing (presentational only) and
  interpolation towards engine-confirmed grids. Long jumps snap.
- `input/`: semantic actions, keyboard and Gamepad API (standard mapping),
  repeat handling and rumble.
- `ui/`: HUD, minimap, tile map, and a layer stack with controller-navigable
  list menus. `prompt-layer.ts` renders every engine prompt kind.
- `app.ts`: one command in flight at a time, with one buffered move; the
  contextual action picks among native commands; auto-explore repeats
  `explore` until a message or monster appears.

Grid (x, y) maps to world (x, 0, y), one unit per grid. Facing 0 is north
(−z).
