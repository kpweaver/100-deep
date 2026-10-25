# Known limitations and next steps

## Not yet accessible from the frontend

These systems all exist in the engine. Only the UI to reach them is missing.

- **Targeting arbitrary grids** (aiming a ball spell at an empty grid). Aim
  prompts offer targetable monsters, the current target and directions.
  `target_set_location` is not exposed.
- **The look command** as an interactive cursor. The map cursor shows what
  is known at a grid, and monster recall works for visible monsters, but
  there is no stepping through "interesting" grids like `l`/`x`.
- **Knowledge menus** (`~`): monster, object, artifact and rune knowledge
  browsers, and the character history and notes.
- **Point-buy stat editing** at birth (`CMD_BUY_STAT`/`CMD_SELL_STAT`): only
  the native default distribution or a roll. The birth options menu is
  accepted by the protocol (`birthOptions`) but has no UI yet.
- **Retire / suicide**, **wizard and debug commands** (deliberately never
  exposed), **keymaps and macros**, the **message recall search**, and the
  remaining **ignore menu** options (ignore by flavour, ego or quality; only
  "this item" is available).
- **Shapechange ability menus** (`view_abilities_hook` is a no-op).
- **Multiple savefiles**: one savefile per bridge (`THANG_SAVE`).
- **Rebinding controls** in the UI. Bindings live in
  `client/src/input/input-manager.ts`.

## Behavioural notes

- **Panel**: the engine is told the whole level is on screen. Targeting can
  therefore pick any visible monster in range, as with a stock frontend
  whose map window is large enough for the whole level.
- **Auto-explore** (`autoexplore_commands`) is an Angband interface option.
  The client enables it by default; you can change it under Options. The
  client re-issues `explore` after each step until a message arrives or a
  monster comes into view. Each step is still a native command.
- **Walking into a known closed door** sends `open` instead of `walk`, a
  client convenience equivalent to Angband's alter command. Disable it by
  using the quick menu if you want stock behaviour.
- **Running** happens inside one engine call, so the camera snaps to the end
  of a multi-grid run instead of animating each step.
- **Hallucination** is shown with random Gervais tiles chosen in the adapter.
  This uses the same method as the textui, with the RNG state restored
  afterwards.
- **Effects** (bolts, explosions) are animated after the engine has already
  resolved them, so they are cosmetic and never block input.
- In background browser tabs `requestAnimationFrame` is throttled, so
  animations finish instantly there, while command flow continues.

## Visual limitations

- Surfaces are simple procedural textures. There are no per-feature Gervais
  wall textures, because Gervais tiles are drawn for a top-down view.
- Doors, stairs, rubble and lava have simple geometry. Shops use their
  Gervais sign as a billboard.
- No dynamic shadows. Lighting is a torch point light sized by the engine's
  light radius, ambient light, and per-grid brightness baked from
  visibility.
- Monster sprites are spherical billboards (they tilt slightly when very
  close).

## Not tested

- **Physical controllers**: the Gamepad API path (standard mapping, Xbox and
  PlayStation layouts) is implemented, but this build was not tried with
  real hardware. Steam Deck is untested.
## Recommended next steps

1. Look/target cursor in 3D: highlight grids, cycle "interesting" things,
   target locations.
2. Knowledge menus, via the same virtual-terminal capture used for the
   subwindows (`panels.c`).
3. A birth screen with point-buy stats and the birth options page.
4. Rebinding UI and per-controller glyphs (Xbox vs PlayStation).
5. Per-step animation of runs and pathing, by streaming intermediate
   snapshots on `EVENT_PLAYERMOVED` (cosmetic only).
6. A WebAssembly build of the same adapter for a server-less web version.
