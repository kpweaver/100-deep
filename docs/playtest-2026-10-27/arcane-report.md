# arcane playtest report (Mage, Necromancer, Ranger)

Tester: arcane. Build: c0d72b6 (frozen worktree, native bridge with cheats, port 4312).

## Summary

Mage, Necromancer and Ranger each created through the real birth screens and played for real in town and DL1-3, then pushed to clvl 29-50 and DL25-100 with cheats (every book, every spell cast, Azazel on DL99 and Abaddon on DL100 fought). Two engine-killing problems are Necromancer-specific (shapechanges crash on any item/spell command; paralysis during Command live-locks the engine). Three major problems hit everyone: dark level arrivals, the auto-explore flood loop, and the death-screen new-character use-after-free. Scripts are in playtest/arcane/ (sNNN.mjs), screenshots in playtest/arcane/shots/.

| # | Severity | Class | Issue |
|---|---|---|---|
| A12 | CRASH | Necro (all shapechangers) | Casting / quaffing / reading / any item command while in Bat Form segfaults the engine (textui get_char() called headless); rolls back to last autosave; no way to change back |
| A17 | CRASH | Necro | Paralysed while a monster is under Command => engine live-locks at 100% CPU (CMD_SLEEP -> CMD_COMMAND_MONSTER, no energy); permanent black screen, no watchdog. Reproduced |
| A8 | MAJOR | all | Auto-explore loops forever when the path is silently blocked (closed door with unknown far side, known trap); floods the bridge, inputs dropped |
| A9 | MAJOR | all | New level often arrives fully dark (nothing known, Light 0, can't read/cast/explore) until you step; always from the town at night |
| A11 | MAJOR | all | Death screen -> New character ignores chosen race/class (got Kobold Warrior twice): use-after-free of race/class pointers across engine_reinit |
| A1 | minor | casters | Store Buy tab: can't examine items / browse books before buying |
| A2 | minor | all | "Unexpected 'options' while in a store" engine error in message log after reload |
| A3 | minor | all | Message history lost on every reload |
| A10 | minor | all | Look/Aim cursor shows "Unknown grid" for a visible monster on an unknown grid (infravision, ESP, unlight) |
| A13 | minor | Necro | Bat Form: weapon still drawn and swinging, HUD shows no shape, menus offer item actions |
| A14 | minor | Ranger/all | Item prompts ignore @f1/@m1 inscriptions |
| A21 | minor | all (archers/casters) | Option use_old_target is exposed but ignored: aim prompt always opens |
| A22 | minor | all | Quantity prompt: typing 5 gives 15 (digits appended to default 1); store picker takes no digits |
| A16 | minor | Mage/casters | Combined spell list: no letters past 26th spell; m-book-spell muscle memory casts wrong spell |
| A23 | polish | Ranger | Aim bar offers "Fire 40 Arrows" with a crossbow (no usable ammo) |
| A4 | polish | all | Aim prompt rows for identical monsters indistinguishable, no 3D highlight |
| A5 | polish | all | Monster list names truncated ("squint-eyed rogu") |
| A6 | polish | all | Birth screens give no race/class info |
| A7 | polish | all | "Something is here." when explore refused due to a monster in view |
| A15 | polish | all | View doesn't turn toward an off-screen target when firing/throwing/casting |
| A18 | polish | Necro | Typo "Your resume control of your own body." |
| A19 | polish | all | Cast/shoot animations fire on command send (also on cancel/failure/no target) |
| A20 | polish | all | Objects on a monster's grid drawn over the monster sprite |

## Issues in detail

### A1. Store: items in the Buy tab cannot be examined (minor)
- Steps: enter the Bookseller (or any shop), focus "[Attacks and Knowledge]" in the Buy tab, press Shift+Enter (the footer of the Gear screen advertises Shift+Enter = Examine).
- Expected: like stock Angband (`x`/`l` in a store), see the item description; for a magic book, the spell list, so you know what you are paying 400/1600 AU for.
- Actual: nothing happens. `StoreLayer`'s `onSecondary` only queries in sell mode (client/src/ui/screens.ts:497-499), and the store footer offers no Examine hint at all.
- Frontend gap. Spell casters cannot preview book contents before buying.

### A2. "Unexpected 'options' while in a store" shown in the message log after a reload (minor)
- Steps: be inside any shop, reload the page (or reconnect).
- Actual: the message bar/log shows `Unexpected 'options' while in a store`, and the console shows `[engine error] in_store`. Same when a prompt is open at reload: `prompt_pending ... 'options' ignored` (console). The client sends its saved interface options on every connect, regardless of the engine's modal state, so the options are silently dropped in those cases.
- Expected: no engine error text in the player's message log; options applied once the store/prompt closes.
- Frontend bug (client sends `options` on hello; see `engineOptions` in client/src/app.ts).

### A3. Message history (Ctrl+P) is lost on every reload (minor)
- Steps: play a while, reload the page, press Ctrl+P.
- Expected: stock Angband keeps the message history in the savefile; the history should survive a reload/save-load.
- Actual: only messages since the page loaded are shown. `openMessageLog` reads the client-side `ctx.state.log` (client/src/ui/screens.ts:394-400); the engine's message buffer is never exported on resync.

### A4. Aim prompt: identical monsters are indistinguishable (polish)
- Steps: in town with several urchins adjacent, cast Magic Missile (`m` `a`).
- Actual: the list shows "A filthy street urchin 1 away" three times (screenshot shots/07-aim.png). There is no direction (the monster list subwindow shows "2 N 4 W") and nothing is highlighted in the 3D view while a row is focused, so you cannot tell which one you will shoot.
- Suggest: add the compass offset to each row and/or highlight the focused monster's sprite.

### A5. Monster list subwindow truncates names (polish)
- "1 squint-eyed rogu (asleep) 5 S 2 W", "1 white icky thin (asleep)", "battle-scarred v (asleep)" (shots/02-start.png). The stock subwindow width is too narrow for the panel; there is room in the panel for the full name.

### A6. Birth screens give no information (polish)
- Race and class menus list names only: no stat modifiers, hit dice, infravision, class description or spell realm, and no point-buy (documented in limitations.md). A new player picking "Highborn" or "Blackguard" has nothing to go on. (The odd Kobold Warrior I got from the death screen turned out to be A11.)

### A7. Explore / navigate refusal message "Something is here." (polish, engine-authentic)
- Pressing `x` (auto-explore) or navigate-to-stairs with any monster in view prints "Something is here." (upstream cmd-cave.c:1429). With a monster 15+ squares away and not obvious on screen, players will not understand why exploring does nothing. Engine wording, but the frontend could explain ("A monster is in view").

### A8. Auto-explore gets stuck in an endless silent loop at a closed door, floods the bridge, inputs dropped (MAJOR)
- Steps (Merlin, High-Elf Mage, DL1): explore until the nearest unknown area lies behind a closed door whose far side is unknown (here: door directly east of the player at 98,37, squares beyond it unknown). Press `x`.
- Actual: nothing moves, the action bar shows "x Exploring..." indefinitely, and after a second the message "Slow down: some inputs were dropped." appears. Instrumenting `thang.conn.send` showed **64 messages in 3 seconds** from a single `x` press. Other keys pressed meanwhile are dropped by the bridge's rate limiter (bridge/src/session.ts:124-137). Pressing Esc ends it. Screenshot: shots/31-stuck.png, map shots/31-map.png.
- Cause: the engine's `run_step()` (upstream player-path.c ~1922-1957) only auto-opens a closed door on the path when all 9 squares around it are known; otherwise it hits "known impassable terrain" and returns via `disturb()` *without a message and without moving*. The same silent abort happens when the next step holds a visible object (player-path.c ~1980). `App.continueExplore()` (client/src/app.ts:789-810) only stops on a message, a visible monster, a prompt or a phase change, so it re-queues `explore` every frame forever.
- Expected: stop auto-explore when a step produced no movement and no message (and ideally say why / open the door). In stock Angband the single command would just do nothing.
- Second trigger, same loop (Ranger, DL1): the only path to unexplored territory leads over a known trap (a gas trap 1 square away). `move_player()` (upstream cmd-cave.c:1084-1086) "stops running before known traps" with a silent `disturb()`. One `x` press again sent 63 messages in 3 s, "Exploring..." forever, inputs dropped (shots/85-trap-loop.png).
- Frontend bug triggered by an engine quirk. Workaround: open the door by hand (`o` or walk into it), disarm the trap (`D`).

### A9. Arriving on a new level you are often in total darkness: nothing known, Light 0, cannot read or cast, explore says "No apparent path" (MAJOR)
- Steps: carry a lit Wooden Torch (Light radius 2). Take any staircase. Reproduction rates measured with `go_up`/`go_down` trips:
  - town at **night** -> DL1: **6/6** arrivals dark; town in daytime -> DL1: 0/6.
  - dungeon -> dungeon: 2/8 dark at DL1 <-> DL2 (High-Elf Mage, torch); 0/12 at DL19 <-> DL20 (Gnome Mage, torch).
  - Necromancer (no light source, so the light radius never changes): town (day) <-> DL1: 3/8 arrivals dark, including the very first descent (shots/60-necro-dl1.png).
  - Teleport Level (3/3) and Deep Descent (3/3) arrivals were fine.
- Actual on a "dark" arrival: the 3D view is solid black, the minimap and map (M) show only the player arrow, status bar "Light 0" and "Unknown grid" under you, although `lightRadius` is 2 (screenshots shots/43-view.png, shots/42-map.png). Holding (`,`) or resting for turns does not fix it; `x` prints "No apparent path for exploration.", navigate-to-stairs prints "No known path", reading a scroll prints "You have no light to read by.", casting fails ("You cannot see!"), and walking into walls gives "You feel a wall blocking your way". Only taking a step re-computes the view. My bot burned 600 commands on one such level before I noticed.
- Cause: the stock textui registers `new_level_display_update()` on `EVENT_NEW_LEVEL_DISPLAY` (upstream ui-display.c:2508-2531), which sets `PU_TORCH | PU_UPDATE_VIEW | PU_DISTANCE` (+ PU_BONUS etc.). The core's `on_new_level()` (game-world.c:1002-1038) only sets `PU_BONUS | PU_HP | PU_SPELLS | PU_INVEN`, so the view is recomputed only when something else happens to request it (e.g. `calc_light()` noticing the light radius changed: 0 in the daylit town -> 2 in the dungeon, which is why daytime departures work). The adapter's only handlers for that event are `ev_autosave` (main-headless.c:185) and `ev_new_level` (snapshot.c:147-150), neither of which requests a view update.
- Expected: the surroundings lit by your torch are visible immediately on arrival, as in stock Angband.
- Adapter bug.

### A10. Look/Aim cursor says "Unknown grid" for a monster you can see in the dark (minor)
- Steps (High-Elf Mage, infravision 40 ft): in a corridor, a small kobold 3 squares away is visible by infravision (beyond the torch radius) and is listed in the monster list. Press `*`, then Space to step to it.
- Actual: the aim bar reads "Unknown grid · 3 away · out of sight" (shots/29-aim2.png); the monster is not named. Shift+Enter still targets it (`target.monster` = 18), so the engine knows it is a valid target.
- Cause: `describeGrid()` returns 'Unknown grid' before looking for a monster when the grid's feature is unknown (client/src/ui/targeting.ts:34-35). Affects every monster seen by infravision, telepathy, detection or a Necromancer's unlight on unremembered grids. Same function feeds the map screen's info line.
- Expected: name the monster (as the stock look command does), e.g. "A small kobold (unhurt) · 3 away".
- Related: on a remembered-but-unlit grid the bar says "A white jelly (somewhat damaged) · open floor · 4 away · **out of sight**" for a monster the Necromancer can plainly see (listed under "You can see 1 monster"); "out of sight" comes from the grid's light, not from the monster's visibility.

### A11. New character from the death screen ignores your race/class choice (use-after-free in the adapter) (MAJOR)
- Steps: die. On the death screen choose "New character", pick e.g. High-Elf, Mage (or Kobold, Necromancer), any name, Point-based.
- Expected: the race and class you chose (the stats screen even says "Nekros the Kobold Necromancer", shots/57-stats.png).
- Actual: twice in a row I got a **Kobold Warrior** (Dagger, Soft Leather Armour, no spell book): once after choosing High-Elf Mage, once after choosing Kobold Necromancer. From the title screen the same choices work.
- Cause: `handle_new_game()` (engine/adapter/src/main-headless.c:265-266) looks up `struct player_race *r` / `struct player_class *c` in the live data lists, and only then calls `engine_reinit()` (line 279) when `character_generated || session_phase != PHASE_MENU` (true on the death screen). `engine_reinit()` runs `cleanup_angband()` + `init_angband()`, which frees and re-parses the race/class lists, so `r->ridx` and `c->cidx` (lines 287, 289) are read from freed memory. This is a use-after-free: undefined behaviour, could crash, and the WASM build shares the code. Fix direction: do the reinit before the lookups.
- Workaround: choose Quit on the death screen (back to the title), then New character from the title screen.

### A12. CRASH: any item/spell command while shapechanged (Bat Form) kills the engine (SIGSEGV); progress since the last level change is lost (CRASH/BLOCKER)
- Steps: Necromancer clvl 3+ (Morwen, Highborn). Cast Bat Form ("You assume the shape of a bat! Your gear merges into your body."). Press `m` (or send `{type:'command',action:'cast'}`).
- Expected (stock 4.2): message "You cannot do this while in bat form." and the prompt "Change back and cast (y/n) or (r)eturn to normal?" - this prompt is also **the only way to return to normal shape**.
- Actual: the engine segfaults. The bridge logs `engine local exited (code=null, signal=SIGSEGV)`, the client shows "Engine restarted." and reloads the last savefile, which is the autosave from the last level change: my Necromancer went from clvl 6 back to clvl 2 (and 599 AU back to 114). Reproduced 3/3.
- macOS crash reports (~/Library/Logs/DiagnosticReports/angband-headless-2026-10-27-011259.ips etc.):
  `Term_erase < c_prt < prt < get_char (ui-input.c:1327) < player_get_resume_normal_shape (player-util.c:1030) < do_cmd_cast (cmd-obj.c:1118) < process_command < ... < run_world (main-headless.c:363)`, EXC_BAD_ACCESS at 0x38.
- Cause: `player_get_resume_normal_shape()` calls the textui's `get_char()` directly (it is not a `game-input.h` hook), which draws on a terminal that does not exist in the headless adapter. The same function guards **17 commands**: cmd-obj.c lines 157, 187, 243, 276, 365, 743, 768, 802, 836, 870, 921, 942, 1076, 1118, 1247 (inscribe/uninscribe, take off, wield, drop, read, quaff, eat, aim, use, zap, activate, refill, use-any, cast, study...) and player-attack.c 1318/1373 (fire, throw). The crash-report folder shows the same stack for do_cmd_quaff_potion and do_cmd_read_scroll too (from other testers' sessions as well), so this hits every shapechanger (Necromancer Bat/Vampire/Dire wolf Form, Druid, Blackguard...). The adapter needs to provide its own replacement prompt (e.g. a `choice` prompt with y / r / n) for this path.
- Consequences: a shapechanged character can never change back without crashing; every crash silently rolls the game back to the last level-change autosave.

