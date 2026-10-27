# melee playtest report (Warrior / Blackguard / Rogue)

Tester: melee · build c0d72b6 (frozen worktree) · native bridge on :4311 with THANG_CHEATS=1
Scripts: playtest/melee/s/*.js (run with `node run.mjs s/<file>.js`), screenshots in playtest/melee/shots/

## Summary table

| # | Severity | Issue |
|---|---|---|
| M14 | **crash / blocker** | Any item command or cast while shapechanged (Blackguard Werewolf Form; also Druid/Necro forms) SIGSEGVs the engine — including just pressing Tab/`h` with a bow: `player_get_resume_normal_shape()` calls textui `get_char()`. Progress since last autosave lost. |
| M12 | **critical** | Second character after a death (death screen → New character) ignores chosen race & class (2/2; close_game→New was fine 1/1) (got Kobold Warrior instead of Half-Troll Blackguard): use-after-free of race/class pointers across `engine_reinit()`. |
| M13 | major | Auto-explore loops ~1000 cmds/s when `explore` silently makes no progress (closed door/known trap in the way): floods bridge, rate-limit drops input, 8 s "engine did not answer" freezes. |
| M11 | major (usability) | "Ignore" on a pack item does nothing until the next turn; pressing it again silently un-ignores. |
| M14b | major (presentation) | While shapechanged: sword still drawn & swung, sidebar shows race/class/title instead of shape, no way back to normal shape. |
| M7 | minor | Throwing has no first-person feedback; launcher animation fires at command send (shows during prompts, then the sling "whirl" plays on the melee weapon). Unarmed shows nothing. |
| M8 | minor | `T`+direction digging never plays the dig animation (only Space on rubble does). |
| M5 | minor | Item prompts use positional letters, not inventory letters; aim prompt ignores `'`, `t`, digits; throw prompt doesn't start with throwing items. |
| M16 | minor | `@v1`-style inscription digits don't work in prompts; inscription displayed twice in Gear ("{@v1}{@v1}"). |
| M6 | minor | Tab "close in" walks into walls; with a sleeping monster in view behind a wall neither Tab nor explore make progress. |
| M18 | minor | Tab tries to fire when quiver holds only throwing items; bow-only character shows empty hands. |
| M3 | minor | Can't wear/wield/inscribe from inside a shop (adapter supports it, client doesn't expose it). |
| M4 | minor | Message history empty after reload/continue (also at death screen after reload). |
| M1 | minor | Birth name box: typed text is prepended to the random default name. |
| M15 | polish | Title offers "Continue" for a dead character. |
| M2 | polish | "Unexpected 'options' while in a store" / "prompt_pending … 'options' ignored" on every reconnect while in a shop or prompt (options not applied). |
| M9 | polish | Objects on a monster's grid are drawn in front of the monster. |
| M10 | polish | Hints: "Tab Fire" when Tab melees; no "Disarm" hint facing a trap; Home footer says "Buy / sell". |
| M17 | polish | Blindness doesn't change the 3D view. |
| M19 | polish | Side panels (monster/object list) overlap the weapon sprite; misc (see below). |

## Issues (in the order found)

### M1. Birth name field: typed name is prepended to the random default name (minor)
- Steps: title > New character > Dwarf > Warrior > "Name your character" box. Type "Gimrak", press Backspace first or not, Enter.
- Expected: typing replaces the suggested name (text selected on focus), or the caret is at the end so Backspace deletes it.
- Actual: the caret is placed at the START of the suggested name ("Aldric"); Backspace does nothing and typing produces "GimrakAldric". The character was created as "GimrakAldric".
- Cause: client/src/ui/menu-layer.ts:159 `this.input.focus()` without `select()` / setting the selection to the end.

### M2. Reconnecting while inside a shop shows "Unexpected 'options' while in a store" (polish)
- Steps: enter a shop, reload the page (or let the client reconnect) while the store screen is open.
- Actual: the message log shows the engine error "Unexpected 'options' while in a store" every reconnect. The client always pushes its interface options when it first sees phase 'game' (client/src/app.ts:271-274 `optionsPushed`), and the engine rejects messages other than store commands inside the store loop.
- Also, a letter key pressed immediately after the page loads into a store went to the game handler ("'fire' is not available in a store") because the StoreLayer only opens after the tile atlas loads. Rare race; minor.

### M3. Can't wear/wield or inspect pack items from inside a shop (minor, frontend gap)
- In stock Angband 4.2 you can use `w`, `t`, `I`, `{` etc. inside a store. The adapter already accepts wield/takeoff/inscribe/uninscribe/ignore in the store loop (engine/adapter/src/store.c:226-232), but the client's StoreLayer (client/src/ui/screens.ts:596-607) routes every key to the store menu, so there is no way to reach them: to wear a cloak you just bought you must leave the store. Examine is only available on the Give tab (Shift+Enter).

### M4. Message history is empty after reloading / continuing (minor)
- Steps: play a while, reload the page (or Continue from the title), press Ctrl+P.
- Expected: Angband keeps message history in the savefile (and in the running engine), so the log should show earlier messages.
- Actual: "Messages" panel is empty; only messages produced after the reconnect appear. The client log (GameState.log) is filled only from live `state.messages`; the hello/resync doesn't include history. Screenshot: shots/w20-msglog-after-reload.png

### M5. Item prompts relabel items a), b), c)... instead of using Angband's inventory letters (minor, muscle memory)
- Steps: press `w` with a Cloak in pack slot (e). Prompt lists "a) Wooden Torch  b) Cloak". Pressing `e` (what any Angband player types: `we`) does nothing.
- Stock Angband labels item-prompt rows with the item's real inventory letter (and equipment/quiver letters), so `w e`, `q a`, `v 0` etc. work. Here letters are positional (client/src/ui/prompt-layer.ts:86-90 → ListMenu letters). Same for the Throw prompt: `v` lists food first; `va` throws a Ration of Food.
- (Confirm prompts do accept y/n: fine.) In the "Direction or target?" aim list, digits 1-9, `'`, `t`/`5` and `*` do nothing until you pick "In a direction…" (client/src/ui/prompt-layer.ts:203-218 only handles digits once the direction grid is shown). In stock Angband `v` `<item>` `'` or `t` or a digit fires immediately.

### M6. Tab / autofight "close in" walks straight into walls (minor)
- Steps: in town, a sleeping urchin is visible 9 squares SE behind a building corner; press Tab repeatedly.
- Actual: "There is a wall in the way!" every press; Tab takes the sign(dx),sign(dy) step (client/src/app.ts:787-800) without pathing, so it never reaches the monster. Meanwhile `x` (explore) and travel refuse to move because a monster is in view ("Something is here." — upstream 4.2.6 behaviour, cmd-cave.c:1428). Net effect: with a harmless sleeping monster in view behind a wall, neither explore nor autofight make progress; the player has to walk manually.
- Suggest: use the engine's pathfind toward the monster when the direct step is blocked.

### M7. Throwing has no first-person feedback; launcher "shoot" animation fires even when nothing is shot (polish)
- `v` (throw) plays no hand/weapon animation at all (only `fire`/`fire_at_nearest` trigger `weapon.shoot()`, client/src/app.ts:457), and the camera doesn't turn toward the target, so throwing at a monster behind you shows nothing (the missile sprite lives 0.1 s per grid).
- Conversely `shoot()` plays as soon as a `fire` command is *sent* (before the ammo/aim prompt is answered or cancelled), so pressing `f` then Esc still plays the bow draw/recoil. Worse, with the normal `f` → ammo prompt → target prompt flow the launcher is raised while the prompts are open and has already been lowered (SHOT_MS) when the shot actually happens, so the sling "whirl" is played on the melee weapon: shots/r05-sling-whirl.png shows the Dagger whirling, not the Sling. Only `h`/Tab (fire_at_nearest, no prompts) shows the launcher correctly (shots/w31-firing.png). Triggering on the engine's missile effect / shoot message instead of on send would fix both.
- Unarmed: the weapon sprite is hidden entirely (`display:none`); melee "swings" animate an invisible element — no fist/hand is shown.

### M8. Tunnelling with `T` + direction never plays the dig animation (minor)
- Steps: Warrior facing a granite wall, press `T`, answer the direction prompt with `6`.
- Expected: the weapon chops as with Space on rubble (the docs say digging swings the weapon).
- Actual: `thang.hud.weapon.el.className` stays `fp-weapon` (no `anim-chop`) even though the engine digs for 79 turns ("You tunnel into the granite wall with your swap digger. (x79)"). The animation is only triggered when the `tunnel` command is *sent* with a `dir` (client/src/app.ts:458 `diggableAt(m.dir)`); a `T` keypress sends no dir and the direction comes later as a prompt answer. Space only works on rubble/doors, so the dig animation is effectively unreachable for walls/veins.

### M9. Objects on a monster's square are drawn in front of the monster (polish)
- Steps: fire an arrow at an adjacent orc (it misses and lands under it). Screenshot shots/w31-firing.png: the arrow sprite is drawn across the orc's body.
- Stock Angband shows the monster, not the object, on a shared grid. Suggest drawing objects lower/behind or hiding them while a visible monster stands there.

### M10. Context hints: "Tab Fire" shown while Tab will melee; Home footer says "Buy / sell" (polish)
- With a monster adjacent the action bar shows `Space Attack A cave orc` and `Tab Fire` even though Tab melees an adjacent monster (client/src/app.ts:773 attack()).
- Facing a known trap, Space disarms it (client/src/app.ts:824) but the action bar shows no "Disarm" hint (updateHints, app.ts:850-862, has no trap case), so players don't learn Space works on traps. (Verified: Space → "You have disarmed the gas trap.", shots/r16-trap-view.png shows only Explore/Gear/Use/Commands.)
- In the Home, the tabs say Take/Drop but the footer still says "Enter Buy / sell" (client/src/ui/screens.ts:509).

### M11. "Ignore" on a pack item does nothing until the next game turn; a second press silently un-ignores it (major usability)
- Steps: Gear > Pack > select an item > "Ignore / unignore" (or `{type:'command',action:'ignore',item:'inven:5'}`).
- Expected (stock 4.2 textui): the item is marked ignored and immediately dropped/hidden ("You drop a Wooden Torch {ignore}" / "You have no more ...").
- Actual: no message, the item stays in the pack with its name unchanged; nothing happens until you take some other turn-consuming action (e.g. `,` hold), at which point "You drop a Wooden Torch (169 turns) {ignore} (f)." appears. If the player, seeing nothing happen, chooses Ignore again, the flag is toggled back off (commands.c toggles OBJ_NOTICE_IGNORE) and the item is never dropped. In my script I pressed it on the same item 30 times in a row: net result, nothing ignored.
- Cause: engine/adapter/src/commands.c:196-207 treats ignore as a free action and returns false; `notice_stuff()` → `ignore_drop()` only *queues* CMD_DROP, which the adapter never runs until the next real command. Running the game loop (or returning true) after queueing would match the textui.

### M12. CRITICAL: a second character in the same session ignores the chosen race and class (use-after-free in new_game)
- Steps (real UI): play a character until death (or Continue a save) → death screen "New character" → choose **Half-Troll** → **Blackguard** → name "Morgra" → Point-based. Screen shows "Morgra the Half-Troll Blackguard".
- Expected: a Half-Troll Blackguard with Tulwar, Leather Shield, [Into the Shadows], CLW potion.
- Actual: the game starts a **Kobold Warrior** ("race":"Kobold","cls":"Warrior", Dagger + Soft Leather Armour). Reproduced twice (once via `new_game` race Half-Troll/Warrior after a death, which also gave a Kobold). The very first character after the engine starts is fine (Dwarf Warrior birth worked).
- Cause: engine/adapter/src/main-headless.c:265-289. `find_race()`/`find_class()` return pointers into the race/class lists, then `engine_reinit()` (line 279: runs whenever a character already exists or phase != menu, i.e. after death, after Continue, after close_game) calls `cleanup_angband()`/`init_angband()`, which frees and re-parses those lists. `r->ridx` / `c->cidx` are then read from freed memory (line 287/289). Besides choosing the wrong race/class this is undefined behaviour and could crash, notably in the WASM (itch) build. Fix: look up race/class (or copy ridx/cidx) after `engine_reinit()`.
- Reproduced 2/2 after a death (death screen → New character, and protocol new_game after death). After Save & quit to title (close_game) → New character it worked correctly (Half-Troll Rogue, 1/1) — consistent with use-after-free (depends on whether freed memory was reused, and on whether close_game already re-initialised).
- Workaround used for the rest of this test: restart the bridge before each new character.

### M13. MAJOR: auto-explore spins in a tight loop (≈1000 commands/s) when `explore` makes no progress silently; floods the bridge and freezes input
- Steps: Blackguard on DL1 standing in a corridor directly south of a known closed door (layout: `#+#` / `#@#`, door N, more doors beyond). Press `x` once.
- Observed (ws log via ?debug): the client sends `{"action":"explore"}`, the engine answers a `state` with no movement and **no message** within ~1 ms, the client immediately re-sends explore, and so on: ~35 explore round-trips in the first 35 ms, continuing indefinitely ("Exploring…" never ends, player never moves). With the native bridge this trips the 30 msg/s rate limiter, so subsequent commands (including the player's own) are silently dropped and the client prints "engine did not answer; releasing input" after 8 s; in the WASM build it would peg a CPU core until a key is pressed.
- Why the engine is silent: upstream `do_cmd_explore` (cmd-cave.c:1514-1543) finds a path with relaxed constraints (path_nearest_unknown loosens forbid_traps / only_known), then `run_step()` stops at once (closed door / known trap in the way) without printing anything. Same with a known trap blocking the only corridor. That part is authentic 4.2.6.
- Client bug: `continueExplore()` (client/src/app.ts:803-818) only stops on messages, a visible monster, a prompt or phase change. It should also stop when a step produced no movement (or no turn passed), and/or rate-limit re-issues.
- Second, independent repro (Half-Troll Rogue, DL1, standing in an open lit room next to quartz veins with unexplored pockets behind them, no door adjacent): pressing `x` produced the same flood (ws log: explore TX/RX every ~1 ms, position fixed at 112,25), and during pure-keyboard play this happened repeatedly within the first minutes — so it is easy to hit.
- Workaround for players: press any other key to cancel, then open the door manually.

### M14. CRASH (blocker): any item command while shapechanged segfaults the engine (Blackguard Werewolf Form; also affects Druid/Necromancer forms)
- Steps: Blackguard L50 with [Fear and Torment], cast Werewolf Form ("You assume the shape of a werewolf! Your gear merges into your body."), then press `q` (quaff) — or send `{type:'command',action:'quaff'}`.
- Expected (stock 4.2): "You cannot do this while in werewolf form." then the prompt "Change back and quaff (y/n) or (r)eturn to normal?".
- Actual: the engine process dies with **SIGSEGV** (`[bridge] engine local exited (code=null, signal=SIGSEGV)`), the client shows "Engine restarted." and the game is reloaded from the last autosave (level change). Everything since then is lost — in my case advance/learned spells/gear pickups, and on a second occurrence the character later died because the reload put a geared Lv50 back to a pre-gear save. Reproduced 2/2. In the itch/WASM build this would kill the worker.
- Cause: upstream `player_get_resume_normal_shape()` (engine/upstream/src/player-util.c:1022-1043) calls `get_char()`, which is a textui function in ui-input.c (not a game-input hook) and touches the terminal; the adapter has no terminal. Every caller crashes while shapechanged: quaff, read, use (generic), eat?, inscribe, uninscribe, wield, takeoff, drop, use staff, aim wand, zap rod, activate, refill, **cast** and study (cmd-obj.c:157,187,243,276,365,743,768,802,836,870,921,942,1076,1118,1247), fire and throw (player-attack.c:1318,1373). The adapter needs to provide a working `get_char` path (e.g. present it as a `choice` prompt y / r / n) before shapechanges are safe.
- Note the client can trigger this without the player choosing an item command: Tab/`h` with a launcher and ammo sends `fire_at_nearest`, which queues CMD_FIRE → do_cmd_fire → the same crash. **Verified**: werewolf Blackguard with Long Bow + arrows, cave orc 2 squares away, press `h` → SIGSEGV, "Engine restarted." (player-attack.c:1318, 1443). Tab does the same whenever no monster is adjacent.
- Related presentation issues while in werewolf form (screenshot shots/b15-werewolf.png):
  - The first-person view still shows the wielded sword (Durendal) and plays sword swings for bites/claws; it should switch to claws/none while "Your gear merges into your body".
  - The sidebar still reads "Half-Troll Blackguard Tyrant"; stock shows the shape name ("Werewolf") as the title and blanks race/class (ui-display.c:182, 554-583). The adapter sends `class->title` unconditionally (engine/adapter/src/snapshot.c:862) and there is no shape field in the protocol, so the client can't know the player is shapechanged at all.
  - There is no way to return to normal shape except via a (crashing) item or cast command — i.e. once shapechanged the only safe options are to wait out... nothing: the form has no duration, so the player must avoid every item/spell command: stock offers it through the `m` ability menu / prompt; `view_abilities_hook` is a no-op (documented limitation).

### M15. Title offers "Continue" for a dead character (polish)
- After a death, closing to the title still shows "Continue (hero)" first; choosing it only flashes "The character in this savefile is dead" in the message area. Stock Angband starts a new character directly when the savefile is dead. Suggest hiding Continue (hello.saveExists could carry a dead flag) or going straight to birth.
- Death screen "Message history" is empty if the page was reloaded after death (same root cause as M4); stock offers the full history plus character sheet / inventory / dump at the tomb.

### M16. Inscriptions: `@v1`/`@q1` number shortcuts don't work in prompts; inscription shown twice in Gear (minor)
- Steps: Gear > Flask of oil > Inscribe > type `@v1` (input works). The flask moves to the quiver (authentic 4.2: throwing items inscribed `@v` go to the quiver) — note there is no message, so to the player the flask simply vanishes from the Pack tab.
- Then `v` and `1`: stock selects the `@v1` item immediately. Here the throw prompt (positional letters) ignores digits; you must find the quiver entry by letter (it is listed last, "quiver:1"). Same for `@q1`, `@r1`, `@m1` etc. — the main use of inscriptions. (client/src/ui/prompt-layer.ts / list-menu.ts only map a–z.)
- Gear screen shows "a Flask of oil {@v1}{@v1}": the engine's item name already contains `{@v1}` and the client appends `detail: {inscription}` again (client/src/ui/screens.ts:208-214). Screenshot shots/i04-quiver-tab.png. Same in the Quiver tab.
- `!q` works: "Really quaff a Smoky Potion {!q}?" confirm appears and y/n answer it.

### M17. Being blind doesn't change the first-person view (polish)
- Quaff Potion of Blindness (Human Warrior): status shows "Blind", messages "You can't see anything.", but the 3D view still shows the fully lit corridor around you and the torch glow (shots/st-Blindness.png). Stock's map also keeps remembered grids, so this is consistent with Angband knowledge, but for a first-person view a darkened/blurred screen while blind would avoid the impression that you can see. (Hallucination is handled nicely: random sprites and "something strange", shots/st-hallucination.png.)

### M18. Tab (autofight) tries to fire when the quiver holds only throwing items (minor)
- Steps: wield a Long Bow, have no arrows but a Flask of oil inscribed `@v1` (which the engine moves into the quiver). A monster is in view 2+ squares away; press Tab.
- Actual: "You have no ammunition in the quiver to fire." every press; Tab neither throws nor closes in. client/src/app.ts:782 `hasLauncher && s.quiver.length` doesn't check that the quiver holds ammo for the launcher.
- Related (polish): with a bow equipped and no melee weapon the first-person view is empty (shots/w70-bow-no-melee.png); the bow only appears for ~the shot animation (shots/w71-bow-only-fire.png). Showing the launcher when no melee weapon is wielded would read better.

### M19. Assorted polish notes
- The right-hand side panel (monster/object list) grows downward over the first-person weapon; with telepathy at DL98 the list covered most of Hellmaul (shots/w60-hellmaul.png, w54-curse-choice.png).
- Standing diagonally next to a wall corner, the near wall fills half the screen (shots/b15-werewolf.png, w38-play.png) — geometrically right for a 0.5-unit near distance, but jarring.
- Monster recall panel wraps at ~45 columns, leaving the right half of the popup empty (shots/w44-look-recall.png).
- Game data leak of a Tolkien term the rename missed: Ration of Food description "called cram by the Lake-men" (engine/lib/gamedata/object.txt:305).
- Pathfind/travel in town routes straight through shop entrances and enters the shop (upstream `is_valid_pf` treats shops as passable — authentic, but surprising with map travel).
- After a `jump` cheat the player can arrive with nothing known and Light 0 until the first step (debug-only, not a player issue).
- First-person weapon poses: checked 50+ weapon tiles (contact sheets shots/weapons-sheet.png, shots/weapons-sheet2.png). All look right except the **Battle Axe**, which is drawn almost horizontally along the bottom edge with its head bottom-left, half under the action bar (shots/weapons2/Battle_Axe.png). Its pose is `'10,33': 'rotm90'` (client/src/ui/weapon.ts:93); the other axes use flipX and hold the head up. With the object/monster list populated, polearm heads (Halberd, Pike, Trident, Lance, Awl-Pike) and hammer heads disappear under the side panel (shots/weapons-sheet.png).

## Notes on authentic Angband behaviour (not frontend bugs)
- Explore/travel refuse to move while any monster is in view ("Something is here.", cmd-cave.c:1428) and stop next to closed doors / known traps — upstream 4.2.6 autoexplore code. Only the client's endless re-issue (M13) is a frontend bug.
- Connected stairs put you on an up staircase after going down (4.2 behaviour). "You enter a maze of down staircases" is the upstream level-arrival text.
- No two-handed weapon rules in 4.2: Executioner's Sword / Hellmaul with a Large Metal Shield is legal; "You have trouble wielding such a heavy weapon" appears correctly.
- Failing to disarm badly can set off the trap without moving you; Remove Curse can fail and make the item fragile; recharge can backfire and destroy a wand; Blackguard casting with too little SP offers "Attempt it anyway?" and can paralyse — all upstream.
- "You have 11 Flasks of oil (1st 1)" and `@v`-inscribed throwing items moving to the quiver are upstream (obj-gear.c:627).
- Game data uses the project's de-Tolkienised names (Sauron→Azazel, Morgoth→Abaddon, Hobbit→Halfling, Dúnadan→Highborn), as documented in README.

## What I tested that worked
- **Birth via the real screens** for all three classes: Dwarf Warrior, Half-Troll Blackguard, Halfling Rogue (rolled stats); also High-Elf/Kobold/Human/Half-Troll characters via `new_game`. Starting kits match class.txt.
- **Town**: General store, Alchemist, Weaponsmith, Bookseller, Home (Take/Drop), buying with the quantity picker (←/→, ↑/↓, digits), "Give" tab under birth_no_selling, leaving shops onto the street, Word of Recall both ways (status "Recall", "yanked upwards/downwards").
- **Early game for real** (keyboard + Tab/x/R): Warrior DL1→5 (Fang killed, levelled to 10), Blackguard DL1→3, Rogue DL1→4; eating, torches running out, hunger/fainting, fear (Warrior "too afraid to attack"), poison, confusion, traps.
- **Warrior**: melee swing animations per weapon family; shield bashes; bow (Short/Long Bow) firing with `h`/Tab (bow raised and drawn), `f` prompts; throwing flasks of oil, Throwing Axes (fire brand learned on throw), the wielded Dagger (unarmed afterwards, "You punch"); digging granite with T (swap digger in pack: "with your swap digger"), wielding Shovel/Pick (first-person sprite correct, examine shows dig turns); heavy weapons and artifacts (Hellmaul, Great Hammer of the Smith-King, Glaive of Pain, Calris, Executioner's Sword) all drawn sensibly.
- **Curses & runes**: Calris "air swing" curse ({cursed} shown, rune learned on wield), Scroll of Remove Curse → item prompt → curse-choice prompt (power shown) → failure makes it fragile; rune learning messages for many runes; Iron Helm of Garlan aggravation/stat drain noticed; examine text ("You do not know the full extent…").
- **Blackguard**: study (CHOOSE_SPELLS) via `S`, browse, SP gained from combat and decaying, every ritual cast at L50: Seek Battle, Berserk Strength, Whirlwind Attack, Shatter Stone (aim), Leap into Battle (aim), Grim Purpose, Maim Foe, Howl of the Damned, Relentless Taunting, Venom, Werewolf Form, Bloodlust ("red mist", thirst increases), Unholy Reprieve, Forceful Blow, Quake. Off-hand cast animation plays.
- **Rogue**: stealing with `s` (gold, then a scroll from a master thief; failure wakes the monster which steals back and blinks away), study/cast from [First Spells] and [Arcane Control]: Detect Monsters, Phase Door, Object Detection (objects show on minimap/list), Detect Stairs, Recharging (item prompt; backfire), Reveal Monsters, Teleport Self, Hit and Run, Teleport Other (beam effect), slings (sling whirl when fired via `h`), Scroll of Trap Creation + disarming with Space ("You have disarmed the gas trap") and `D`.
- **Prompts**: item, aim (target list), direction grid (relative + absolute digits), quantity, confirm (y/n), string (inscribe `{`), spell lists, curse choice; reloading the page with a prompt open re-shows it.
- **Status effects**: blindness ("You can't see anything"), confusion (explore/read refused), sleep/paralysis, poison, hallucination (random sprites, "something strange"), salt water, infravision; Black Breath at DL98.
- **Mid/end game with cheats**: DL30 with acquire/great items, DL98 fights vs ringwraith-type uniques, Azazel on DL99 (Warrior and Rogue, both died to nether/darkness storms), Abaddon on DL100 (Blackguard died); death screen, Message history button, New character from the tomb (but see M12).
- **UI**: character sheet (2 pages), monster recall from Look, level map with travel, message log, command menu and Use menu, Options, Controls, system menu, Ctrl+S save, small viewports (800x480, 1024x600) remain usable.
