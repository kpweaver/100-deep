# Playtest, 27 October 2026

Build tested: `49593b8` (the build live on itch), plus the debug cheats from `c0d72b6`. Four playtester agents worked in parallel:

| Report | Covers |
|---|---|
| [melee-report.md](melee-report.md) | Warrior, Blackguard, Rogue |
| [arcane-report.md](arcane-report.md) | Mage, Necromancer, Ranger |
| [divine-report.md](divine-report.md) | Druid, Priest, Paladin |
| [systems-report.md](systems-report.md) | Birth, shops, controls, saves, status effects, deep levels, winning |

Each class was made through the real birth screens and played normally through town and DL1–5. Cheats then took each one to the middle game (around DL30) and the end game (Azazel on DL99, Abaddon on DL100). Azazel was killed twice and Abaddon once, but the game showed no ending. The IDs in brackets refer to the individual reports, which give repro steps and the likely cause at file:line.

## 1. Blockers: fix before anything else

### 1.1 Any item or spell command while shapechanged crashes or hangs the engine
[M14, A12, divine #1; reproduced more than 16 times by three testers]

- **What it hits:** Druid Fox Form (a level-1 spell), every Druid, Necromancer and Blackguard shape, and any class turned by a Potion of Surprise.
- **What triggers it:** read, quaff, cast, study, aim, use, zap, activate, wield, take off, drop, inscribe, refill, fire, throw, and Tab/RT with a launcher and no adjacent monster.
- **Native build:** SIGSEGV. The bridge restarts the engine from the last level-change autosave, so progress is lost.
- **WebAssembly build (itch):** the engine spins at 100% CPU forever and the game freezes.
- **Saves become unplayable:** taking stairs while shapechanged saves the shape, so every reload crashes again.
- **Cause:** `player_get_resume_normal_shape()` (`engine/upstream/src/player-util.c:1022`) asks "Change back and <verb>? [yrn]" through the text UI's `get_char()`. The adapter never hooks that, and headless there is no `Term`. This prompt is also the *only* way back to normal shape.
- **Fix direction:** route the question through the adapter's prompt protocol, or hook `get_char`, and show it as a three-option menu.

### 1.2 New character from the death screen gets the wrong race and class
[S13, M12, A11, divine #3; reproduced by all four testers]

- **Symptom:** the chosen race and class are ignored. Usually you get a Kobold Warrior; once it was a "Dwarf Blackguard" carrying a Necromancer book. Starting from the title screen works.
- **Cause:** a use-after-free. `handle_new_game` (`engine/adapter/src/main-headless.c:265-289`) looks up `r` and `c`, then `engine_reinit()` frees and reloads the race and class lists, then reads `r->ridx` and `c->cidx`. It could crash in either build.
- **Fix direction:** look the race and class up after `engine_reinit()`, or keep the names and resolve them afterwards.

### 1.3 Paralysis while commanding a monster live-locks the engine
[A17; Necromancer]

- **Symptom:** with Command active, every queued command becomes a monster command. A paralysed player queues `CMD_SLEEP`, the monster-command code rejects it without using energy, and the game loop never ends. The screen stays black with no recovery until the server restarts.
- **Cause:** upstream 4.2.6 logic, combined with no watchdog in the bridge or worker.

## 2. Major

| # | Issue | Refs |
|---|---|---|
| 2.1 | **Auto-explore loops forever** when `explore` silently makes no progress (closed door with an unknown far side, known trap, two closed doors). The client re-sends it every frame from `continueExplore` (`client/src/app.ts:788-806`). Natively the bridge rate-limits and freezes for 8 s; in the browser it would max out the CPU. Seen within minutes on DL1. Fix: stop when the player hasn't moved and no turn passed. | M13, A8, divine #2 |
| 2.2 | **Shapechanges are invisible to the frontend.** The snapshot has no shape field, so the weapon stays drawn and keeps swinging (your Fox Form report), the HUD never shows the form, and the menus offer only commands that crash (1.1). Fix: add `shape` to the snapshot, hide the weapon or show claws or paws, add a "Change back" action. | M14b, A13, divine #7 |
| 2.3 | **New levels often arrive fully dark** (nothing known, Light 0) until the first step: 6 of 6 times from town at night, 3 of 8 times town ↔ DL1 by day. The adapter doesn't request a view update when a level is generated. | A9, divine #17 |
| 2.4 | **"New character" overwrites a living save** with no confirmation (single save slot). The title also offers "Continue" for a dead character and labels it "hero". | S6, M15 |
| 2.5 | **The keyboard can't answer aim prompts directly:** `1-9`, `'`, `t` and `*` do nothing in "Direction or target?". The `use_old_target` option is also ignored. | S7, M5, A21 |
| 2.6 | **Tab/RT "close in" walks into walls** ("There is a wall in the way! ×30"). It steps by the sign of dx/dy with no pathing. It also tries to fire when the quiver holds only throwing items. | S14, M6, M18, divine #4 |
| 2.7 | **Ignore on a pack item does nothing until the next turn;** pressing it again silently un-ignores. It is treated as a free action, so the queued drop never runs (`commands.c:196`). | M11, S28 |
| 2.8 | **Shop gaps:** Examine gives "Unexpected 'query' while in a store"; stock can't be examined or books browsed before buying; worn gear and quiver can't be sold or stashed; can't wear or wield inside a shop. | S9, S10, A1, M3 |
| 2.9 | **Winning has no ending:** no victory screen, no retire command, and the HUD never shows WINNER. | S21 |
| 2.10 | **Birth screens give no information:** no race or class descriptions, rolled stats never shown, no reroll, no birth options. | S3, A6, divine #14 |

## 3. Minor

- **Prompt letters**
  - Item prompts letter items a, b, c… by position instead of using inventory letters.
  - `@v1`, `@f1` and `@m1` inscriptions don't work.
  - Inscriptions show twice in Gear. [M5, M16, A14, divine #5, S19]
- **Spell menu letters:** the combined spell menu has no letters past the 26th spell, so some best spells have no key (Druid's River of Lightning, Priest's top prayers). Letters also differ between Study and Cast, and `m-book-spell` muscle memory casts the wrong spell. [A16, divine #8/10]
- **Quantity prompt:** typing 5 gives 15 because digits are appended to the default. Backspace cancels the prompt. The shop picker ignores gold and pack space and takes no digits. [S25, A22, S12]
- **Message history**
  - History is lost on every reload.
  - The previous character's messages carry over into a new character. [S22, M4, A3, divine #13]
- **Reconnecting while in a shop or prompt**
  - It logs "Unexpected 'options' while in a store".
  - The player's options aren't applied for that session. [S11, M2, A2]
- **Narrow screens**
  - The hint bar is clipped at both ends on narrow windows.
  - On phones the HUD and character sheet overflow. [S23]
- **Truncated lists:** monster and item lists are captured at 40×22, so names are truncated ("squint-eyed rogu"). [S31, A5, divine #16]
- **Animations**
  - Launcher, cast and shoot animations play when the command is sent, including on cancel or failure, so the sling whirl can play on the melee weapon.
  - Throwing and unarmed show nothing.
  - `T`-digging never animates. [M7, M8, A19]
- **No status visuals:** no first-person effect for blindness, hallucination, confusion or paralysis. Experience drain isn't shown on the HUD. [S17, M17, S18]
- **Look/Aim:** says "Unknown grid" for monsters seen by infravision, ESP or unlight. [A10]
- **Birth name box**
  - Typing prepends to the random default name.
  - An empty, long or non-ASCII name fails silently. [M1, S1–S5]
- **Command menu:** stays open after running a command. [S24]
- **Floor tab:** has no Pick up but offers Drop. [S30]
- **Aim with no launcher:** `t` throws instead of setting the target. [S26]
- **Controls screen:** reports a "swap" when the other action actually became unbound. [S8]

## 4. Polish

- **Sprites**
  - Objects on a monster's grid draw over the monster.
  - Glyphs are opaque grey squares.
  - The Battle Axe pose is sideways (`weapon.ts:93`).
  - Side panels overlap the weapon sprite. [M9, A20, divine, M19]
- **Camera:** doesn't turn toward an off-screen target when firing or casting. [A15, divine #11]
- **Hints**
  - No "Disarm" hint when facing a trap.
  - The Home footer says "Buy / sell".
  - The Aim bar offers "Fire Arrows" with a crossbow. [M10, S16, A23]
- **Text**
  - Engine data typo "Your resume control of your own body."
  - Leftover Tolkien term "cram by the Lake-men" (`object.txt:305`).
  - Lowercase spell prompts. [A18, M19, divine #9]
- **Auto-explore with a monster in view:** refuses with the misleading "Something is here." (stock behaviour; could be reworded). [S15, A7]
- **Travel:** walks into shops. [divine #6]
- **Cheats only**
  - `debug summon` fails in corridors.
  - `debug artifact` can duplicate artifacts. [divine #12]

## What held up

- **Shops:** every entrance opens from every open side and leaves the player on the street.
- **Spells:** every spell in every book for all nine classes cast correctly, including all targeting modes, Dimension Door, Banishment, Command, Single Combat and Unlight.
- **Ranged combat:** bows, slings and crossbows work, including the quiver, ammo breakage and throwing.
- **Controllers:** Xbox, PlayStation and Nintendo glyphs, hold bindings, the on-screen keyboard, and hints that follow the last device used.
- **Robustness:** reloads keep open prompts and shops. Engine crashes recover with "Engine restarted". 2000 random key presses never got stuck.
- **Performance:** DL40–100 ran at 60 fps with about 30 ms per turn.
- **Endgame:** the quest flow through Azazel and Abaddon works, Azazel's forms and his staircase included.

## Suggested order

1. 1.1 + 2.2 together: route the shapechange prompt through the adapter and add `shape` to the snapshot. This also fixes your Fox Form issue.
2. 1.2 (a two-line reorder) and 2.1 (an explore progress check). Both are small and hit everyone.
3. 2.3 (dark arrival) and 1.3 (watchdog or upstream guard).
4. The rest of section 2, then minor items by how often players will hit them.