### A13. Bat Form presentation: weapon still in hand, no shape indicator, menus still offer item/spell actions (minor, frontend)
- Steps: cast Bat Form ("Your gear merges into your body."), look at the view, attack something.
- Actual: the Main Gauche is still drawn in first person and thrusts on every bite (shots/76-bat-bite2.png, shots/71-batform.png). The HUD still reads "Highborn Necromancer Curser"; nothing says you are a bat (stock 4.2's sidebar replaces the title with the shape name and blanks race/class: ui-display.c:172-185, 553-580). The action bar keeps "U Cast & use", the Use menu lists Cast/Quaff/Read..., and the Gear screen lists Throw/Cast/Drop for every item although "While shapechanged you cannot use items" (and choosing any of them crashes, see A12).
- `hud.weapon` has no notion of shape (client/src/ui/weapon.ts) and the snapshot exports no shape field (engine/adapter/src/snapshot.c player block), so the client cannot know.
- Expected: hide the weapon (show claws/wings or nothing), show "Bat" in the HUD, and offer "Change back" instead of item actions.

### A14. Item prompts ignore `@f1`-style inscriptions (minor)
- Steps (Ranger): inscribe a quiver stack `{@f1}` (works: "Inscribing 40 Arrows", quiver re-sorted), press `f`, then `1`.
- Expected (stock): `1` picks the stack inscribed `@f1` (the same for `@m1` books, `@q1` potions, `@r1` scrolls, `@v1` throwing weapons...).
- Actual: nothing happens; only the a-z row letters work. The prompt menu (client/src/ui/prompt-layer.ts `list()`/`ListMenu`) has no digit handling, and the engine's item prompt is answered by handle only. Players who rely on inscriptions (a core Angband habit, especially for archers) cannot use them.

### A15. Firing / throwing / casting at an off-screen target does not turn the view (polish)
- Steps: face north, cast Magic Missile, fire (`f`/`h`/Tab) or throw (`v`) at a monster to the west.
- Actual: the camera stays put, so you see neither the missile nor the hit (shots/92-throw-fly.png: the target ant is 6 W, the screen shows the corridor north). Only Space/- target cycling turns the view (`faceTargetSoon`, client/src/app.ts:791-799).
- Suggest turning toward the target (as the cycling already does) when a ranged command resolves.

### A16. Combined cast menu: spells past the 26th have no letter, and stock "m-book-spell" key sequences cast the wrong spell (minor)
- Steps: Mage with all five books (30 learned spells). Press `m`.
- Actual: one list of all 30 spells from every book (shots/113-banish-prompt.png), lettered a-z; Dimension Door, Thrust Away, Shock Wave... beyond `z` have no letter (`ListMenu` only letters indexes < 26, client/src/ui/list-menu.ts:76). There are no book headings. Stock Angband asks for the book first, so veterans type `m` `b` `c` (book b, spell c): here `b` immediately casts the 2nd spell overall (Light Room) and `c` then runs the next command (Close). I cast Teleport Other at a troll while trying to type Banishment's letter.
- The single prompt is a deliberate adapter choice (engine/adapter/src/hooks.c:458-461), but it needs either per-book letters / headings or a book step to stay keyboard-friendly.

### A17. HANG: being paralysed while a monster is under your Command live-locks the engine at 100% CPU; the page never loads again (CRASH/BLOCKER, reproduced)
- Deterministic repro (Human Necromancer clvl 50 "Paraly", DL20, script playtest/arcane/s170.mjs): teleport into a room, summon a few paralysing monsters next to you (ghoul, ghast, carrion crawler), cast Command on one of the ghouls ("The ghoul falls under your spell!", status "Cmd"), then move (which moves the ghoul). As soon as another ghoul/ghast/crawler paralyses you, the engine stops answering: `ps` shows it at 100% CPU, no more `state` messages, the next page load times out on a black screen. First hit by accident earlier in the night (the engine spun for over an hour), then reproduced twice on purpose.
- Stack from SIGABRT (DiagnosticReports/angband-headless-2026-10-27-023351.ips and -034741.ips):
  `get_commanded_monster (mon-util.c:188-192) < do_cmd_mon_command (cmd-cave.c:1790) < process_command (cmd-core.c:389) < cmdq_pop (cmd-core.c:421) < process_player (game-world.c:984) < run_game_loop (game-world.c:1206) < run_world (main-headless.c:363)`
- Cause (upstream 4.2.6 logic, so the stock game would hang the same way): `process_player()`'s do/while loop (game-world.c:940-993) pushes `CMD_SLEEP` on every iteration while `TMD_PARALYZED` is set (line 966-968). `process_command()` turns *every* command into `CMD_COMMAND_MONSTER` while `TMD_COMMAND` is active (cmd-core.c:334-335); `do_cmd_mon_command()` has no case for CMD_SLEEP, so it prints "Valid commands: move, stand still, 'd'rop, 'm'agic, or 'r'elease." and returns without using energy (cmd-cave.c:1981-1983). Energy use stays 0, so the loop never exits and never asks for input.
- Impact here is worse than a stock freeze: the bridge only restarts an engine that exits, it has no watchdog for a live-locked one, so the player gets a permanent black screen until the server is restarted (in the WASM build the tab freezes). After killing it, the auto-restart reloads the last autosave (progress since the last level change lost).
- Other Command behaviour seen (works, but no frontend affordance): while commanding, move keys move the monster (relative to your facing), `m` makes it cast (aim prompt), `d` drop, `r` release; everything else, including the debug summon cheat, prints "Valid commands...". The HUD only shows "Cmd" and nothing tells the player that `r` (read) means "release".

### A18. Typo in game data: "Your resume control of your own body." (polish, upstream text)
- Shown when Command ends. engine/lib/gamedata/player_timed.txt:524 (also upstream). Should be "You resume control...".

### A19. Cast/fire animations play when the command is sent, not when it happens (polish)
- `App.send()` triggers `hud.weapon.cast()` for every outgoing `cast` and `hud.weapon.shoot()` for every `fire`/`fire_at_nearest` (client/src/app.ts:455-459), before the engine has even asked which spell. So the casting hand glows and the weapon dips when you open the spell menu and then press Esc, when the engine answers "You cannot see!" / "You are too confused!" / "You do not have enough mana", and in Command mode; the bow is raised and drawn for "No Available Target." (seen while hallucinating at DL99, shots/102-fight-16.png) and "You have nothing to fire with.". Throwing (`v`) has no animation at all.
- Suggest driving these from the engine's result (projection effects or the turn actually passing).

### A20. Objects on a monster's square are drawn in front of the monster (polish)
- A bolt lying under a white jelly is drawn as a large sprite across the jelly's body (shots/xbow-1.png, sling-1.png). Stock map shows only the monster. Billboards for objects should sort behind (or hide under) a monster on the same grid.

### A21. The "Use old target by default" option (use_old_target) does nothing (minor)
- Steps: Options -> "Use old target by default" = Yes (the engine reports `use_old_target=true`). Target a monster (`'` / target_closest: `target = {monster: 78}`), then cast Nether Bolt (or fire, aim a wand).
- Expected (stock): no prompt; the bolt goes to the current target. Archers and casters rely on this to fire repeatedly with one key.
- Actual: the "Direction or target?" prompt still opens every time.
- Cause: stock implements the option inside the textui's `textui_get_aim_dir()` (upstream ui-input.c:1628). The adapter's `hook_get_aim_dir()` (engine/adapter/src/hooks.c:244-255) always prompts and never checks `OPT(player, use_old_target)`.
- Related polish: the Options screen lists several stock options that cannot have any effect in this frontend (solid_walls, hybrid_walls, view_yellow_light, animate_flicker, center_player, highlight_player, mouse_movement, auto_more...).

### A22. Typing a number in a quantity prompt appends to the default "1": typing 5 drops 15 (minor)
- Steps: carry 30 Flasks of oil, `d`, choose the flasks (prompt "quantity", max 30, default 1), type `5`, Enter.
- Expected: drop 5 (stock: typing replaces the default).
- Actual: the box shows **15** and "You drop 15 Flasks of oil" (shots/157-qty.png). With a smaller stack the value silently clamps to the max (typing 5 on a stack of 3 dropped all 3).
- Cause: `this.quantity = Math.min(max, Math.max(1, Number(`${this.quantity}${ev.key}`.slice(-4))))` (client/src/ui/prompt-layer.ts, quantity branch of `handleInput`) concatenates onto the pre-filled default. There is also no Backspace to correct it (Backspace is "back" and cancels), and the store's own buy/sell quantity picker (screens.ts `QtyLayer`) accepts no digits at all.

### A23. Aim mode offers "t Fire 40 Arrows" with a crossbow wielded (polish)
- Steps (Ranger): wield a Light Crossbow, run out of bolts (quiver now holds only arrows), press `*`.
- Actual: the Aim bar says "t Fire 40 Arrows (1d4)"; pressing `t` gives "You have no suitable ammunition to fire." (shots/164-aim-xbow-arrows.png).
- Cause: `AimLayer.launcher()` only checks that a launcher is worn and the quiver is non-empty, then always fires `quiver[0]` (client/src/ui/targeting.ts:237-275). It should pick ammo the launcher can use (the engine sorts usable ammo first, so this only shows when none is usable) and otherwise fall back to Throw.

## Tested and working

Mage (Gnome "Arcanist" and High-Elf "Merlin" played for real; High-Elf "Radagast" via cheats):
- Birth screens from the title (race/class/name/points or roll), letter keys and arrows.
- Town: walking/pathfind to shops, buying with the quantity picker (arrows), Home drop/take, selling (birth_no_selling "You had ..."), Black Market purchase, bookseller stock.
- Study with `S` (choose spell), `m` cast menu with spell info/description pane, `b` browse, fail messages, "not enough mana - attempt anyway?" confirm.
- Magic Missile through the aim prompt (monster list, "At current target", "In a direction..." grid), Aim layer (`*`, Space next target, Shift+Enter set target), target ring, health bar.
- Every Mage spell cast at least once (L50): MM, Light Room, Find Traps/Doors/Stairs, Phase Door, Electric Arc, Detect Monsters, Fire Ball, Recharging (item prompt; backfire destroyed the wand, authentic), Identify Rune, Treasure Detection, Frost Bolt, Reveal Monsters, Acid Spray, Disable Traps/Destroy Doors, Teleport Self, Teleport Other, Resistance, Tap Magical Energy (item prompt), Mana Channel, Door Creation, Mana Bolt, Teleport Level (x3, arrivals fine), Detection, Dimension Door (location target set with target_location / Aim then "At current target": lands next to the grid), Thrust Away, Shock Wave, Explosion, Mana Storm, Mass Banishment. Bolt/ball/beam/arc effects render with correct colours (shots cap-*.png, az7-*.png).
- Blindness (can't read/cast, "U" menu hides Cast), confusion ("You are too confused!"), hallucination, starvation/fainting, torch burn-out and re-wield, scrolls/potions identified by use, Word of Recall both ways, curse "Oops! It feels deathly cold!" on the Ring of Solomon, Remove Curse ("no curses to remove").
- DL99 fights with Azazel (Mana Storm, his teleports, nether/darkness storms, summons) and DL100 with Abaddon (laughs off Mana Storm); no hangs.

Necromancer (Kobold "Nekros", Highborn "Morwen"):
- Unlight view: no torch, adjacent squares in cold grey light, lit rooms still warm, monsters visible in the dark (shots/62-necro-explore.png); Create Darkness darkens nearby squares; fail rates jump 5% -> 21% when standing on a lit square (authentic unlight penalty).
- Nether Bolt, Sense Invisible, Create Darkness, Read Minds, Bat Form (but see A12/A13).

Ranger (Elf "Legolin"):
- `f` (ammo prompt then aim prompt), `h` fire at nearest, Tab, Aim `*` + `t`, extra shots (~5 game turns per shot at clvl 29 = 1.9 shots/turn as the character sheet says), arrow breakage, walking over arrows auto-picks them into the quiver, quiver tab (`|`), 40-per-slot quiver stacks, inscriptions `{@f1}` re-sort the quiver, throwing flasks of oil and arrows with `v`, bow sprite drawn while firing.
- Ranger spells: Remove Hunger, Detect Life, Herbal Curing, Resist Poison, Turn Stone to Mud (direction grid), Sense Surroundings, Cover Tracks, Create Arrows (needs a staff), Haste Self, Decoy, Brand Ammunition ("The branding failed" on ego ammo), Phial activation.

Real (non-cheat) early game reached: Mage town + DL1-3 (two characters died on DL2/DL3: dark elven priest, invisible poisoner), Necromancer town + DL1-2 (one killed by a summoned Grip, the second reached clvl 6 on DL2), Ranger town + DL1-3 (clvl 4). Mage killed Fang, Farmer Hayward's Dog with Magic Missile + Potion of Speed on DL1.

Also checked and working:
- Banishment's symbol prompt (`key` prompt -> text box, `k` removed the kobolds), Dimension Door with a location target, Teleport Other, Thrust Away moves the monster sprite, Vampire Strike and Shadow Shift move the camera correctly.
- Necromancer Command: move keys steer the monster, `m` makes it cast (aim prompt), `d` drop, `r` releases ("...no longer under your control").
- Monster recall (Look -> Enter, 3 pages), level feeling (Ctrl+F), character sheet, browse from the Gear menu (spell table + descriptions), Identify Rune (item prompt), Recharging backfire, Use menu and Commands menu cast paths.
- Crossbow / sling / bow sprites and firing, Iron Shots and Bolts, throwing an axe, engine re-sorting the quiver for the wielded launcher.
- Hallucination ("something strange", "No Available Target." for targeting, authentic), Black Breath, stat drain, Azazel's shapechange ("Serpent-Azazel").
- After every engine crash the client showed "Engine restarted." and resumed the savefile automatically.

