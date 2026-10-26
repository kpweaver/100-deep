# Known limitations and next steps

## Not yet accessible from the frontend

These systems all exist in the engine. Only the UI to reach them is missing.

- **Targeting arbitrary grids** (aiming a ball spell at an empty grid). Aim
  prompts offer targetable monsters, the current target and directions.
  `target_set_location` is not exposed.
- **Looking at arbitrary grids.** Examine (L / L3) steps through the
  visible monsters and objects with recall, and the map cursor shows what is
  known at any grid, but there is no free look cursor over terrain in 3D.
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

- **Deliberate departure from the stock map (dark silhouettes):** unknown
  grids that are inside your line of sight but unlit, such as a dark
  corridor leading to a lit room, are drawn as faint, featureless
  silhouettes of their terrain (mimics applied, so secret doors still look
  like granite). The stock game leaves these blank, so this reveals a little
  more, e.g. side openings in a dark corridor before your light reaches
  them. Silhouettes never count as known: the minimap, full map and
  contextual actions ignore them.

- Surfaces are simple procedural textures. There are no per-feature Gervais
  wall textures, because Gervais tiles are drawn for a top-down view.
- Doors, stairs, rubble and lava have simple geometry. Shops use their
  Gervais sign as a billboard.
- No dynamic shadows. Lighting is per grid square in steps (torch radius,
  Angband's room light, distance), so it does not show line-of-sight edges
  the way the stock map's colours do. Monsters and objects still appear
  exactly when Angband says they are visible.
- Monster sprites are spherical billboards (they tilt slightly when very
  close).

## Not tested

- **Physical controllers**: every button, the tap/hold on LB, hold-to-run
  and the on-screen keyboard were driven through the Gamepad API with a
  simulated standard-mapping pad, but not with real hardware. Steam Deck is
  untested.
## Recommended next steps

1. A free look/target cursor over grids in 3D (target locations, look at
   terrain).
2. Knowledge menus, via the same virtual-terminal capture used for the
   subwindows (`panels.c`).
3. A birth screen with point-buy stats and the birth options page.
4. A rebinding UI.
5. Per-step animation of runs and pathing, by streaming intermediate
   snapshots on `EVENT_PLAYERMOVED` (cosmetic only).
