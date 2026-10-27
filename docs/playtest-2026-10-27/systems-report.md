# 100 Deep systems playtest report (tester: systems)

Build: /Users/kevinweaver/Dev/Thangorodrim-playtest @ c0d72b6, native bridge on port 4314 with THANG_CHEATS=1.
Driver: Playwright (Chromium 1243, headed off-screen, 1280x720 unless stated). Scripts: playtest/systems/s/*.mjs. Screenshots: playtest/systems/shots/.
Environment note: `playwright` was not installed under playtest/ as BRIEF.md says; I imported it from an existing install (~/Dev/TFFHelper/node_modules/playwright, v1.63, matching chromium-1243). The test character's town layout changes per character, so shop coordinates in early scripts only fit the first character.

## Summary table

| # | Severity | Issue |
|---|---|---|
| S13 | Crash/blocker class | New character after death (or new_game in play) ignores the chosen race/class — always Kobold Warrior; use-after-free of race/class after engine_reinit() |
| S6 | Major | "New character" silently overwrites a living saved character (single save slot, no confirmation) |
| S7 | Major | Engine aim prompts ignore 1-9, ', t, * from the keyboard; every wand/bolt needs "In a direction…" first |
| S9 | Major | Stores: Examine shows an internal error; store stock can't be examined before buying |
| S10 | Major | Stores/Home: equipment and quiver can't be sold or stashed |
| S14 | Major | Tab/RT autofight bumps walls when the nearest monster isn't in a straight line |
| S21 | Major | Winning: no victory screen, no retire, HUD title never shows WINNER |
| S3 | Major (new players) | Birth screens show no race/class info; rolled stats never shown, no reroll, no birth options |
| S23 | Minor (major on phones) | Hint bar clipped at both ends on narrow windows; phone HUD/character sheet overflow |
| S1, S2, S4, S5 | Minor/polish | Birth: empty name silently returns to class menu; Esc skips name; long/non-ASCII names fail silently (engine byte limit) |
| S8 | Minor | Controls: "swapped with" reported when the other action actually became unbound |
| S11 | Minor | Options (and debug/query) rejected while in a shop or prompt at page load: player's options not applied that session |
| S12 | Minor | Store quantity picker ignores gold/pack space, no digit entry |
| S15 | Minor (authentic) | Auto-explore refuses while any monster is in view, with the misleading "Something is here." |
| S17 | Minor/polish | No first-person feedback for blind/halluc/confused/paralysed |
| S18 | Minor | Experience drain not shown on the HUD |
| S22 | Minor | Message history lost on every reload |
| S24 | Minor | Command menu stays open after running a command |
| S25 | Minor | Quantity prompt appends typed digits to the default; Backspace cancels |
| S26 | Minor | Aim mode t/Enter throws when there is no launcher (stock: sets target) |
| S28 | Minor | Ignoring a pack item only takes effect after a game turn |
| S30 | Minor | Floor tab has no Pick up, offers Drop |
| S31 | Minor | Monster/item lists captured 40x22: names truncated, long lists cut, sidebar overflows |
| S16, S19, S20, S27, S29, S32 | Polish | Trap hint missing; inscription shown twice; controller name pick mismatch; irrelevant options listed; silent travel failure, recall glyph; direction cursor on dead centre |

Issue details follow in the order found, then a list of what worked.

## Issues

### S1. Empty name at birth silently drops you back to the class menu (minor)
Steps: New character > any race > any class > clear the suggested name > Enter.
Expected: either refuse with a message, or fall back to a default/random name (the code even has a `|| 'Adventurer'` fallback).
Actual: the name box closes and you are back on "Choose your class" with no feedback.
Cause: client/src/ui/screens.ts startBirth: `(v) => { if (!v) return; ... }` — `finish()` has already closed the text layer, and '' is falsy so the `'Adventurer'` fallback is dead for an empty string.

### S2. Esc on the "Ability scores" screen skips back past the name screen to the class menu (polish)
Steps: race > class > name > (Ability scores) Esc. You land on "Choose your class", the typed name is lost.
Cause: TextInputLayer closes itself before statsLayer opens (screens.ts startBirth), so it is not on the stack to return to.

### S3. Birth screens give no information to choose with (major for new players; design gap)
Race and class menus are bare lists: no stat modifiers, hit dice, infravision, class description, spell realm, etc. Stock Angband's birth screen shows all of this beside the list (ui-birth.c `race_help`/`class_help`). "Roll randomly" just starts the game: you never see the rolled stats, cannot reroll and cannot go back (stock: roll screen with r/reroll and Enter to accept). There are no birth options at all (connected stairs, force descend, persistent levels...), and only 12 hard-coded names for "random" names (stock uses the randname generator, `player_random_name`). Point-buy is a known limitation (docs/limitations.md).
Screenshots: shots/02-race.png, shots/02-class.png, shots/03-stats.png

### S4. Name length is measured in UTF-16 units, not bytes (minor)
The name box has maxlength 31; Angband's name buffer is 32 bytes (PLAYER_NAME_LEN). A name with accents/emoji ("Zoë 🐉 ...") fits in 31 UTF-16 units but is far more than 31 UTF-8 bytes; the engine then rejects it (see S5).

### S5. A long or non-ASCII name makes "New character" fail silently (minor)
Steps: title > New character > Human > Warrior > type `Zoë 🐉 the Very Long Named Kobo` (31 UTF-16 units, the box's max) > Enter > Point-based.
Expected: the name is accepted (or the box refuses the extra characters up front).
Actual: you are dumped back on the title screen with no message at all. The engine replied `error bad_birth "Invalid name"` (console only) because the UTF-8 form is >= 32 bytes (engine/adapter/src/main-headless.c:274). The client shows engine errors with `state.note`, which is invisible on the title screen (the HUD is hidden).
Fix idea: limit by UTF-8 byte length in the name box, and show birth errors on the title/birth screen.

### S6. "New character" overwrites a living character with no confirmation (major)
Steps: have a saved, living character > title (Continue is listed) > New character > race/class/name/stats.
Actual: the new character is created and saved over the old one immediately (main-headless.c handle_new_game calls `save_now()`); the old character is gone. There is no "This will delete <name>, level N. Continue?" prompt. There is only one save slot (THANG_SAVE), so this is unrecoverable. The title's Continue entry is labelled with the savefile name ("hero"), not the character, so it is not obvious what will be lost.

### S7. Engine aim prompts ignore direction keys, ' , t and * from the keyboard (major for keyboard play)
Steps: aim a wand (a, pick the wand) or cast a bolt; the "Direction or target?" prompt appears.
Expected (stock Angband and README "numpad moves in map directions"): pressing 1-9 fires in that direction, ' / t / 5 fires at the target, * cycles targets.
Actual: the prompt is a list (targets, "At current target", "In a direction…"). Digit keys, ', t and * do nothing; letters pick list rows. You must choose "In a direction…" and then press a digit (or move a cursor). Every wand/bolt therefore costs two extra keystrokes, and Angband muscle memory (`a` `a` `'`) silently does nothing. The direction sub-grid does accept digits (prompt-layer.ts handleInput only checks digits when `dirCursor` is set).
Screenshot: shots/09-aim-prompt.png
Cause: client/src/ui/prompt-layer.ts `case 'aim'` builds only a ListMenu; handleInput doesn't map digit keys/'/t to answers in list mode.

### S8. Controls: binding a key to an unbound action reports a swap that didn't happen (minor)
Steps: Controls > Inventory > Shift+Enter (clear) > Enter > press `e`.
Status line: "Inventory: e (swapped with Equipment)." Actually Equipment is now unbound (shows —); nothing was swapped because Inventory had no old key.
Cause: client/src/input/bindings.ts bindKey: `if (displaced && old[0] && old[0] !== id)` — when `old` is empty the displaced action just loses its key, but controls.ts still prints "swapped with".

### S9. Stores: Examine does nothing useful; store stock cannot be examined at all (major)
Steps: enter any shop > Sell/Give tab > Shift+Enter (footer of the inventory says Shift+Enter examines; the store footer shows no examine key at all).
Actual: the message log shows "Unexpected 'query' while in a store" (an internal protocol error shown to the player). On the Buy tab Shift+Enter does nothing, so you cannot read what a wand, staff, armour or Black Market item does before buying it. Stock Angband: `x`/`l` examines store stock and your own items in a store.
Cause: engine/adapter/src/store.c ev_use_store only accepts `command` messages (and save); `query` falls into the "Unexpected '%s' while in a store" branch. The StoreLayer only sends a query in sell mode (screens.ts StoreLayer onSecondary).

### S10. Stores: equipment and quiver can't be sold/given or stashed in the Home (major)
Steps: buy arrows/shots (they go to the quiver) or wear any item, open a shop's Sell/Give tab or the Home's Drop tab.
Actual: only pack items are listed. You cannot sell ammunition from the quiver, cannot sell the armour you're wearing, and cannot put quivered ammo or worn gear in the Home without first taking it off / moving it. Stock Angband (ui-store.c store_sell) uses USE_EQUIP | USE_INVEN | USE_FLOOR | USE_QUIVER.
Cause: engine/adapter/src/store.c store_write_state "sellable" loops only over `player->upkeep->inven`; client screens.ts StoreLayer.refresh filters `state.inventory`. (The engine-side store_sell handler would already accept an `equip:`/`quiver:` handle.)

### S11. "Unexpected 'options' while in a store" on every page load inside a shop (minor)
Steps: be in a shop, reload the page (or close and reopen the browser). The message log shows "Unexpected 'options' while in a store".
The client pushes interface options once per session after the first `game` state (app.ts afterState, `optionsPushed = true` even though it was refused), so the player's saved options (e.g. autoexplore_commands) are not applied for that session either. Same for `debug` (expected) and `query` (S9).

### S12. Store quantity picker ignores gold and pack space; no digit entry (minor)
Buying from a 40-stack offers "Buy how many? (max 40)" even with 50 AU; the engine then says "You cannot afford that purchase." Stock Angband caps the maximum at what you can afford/carry (store_purchase: `amt = MIN(amt, max affordable)`). The store picker (screens.ts StoreLayer.choose QtyLayer) also has no digit entry and no "max" key, unlike the engine quantity prompt (PageUp = max); buying 40 flasks takes four ↑ presses, fine, but buying 23 takes 2 ↑ + 3 →.

### S13. New character after death (or from inside a game) ignores the chosen race/class: you always get a Kobold Warrior — use-after-free in the engine (CRASH/BLOCKER-class)
Steps: die > death screen "New character" > Dwarf (f) > Priest (d) > name "Gimli Jr" > the stats screen correctly says "Gimli Jr the Dwarf Priest" > Point-based.
Expected: a Dwarf Priest. Actual: `player.race = "Kobold"`, `player.class = "Warrior"` (19 HP). Reproduced twice from the death screen (shots/21-after-death-newchar.png) and with a protocol `new_game` sent while in play (Gnome Necromancer -> Kobold Warrior). From the title screen after "Save and return to title" it works (High-Elf Ranger was correct), because that path skips the re-init.
Cause: engine/adapter/src/main-headless.c handle_new_game looks up `r = find_race(...)` and `c = find_class(...)` (lines ~264-265) and only then calls `engine_reinit()` (line 279), which runs `cleanup_angband()` + `init_angband()` and frees/reloads the race and class lists. `r->ridx` / `c->cidx` at lines 287/289 read freed memory. Here it happens to yield the first entries (Kobold is first in the engine's list, Warrior is... the fallback), but it is undefined behaviour and could crash the engine or pick anything, in the WASM build too. Fix: resolve the names (or copy ridx/cidx) after `engine_reinit()`.
This hits every player who dies and starts again without reloading the page.

### S14. Autofight (Tab / RT) walks into walls when the nearest monster isn't in a straight line (major)
Steps: DL12, a yellow mushroom patch visible down a corridor that bends (shots/33-explore-end.png). Press Tab repeatedly.
Actual: "There is a wall in the way! (x30)" — each press turns the camera to face the wall and bumps it (no game time passes, but nothing happens). For a caster without a launcher this is the only thing Tab does.
Expected: path toward the monster (the engine has pathfinding: `pathfind`/`path_nearest_*`), or say "No clear path".
Cause: client/src/app.ts attack(): `dx = Math.sign(near.x - p.x), dy = Math.sign(near.y - p.y)` then walk that way, with no passability check.
Related: the hint says "Fire" for characters with no launcher (it means "melee/close in"); for spellcasters Tab never casts.

### S15. Auto-explore stops forever while any (even stationary, distant) monster is in view, with the message "Something is here." (minor; authentic engine text)
Steps: explore until a mushroom patch ~20 grids away is in view; press x repeatedly: "Something is here." every time, no movement.
This is stock 4.2.6 behaviour (cmd-cave.c do_cmd_explore: `if (player_has_monster_in_view(player)) msg("Something is here.")`), so not a frontend bug, but the message is misleading ("here" suggests an item underfoot) and combined with S14 a caster has no one-button way forward. The client could replace or explain the message (e.g. "A monster is in view") since it already checks `monsters.some(inView)` for continuing explore.

### S16. Facing a known trap: Space disarms, but the hint bar shows no "Disarm" action (polish)
app.ts updateHints has no case for a trap ahead, although interact() does `disarm` for it (app.ts:550). The player has no cue that Space will disarm.

### S17. No first-person feedback for blindness, hallucination, confusion or paralysis (minor/polish)
While Blind the 3D view and minimap keep drawing the remembered level exactly as before (shots/39-status-many.png); only the small "Blind" chip says otherwise. Hallucination only shows on monster/object sprites. A darkened/blurred view for Blind, a tint for Halluc/Confused, and a "Paralysed" banner would make these states readable at a glance (Orbrun-style frontends typically do this). Not a rules issue.

Not a bug (for the record): eating a cheat-created "Mushroom of Turbulence" prints "Bad effect passed to effect_do(). Please report this bug." — the kind has no effect and `#alloc` is commented out in both upstream and the fork (engine/lib/gamedata/object.txt:585), so it can't appear in normal play.

### S18. Experience drain is invisible on the HUD (minor)
Steps: get touched by a grave wight (EXP_20) or wear the Ring of Solomon. `exp` drops below `maxExp` (205000 -> 200835 in my test) but the HUD still shows "LEVEL" in capitals and the plain xp figure.
Stock (ui-display.c prt_exp): the label becomes "Exp" in yellow whenever `exp < max_exp`, so you know to drink Restore Life Levels. The client only marks a drained *level* (hud.ts: `p.level >= p.maxLevel ? 'LEVEL' : 'Level'`). The protocol already sends `maxExp`.

### S19. Inscriptions are shown twice in the inventory (polish)
Inscribe rations with `@q`: the row reads "3 Rations of Food {@q} {@q}" — once in the engine's object name, once more as the small detail text (screens.ts InventoryLayer.refresh adds `detail: {inscription}`). shots/28-inscription-dup.png. The item detail pane also shows the raw tval ("food").

### S20. Controller name entry shows one random name in the box but A picks a different one (polish)
With a controller, "Name your character" pre-fills a random name (e.g. "Cedric") but the highlighted list row is "Aldric"; pressing A takes Aldric. There is no hint that Y types your own name, and the footer shows keyboard keys ("Enter Accept"). shots/29-pad-name.png.

### S21. Winning the game: no victory screen and no way to retire (major)
Steps (cheats): maxed Highborn Warrior with artifacts; kill Abaddon (Morgoth) on DL100 and Azazel (Sauron) on DL99 (both quests).
What the client shows: only the three engine log lines "*** CONGRATULATIONS *** / You have won the game! / You may retire (key is shift-q) when you are ready." in the fading message area (shots/55-azazel-win.png). No banner, no screen, no sound. Shift+Q does nothing (not bound in either preset; "Retire" is in docs/limitations.md as not exposed) and neither the Esc menu nor the command menu offers retiring. The engine's own character sheet does show "Title ***WINNER***" (shots/56-winner-sheet.png), but the HUD keeps showing the class title ("Lord") because snapshot.c write_player always sends `player->class->title[...]` instead of using show_title()'s winner logic.
So a winner can only ever end the run by dying, and never gets the stock winner tombstone/crown or a "retired" score entry. Given the game is called "100 Deep", reaching and beating level 100 should have a proper ending.
Also seen on the way: killing Azazel drops loot and builds the magical down staircase correctly; Abaddon's death drops items ("You feel something roll beneath your feet"); quest gating works (killing Abaddon first did not win; the winner flag was set only when the second quest completed, as in player-quest.c).

### S22. Message history (Ctrl+P) is lost on every page reload (minor)
After any reload `thang.state.log` is empty, so Ctrl+P / Message history shows nothing from before the reload, e.g. the victory messages above or what just killed you. Stock Angband keeps the message buffer in the savefile and a frontend can read it with `messages_num()`/`message_str()`. The log lives only in the client (game-state.ts `log`, MAX_LOG 400); hello/resync doesn't send history.

### S23. Narrow windows: the hint bar is cut off at both ends; HUD and character sheet overflow (minor at 800px, major on phones)
- 800x600 (shots/57-small-hud.png): the bottom hint bar is wider than the window and centred, so the first hint ("p Pick up 19 Mithral Bolts…") loses its key and the last ("Enter Commands") is cut. Measured: `.hud-hints` spans x = -74…874 in an 800 px window. A long item name in the "Pick up …" hint is the usual cause.
- 375x667 phone portrait (shots/57-phone-hud.png): hints span -115…490 (only "…Mithral Bolts (3d5)" and "Tab Fi…" are visible); the left HUD block covers about 60% of the view and the "99999999 xp" label wraps out of the XP bar; the first-person weapon covers the bottom third.
- Phone portrait character sheet (shots/57-phone-char.png): the right-hand columns (Armor, Melee, To-hit, Blows, Shots…) are clipped with no horizontal scroll; page 2 (resistance grid) is unreadable.
- 667x375 landscape and 1920x1080 / 2560x720 look fine (shots/57-phone-land-hud.png, 57-wide-hud.png, 57-fhd-*.png). Controls and inventory fit at every size tested.
Fix idea: let `.hud-hints` wrap or shrink (and truncate the pick-up label), and give `.pv-body` `overflow-x: auto`.

### S24. Command menu (Enter / Select) stays open after running a command (minor UX)
Steps: Enter > Move & explore > "Hold / wait a turn" (or Go down a staircase, Rest, Save game, any entry).
Actual: the category menu closes but the "All commands" root menu stays on screen on top of the game. After a prompt-based entry (Open, Drop…) you return to the root menu too. You need an extra Esc/B every time, and with it open, the game view (and e.g. the new level after "Go down") is hidden behind it. The Use menu (U) does close itself.
Cause: client/src/ui/command-menus.ts openCommandMenu: the root MenuLayer's `onSelect: (i) => i.data()` opens the category without closing the root, and the category's onSelect only closes itself.
Every entry was exercised (log: s/61-cmdmenu.mjs output): all 50 entries do something sensible (prompt, panel or engine message). Notes: "Auto-explore"/"Travel to stairs" reply "Something is here." when a monster is in view (S15); the repeated-message merge in the log hides a second identical message, which is fine.

### S25. Quantity prompt: typed digits are appended to the default, Backspace cancels (minor)
Steps: d > pick "6 Flasks of oil" > "Quantity:" shows 1 > type 3.
Expected: 3. Actual: 13, clamped to 6 (the max). Typing "2" then "5" for 25 arrows gives 125 → max. There is no way to clear: Backspace is mapped to "back" and cancels the whole drop.
Cause: client/src/ui/prompt-layer.ts quantity branch: `Number(`${this.quantity}${ev.key}`.slice(-4))` starts from the default instead of replacing it on the first keystroke; UI_KEYS maps Backspace to 'back' (input-manager.ts).

### S26. Aim mode (`*`): `t` / Enter throws an item when you have no launcher (minor; differs from Angband)
In stock Angband `*` then `t` just sets the target (for a following spell or wand). Here, without a bow/sling, `t` or Enter opens "Throw which item?" — a mage who targets then presses t gets a throw prompt. Shift+Enter is the "set target only" key. Documented in the README, but surprising for Angband players and for every caster; consider making t = set target when there is no launcher.

### S27. Options menu lists ~12 Angband interface options that do nothing in this frontend (polish)
Options shows every textui interface option: solid_walls, hybrid_walls, view_yellow_light, animate_flicker, center_player, purple_uniques, auto_more, hp_changes_color, mouse_movement, highlight_player, show_target, use_sound. None of these affect the 3D client (they are ASCII-map/terminal options). They toggle and persist, but are noise; hide them or mark them as not applicable. (All 21 toggled and toggled back without errors.)

### S28. Ignoring an item in the pack doesn't take effect until you spend a turn (minor)
Steps: (Unignoring off) i > item > Ignore / unignore. The item stays listed, now named "… {ignore}", until the next game turn, when it is dropped ("You have no more Scrolls of Phase Door {ignore}"). Same when switching K off. In the stock UI the ignored item vanishes from the lists immediately (lists skip ignored objects and `ignore_drop()` runs from notice_stuff). Only "this item" ignoring is available (documented).

### S29. Look `g` (travel) silently does nothing while a monster is in view (polish)
l > move the cursor to a known floor grid > g: the layer closes and nothing happens, no message (pathfind is disturbed at once by the visible monsters). Same for map (M) travel. A "Monsters in view" message would help.
Also: monster recall titles show "The yellow mold ('m') ('')" — the empty glyph in the second parentheses comes from graphics mode; polish.

### S30. Gear > Floor tab has no "Pick up", but offers "Drop" for items on the floor (minor)
Steps: stand on items, i, ← to "Floor (1)", Enter on the item. Menu: Throw, Drop, Inscribe, Ignore / unignore, Examine (shots/75-floor-menu.png). There is no Pick up — the one thing you want from a floor list — and "Drop" on an item that's already on the floor makes no sense. The protocol's ItemAction has no pickup action (shared/protocol ItemAction; actions come from the adapter's per-item list). Pick up works from the game (g/p/Space).

### S31. Monster/item lists are captured 40 columns wide and 22 rows tall: names truncated, long lists cut off (minor)
At DL97 the monster list reads "great wyrm of an (asleep)" (annihilation), and the item list "a Two-Handed Great Flail (3 9 S 4 E" with the dice running into the distance column. This is the same in the wide popup ([ / ]), which has plenty of room (shots/78-monlist.png, 78-sidebar.png). Lists longer than 22 rows are cut by the engine ("...and N others"), even in the popup. The sidebar under the minimap also overflows the window bottom at 1280x720 (scrollHeight 497 > 430 visible) with no scrolling.
Cause: engine/adapter/src/panels.c:149 `#define LIST_W 40`, `LIST_H 22` (and RECALL_W 46). Capturing wider (e.g. 60-80 columns) and letting CSS clip the sidebar would fix the popup.

### S32. Direction prompt with a controller: the cursor can sit on the disabled centre cell (polish)
In a "Direction?" prompt (Close, Open, Tunnel… from Select > Doors & terrain) the cursor starts on "forward"; one D-pad ↓ puts it on the empty centre cell, where A does nothing (no feedback). Skipping the centre when `allowNone` is false would avoid a dead press. (prompt-layer.ts handleInput dirCursor movement.)

## What I tested that worked

- Title screen (New character / Controls / Quit, Continue when a save exists), version line.
- Birth by keyboard (letters, arrows, Esc back from race/class) and by controller (stick, D-pad, LT/RT paging, name suggestions, Y = on-screen keyboard, B back to suggestions), point-based and rolled stats.
- Controls screen: Angband/WASD preset toggle (Enter and ←/→), reset to defaults, rebinding keys with swap, clearing (Shift+Enter), Esc cancels capture, controller tab, binding a pad button as a hold (Hold Y = map, tap Y still opens the inventory), Start/B refused as reserved; bindings persist in localStorage. WASD preset works in play (q/e turn, E equipment, Q quaff).
- Every README keyboard key in play: i I e | m b S q r E a u z A U f v F w t d { } K o c T D + s W l x * ' h Tab C M [ ] / \ ? R , < > Ctrl+P Ctrl+F Ctrl+S Enter Space p g, numpad walking. Each opens the right prompt/menu or gives the stock engine message.
- Simulated Xbox / PlayStation / Nintendo pads: A/B/X/Y/LB/RB/LT/RT/Select/Start/L3/R3/D-pad, tap vs hold LB, left stick walk, right stick turn, hints and menu footers switch to the pad's glyphs and back to keys on the next key press; on-screen keyboard (type, delete, shift, Start = done) for inscriptions.
- Shops: walking into all 8 entrances from every open side (orthogonal by ↑ facing the door, diagonal by numpad), Space facing a door, map travel next to it: the shop opens with the player left on the street and leaving keeps them there. Buying, quantity picker, "cannot afford", full pack ("You cannot carry that many items"), Give tab (birth_no_selling), Home stash/retrieve, reload/new browser inside a shop reopens the shop. Stock of all 7 shops looks right.
- Doors (walking into closed doors opens them; locked doors auto-repeat picking), rubble and passable rubble (Space), tunnelling magma (T), traps created with Trap Creation: walking in auto-disarms, Space and D disarm, W jumps in (got the trap's confusion), level feelings (Ctrl+F, LF in HUD), connected stairs (arrive on a way-back staircase as stock 4.2), '<'/'>' travel to known stairs.
- Look (l: next/prev with Space/-, free cursor with arrows and numpad, Enter recall, g travel), Aim (* , Shift+Enter set target, ' target closest), monster recall panel, monster/item lists, character sheet pages 1-2 (incl. ***WINNER***), message log, map with cursor/zoom/travel.
- Status effects and HUD chips: Blind, Confused, Poisoned, Halluc (random tiles), Terror, Paralysed, Bad Cut, Scrambled, Sprint, Haste, RFire/RCold, stat drain (lower-case yellow Con), Study, Unignoring, cures via potions and their messages.
- Save/load: reload with an item/direction/aim/spell/string prompt open (the prompt comes back and can be answered or cancelled), reload after a level change, reload in a shop, reload on the death screen; engine killed with SIGKILL mid-prompt: the bridge restarts it, the client shows "Engine restarted." and resumes the last save. Ctrl+S saves; Esc > Save and return to title, Continue; Ctrl+X in the local build saves, stops the bridge and shows "Your game is saved".
- Death screen, message history from it, new character from it (but see S13).
- Deep game: DL40/60/80/98/99/100 all at 60 fps in a 1280x720 window, ~30 ms per engine turn with a dozen monsters in view; 8-digit EXP and 7-digit gold fit the HUD; Azazel's shapechanges, quest stairs and drops; Abaddon's earthquake killing a 1100 HP character; winning (S21).
- Robustness: 2000 random key presses in 90 s (letters, symbols, arrows, Tab, Space, Backspace…) with health checks every 200 keys: never stuck, never an exception in the console.
- Resizing: 667x375, 800x600, 1280x720, 1920x1080, 2560x720 (see S23 for the narrow cases).
- Day/night in town: nightfall darkens the town and the sky, the light radius shows.
