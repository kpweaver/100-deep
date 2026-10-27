# divine playtest report (Druid / Priest / Paladin)

Tester: divine. Build: frozen worktree c0d72b6 + cheats, native bridge on :4313.
Screenshots: /Users/kevinweaver/Dev/Thangorodrim-playtest/playtest/divine/shots/

## Summary

| # | Severity | Issue |
|---|---|---|
| 1 | **CRASH / BLOCKER** | Any item/spell/fire command while shapechanged kills the engine (native: SIGSEGV; WebAssembly/itch: infinite hang). No way to change back; a shapechanged autosave bricks the character. Hits Druid Fox Form (L1), every Druid/Necro/Blackguard shape, and **any class via Potion of Surprise**; Tab/RT with a launcher triggers it |
| 2 | Major | Auto-explore loops forever between two closed doors (food/turns burn, bridge rate-limits); seen twice in ~8 levels |
| 3 | Major | New character from the death screen gets a random/wrong class (Priest chosen -> Blackguard with a Necromancer book): use-after-free in handle_new_game |
| 7 | Major | Shapechanges invisible to the frontend: weapon stays in hand and swings, HUD never shows the shape, menus offer only crashing commands |
| 4 | Minor | Tab/RT "close in" walks into walls instead of pathing |
| 5 | Minor | Item prompts relabel a,b,c... instead of inventory letters |
| 8/10 | Minor | Merged spell list: >26 spells get no letter (Druid River of Lightning; Priest's two best prayers); letters differ between Study and Cast |
| 13 | Minor | Previous character's messages carry over into the new character |
| 14 | Minor | "Roll randomly" has no preview/reroll; no race/class info at birth |
| 6, 9, 11, 15, 16 | Polish | Travel enters shops; lowercase spell prompts; no visuals for LOS spells / no face-target on cast; glyph is an opaque billboard; truncated monster/item names; misc |
| 12 | Cheat-only | debug summon fails in corridors; debug artifact duplicates artifacts |
| 17 | Unconfirmed | Once arrived on a level unable to see anything (Light 0) until the first step |

Report path: /Users/kevinweaver/Dev/Thangorodrim-playtest/playtest/divine-report.md (details below; issue numbers are in the order found).

---

## 1. CRASH/BLOCKER: every item or spell command while shapechanged kills the engine

**Steps:** New Druid (any race). `S` study Fox Form, `m` cast Fox Form ("You assume the shape of a fox!").
Now press `r` (read the Word of Recall scroll) — or `m` (cast), `q`, `a`, `u`, `z`, `A`, `f`, `v`, `w`, `t`, `d`, `{`, `}`, `F`, `S`.

**Expected (stock 4.2.6):** "You cannot do this while in fox form." then the prompt
"Change back and read (y/n) or (r)eturn to normal? [yrn]" — this prompt is the *only* way in
Angband 4.2 to return to normal shape (player-util.c:1022 `player_get_resume_normal_shape`).

**Actual:** the engine process dies with SIGSEGV (bridge log: `engine local exited (code=null, signal=SIGSEGV)`),
the client shows "Engine restarted." and the game reloads from the last save: everything since the
last save is lost (spell learned, Fox Form, XP, etc.). Reproduced 100% both in the browser and by
piping the protocol straight into `build/engine/angband-headless` (exit 139):

```
{"type":"new_game","race":"Human","class":"Druid","name":"Crash"}
{"type":"command","action":"study","book":"inven:0","spell":1}
{"type":"command","action":"cast","book":"inven:0","spell":1}
{"type":"command","action":"read"}
```

**Cause:** `player_get_resume_normal_shape()` (engine/upstream/src/player-util.c:1028) calls
`get_char()` (ui-input.c:1315), a *textui* function, not a game-input hook. It does
`event_signal(EVENT_MESSAGE_FLUSH)`, `prt()` and `inkey()` on the main `Term`, which does not exist in the
headless adapter (only offscreen vterms in engine/adapter/src/panels.c) -> NULL `Term` dereference.
The adapter installs hooks for get_check/get_com/etc. (engine/adapter/src/hooks.c:656-675) but nothing
covers this `get_char` call. Affected commands (all call `player_get_resume_normal_shape`): inscribe,
uninscribe, takeoff, wield, drop, read, use staff, aim wand, zap rod, activate, quaff, use, refill,
cast, study (cmd-obj.c:157-1247), fire and throw (player-attack.c:1318, 1373).

**Easiest trigger of all — the attack button:** a shapechanged character with a launcher equipped who
presses **Tab / RT ("Fire at nearest")** while a monster is visible but not adjacent crashes the engine
(client/src/app.ts:771-773 sends `fire_at_nearest`, which reaches do_cmd_fire -> player_get_resume_normal_shape).
Verified: Gnome Druid, Sling + 1 iron shot, Fox Form, beggar 16 squares away, Tab -> SIGSEGV #10.

**Why this is a blocker:** there is no other way to resume normal shape in 4.2.6. A shapechanged
druid (Fox Form is a level-1 spell, the first one most players try) can never cast again or use an
item. If the player takes stairs while shapechanged, the autosave stores the shape, so every reload
comes back shapechanged and every cast/quaff/read crashes again: the character is effectively
bricked.

**WebAssembly (itch.io) build: the game HANGS instead.** I compiled the same engine sources with emcc into
my scratch dir (scripts/build-web.ts recipe, nothing in the worktree touched) and drove it through
client/src/wasm/engine-host.ts exactly like tests/engine/wasm.test.ts
(script: playtest/divine/wasmtest/fox.ts). After "You assume the shape of a fox!", sending `read` makes the
engine spin at ~99% CPU forever with no further output (likely: NULL `Term` is readable memory in wasm, so instead of a fault `inkey()`
loops waiting for a key that can never arrive). On itch the browser game would freeze permanently on the
first cast/quaff/read in any shape; nothing is saved after the freeze.
Necromancer (Bat Form L3, Dire wolf Form, Vampire Form) and Blackguard (Werewolf Form) share the same path.
**Not just shapechangers:** a *Potion of Surprise* (object.txt:3600-3620, native DL10-15, a random-effect
potion found by every class) can cast SHAPECHANGE:bat. Verified: a Human **Priest** quaffed Potions of Surprise,
on the 7th got "You assume the shape of a bat!", and the next quaff (even of a floor item) killed the engine
(SIGSEGV #9 in my bridge log). So any character can be bricked by an unidentified potion.

## 2. MAJOR: auto-explore (x / LT) loops forever between two closed doors, burning food and flooding the bridge

**Steps:** DL1 (save copy: /private/tmp/claude-501/-Users-kevinweaver-Dev-Thangorodrim/44af21f7-9273-4f05-96c6-19aaabd659b7/scratchpad/explore-loop-save,
Half-Elf Druid at 53,36), a small dead-end area with two closed doors (56,35 and 54,37) whose far sides are unknown. Press `x`.

**Actual:** the player shuttles between (53,36) and (55,34) forever. Each engine `explore` moves 2 steps
toward one door, stops (the run stops next to a closed door whose neighbours are not all known —
player-path.c:1924-1960), and the next `explore` picks the *other* door. The client keeps re-issuing
`explore` after every state that has no messages (client/src/app.ts:788-806 `continueExplore`), so this never ends:
in ~1 minute the turn counter went 20641 -> 24541 and food dropped 88% -> 66%. The bridge then rate-limits
("Too many messages; some were dropped."), the client logs "[app] engine did not answer; releasing input",
and the message log fills with "Slow down: some inputs were dropped." The HUD keeps showing "Exploring".
Only opening a door by hand gets it moving again. Seen a second time with the Halfling Paladin on
another DL1 (small room with '<' and two doors: shuttles (126,17) <-> (132,17), 60 game turns per flip).

**Expected:** explore should stop (or open the door). The stop-at-unknown-door is stock engine
behaviour, but in the stock textui each explore is one keypress, so the player sees no progress and acts;
the client's auto-repeat turns it into an unbounded loop. Suggest stopping the loop when the player returns
to a grid visited in the last few steps / makes no net progress, or when no new grid became known.

## 3. MAJOR: new character after death (or any new_game while a game is loaded) gets the wrong class/race

**Steps (protocol):** with a character loaded (phase `game`), send
`{"type":"new_game","race":"Half-Elf","class":"Druid","name":"X"}` -> you get a **Human Warrior**; a second try
with Dwarf/Priest gave a **Dwarf Warrior**. From the title (after close_game) the same message works.

**Cause:** engine/adapter/src/main-headless.c:265-266 look up `races`/`classes` *before*
`engine_reinit()` (line 277), which runs `cleanup_angband()/init_angband()` and frees those lists; the
stale `r->ridx` / `c->cidx` are then read from freed memory (use-after-free; results vary).
**Player impact:** the death screen's "new character" path (client/src/app.ts:303 `startBirth` from the
DeathLayer) sends `new_game` while the dead character is still loaded, so it goes through the reinit path.
**VERIFIED with the real UI:** Half-Elf Druid died on DL2 -> R.I.P. screen -> "New character" -> chose
Dwarf / **Priest** / "Balin" / point-based -> got a **Dwarf Blackguard** ("Dwarf Blackguard Rat") carrying a
*Necromantic Tome [Into the Shadows]* (a Necromancer book!) and "You can learn 1 more ritual."
Screenshot: shots/priest_birth.png. The previous character's death messages ("You die.") also remain in
the new character's message log. Severity: major (every restart after a death rolls a random/corrupt class;
being a use-after-free it could also crash).

## 4. MINOR: Tab / RT "close in" walks into walls

app.ts:775-784 steps by `sign(dx), sign(dy)` toward the nearest visible monster. With a sleeping soldier
ant 12 W / 2 S down a corridor, Tab tried to step SW into the corridor wall every press: "There is a wall in
the way! (x19)", camera turned to face the wall, no progress (no game time used). It should path (e.g. the
engine's pathfind to the monster grid) or at least try the adjacent directions.

## 5. MINOR: item prompts relabel items a, b, c... instead of the inventory letters

"You have Soft Leather Armour [8,+0] (e)." but in the "Wear or wield which item?" prompt it is `b)`;
pressing `e` silently does nothing. Stock Angband item prompts keep the inventory letters (so `we` works
from muscle memory and matches the messages). Same in every item prompt.

## 6. POLISH: travel / pathfind walks through shop entrances and drops you into the shop

Traveling across town (pathfind) repeatedly entered the Armoury because the shortest path crossed its
door diagonally. Authentic engine pathing (shop grids are passable, player-path.c:103), but annoying with
map travel; the frontend could avoid shop grids that are not the destination.

## 7. MAJOR: shapechanges are invisible to the frontend (weapon stays drawn, no shape in HUD, menus offer forbidden commands)

Tested every Druid shape in 4.2.6 data: Fox Form (L1), Become watchstone (= upstream Pukel-man, L30),
Eagle's Flight (L35), Bear Form (L40). (Necromancer Bat/Dire wolf/Vampire Form and Blackguard
Werewolf Form use the same code; a *Potion of Surprise* can also turn any class into a bat:
engine/lib/gamedata/object.txt:3615 — so issue 1 can hit a Warrior too.)

Findings, identical for all four shapes:
- **First-person weapon/hand:** the wielded weapon (a Whip here) stays drawn in the right hand and
  keeps swinging on melee ("You bite/claw/punch/crush/slash..."). Shots: shots/fox1.png, fox_dl1.png,
  foxfight.png, watchstone.png, ws_fight.png, eagle.png, bear_fight.png. The engine says "Your gear merges
  into your body", so the weapon should vanish (ideally show paws/claws/stone fists).
  Cause: the snapshot has no shape field at all (engine/adapter/src/snapshot.c:860-895 writes race/class/
  title only), and client/src/ui/weapon.ts only looks at the equipment list.
- **HUD/title:** stock `prt_title` shows the shape name ("Fox", "Bear"...) in place of the title and blanks
  race/class (ui-display.c:182, 554-583). Here the sidebar keeps "High-Elf Druid Nurturer"; nothing on
  screen says you are shapechanged except the one-off message. The snapshot's `title` is always
  `class->title[...]` (snapshot.c:862).
- **Stats/speed:** these DO update correctly (fox STR -3 / AC +3; watchstone "Slow (-5)" shown in red, STR/CON +4,
  AC +20; eagle MOVES+3 = each step costs ~2.5 game turns instead of 10; bear STR+3/INT-2/CON+2, AC +5).
- **Shape blows** work: fox "You fail to harm" (fox to-dam -3 with a 1d3 whip: authentic), watchstone
  punch/crush/thump/strike, bear cuff/clout/claw/slash/swipe.
- **Menus:** the Use menu (U), inventory item actions (Cast a spell / Quaff / Read...), the Tab hint
  "Fire" etc. all stay offered while shapechanged, and every one of them leads to the crash in issue 1.
  "Eat something" gives "You have no food to eat." while you carry Rations (authentic: shapechanged players
  can only use floor items, cmd-core.c:1042), which will confuse players without an explanation.
  Browse/Examine work fine in shape.
- **Shops:** walking into a shop as a fox gives "There is a scream and the door slams shut!" (authentic).
- **Changing back:** impossible (issue 1). Stock offers it via the "Change back and <verb> (y/n) or (r)eturn
  to normal? [yrn]" prompt on any blocked command; this needs an adapter hook/prompt (a `choice` prompt with
  y/r/n) and ideally a visible "Change back" entry in the Use/Command menus while shapechanged.
- Message "You assume the shape of a eagle!" ("a eagle") is upstream 4.2.6 text (authentic).

## 8. MINOR: merged spell list runs out of letters; letters differ between Study and Cast

The cast menu merges every book into one list (stock asks for a book first). A level-50 Druid with all
five books has 27 spells: a..z then **River of Lightning has no letter** (shots/castall4.png) and can only be
reached with the cursor. The study menu shows only one book, lettered from a, so the same spell has a
different letter in Study (Earth Rising = f) and Cast (Earth Rising = l); typing the cast letter in the
study menu silently does nothing. Stock letters are per book (macros like `mab` rely on that).

## 9. POLISH: spell prompts lowercase, LOS spells have no visual

- "study which verse?", "cast which prayer?" — engine/adapter/src/hooks.c:431/484 build the prompt
  without `my_strcap` (stock ui-spell.c:285-288 capitalises).
- PROJECT_LOS spells (Ice Storm, Mass Sleep, Banishment/Dispel-type prayers) produce no effect events at all,
  so nothing is drawn (authentic: stock draws nothing either), but in first person a brief screen tint would
  help.
- Casting at a target never turns the camera toward it; with the view facing a wall you see no effect
  at all (e.g. Stinking Cloud at a floating eye 9 squares east while facing a wall, shots/sc_fx1.png).
- The raised casting hand covers the bottom-left message log for its duration (shots/glove_1.png).

## 10. MINOR: a level-50 Priest's two best prayers have no hotkey letter

Same root cause as 8: the merged prayer list for a Priest with all five books has 28 entries, so
**Spear of the Hunter-King** and **Light of the Wind-King** (the priest's top attacks) appear after `z)` with no
letter (shots/priest_list_end.png). They work via cursor (ArrowUp wraps to the bottom) — both cast fine.

## 11. POLISH: glyph of warding is drawn as an opaque grey square standing in the corridor

Glyph of Warding (priest) shows the rune tile as a standing billboard with a solid dark-grey background
box (shots/glyph2.png) rather than a decal on the floor.

## 12. MINOR (cheat only): debug `summon` fails in corridors

`{type:'debug',action:'summon',name:'cave orc'}` (or a unique) answers "Could not place monster." whenever
the player stands in a corridor; it works in rooms. Only affects test tooling.

## 13. MINOR: previous character's messages carry over to the next character

After a death -> New character, and also after Save and return to title -> New character, the bottom-left
message log of the new hero starts with the old hero's last messages ("You die.", "You can learn 1 more
ritual.", "Garm, the Jaws of Thirst, resists." ...). Shots: priest_birth.png, paladin_birth.png. The client
log should be cleared on `new_game`/`hello` after birth.

## 14. MINOR: "Roll randomly" gives no preview or reroll

Ability scores -> "Roll randomly" immediately creates the character with whatever was rolled (my Halfling
Paladin got STR 11 / INT 9 / WIS 17 / DEX 13 / CON 18/20) — no stat display, no reroll, no "accept". Stock
lets you see the roll and reroll. The race/class menus also show no stat modifiers or descriptions.

## 15. POLISH: side panels truncate names so the important part is lost

Monster/item list rows are cut to a fixed width: "boil-covered wr (asleep)", "battle-scarred  (asleep)",
"mature black dra (asleep)", "a Book of Nature Magics [C 0 N 0 W" / "[N 0 N 0 W" (two different books
look identical), "a Scroll titled \"susto lict 0 N 1 W". Shots: b5.png, paladin_birth.png, pickup2.png,
wolfazazel.png. Truncating the middle ("Book of Nature Magics [Creature…]") or wrapping would help.

## 16. POLISH: assorted small things

- Title screen says "Continue hero" (the savefile name) rather than the character's name/class/level.
- Map travel to a shop stops on the adjacent square facing the wrong way; Space then does nothing until
  you turn to face the door (shots/travel_end.png). Stepping in with a numpad key works.
- Inside a shop, `w` (wield) does nothing although the adapter supports wield/takeoff in stores
  (engine/adapter/src/store.c:221-226); you have to leave to put on what you just bought.
- Blindness has no visual effect: the 3D view keeps rendering the remembered dungeon normally (only the
  "Blind" status and the "U Use" hint change). A dark vignette would make it obvious.
- Debug `artifact` happily creates a second copy of an artifact that already exists (two
  'Bladeturner', two Heartstones on the floor). Cheat-only.

## 17. UNCONFIRMED: arrived on a new level unable to see anything

Once (Halfling Paladin, DL1 -> DL2 by stairs, torch with 2820 turns) the new level showed nothing: HUD
"Light 0", status "Unknown grid", the player's own grid (an up staircase) unknown, `explore` said "No
apparent path for exploration", a `hold` turn changed nothing and walking said "You feel a wall blocking
your way." After one successful step everything lit up normally (Light 3). The bridge had been receiving a
burst of bot commands at the time. I could not reproduce it in 20+ further stair trips; noting it in case
someone else sees it.

## Paladin / end game notes (worked)

- Halfling Paladin through the real birth screens (rolled stats), DL1-5 by stairs. Bless (status "Blssd",
  +AC/+hit), Call Light, Detect Evil, Minor Healing, Sense Invisible, Heroism all cast; random prayer
  learning (no CHOOSE_SPELLS) works through the "Study which book?" item prompt.
- Paladin fail rates cap at 50% (authentic: player-spell.c `if (chance > 50) chance = 50`).
- **Single Combat** (L40): moves you into the 6x6 arena level and back after the kill; renders fine
  (shots/arena.png, sauron_arena.png). Works against Azazel (= Sauron) too after a few "resists!".
- **DL99:** Azazel, the Sorcerer (Sauron) summoned, Single Combat arena, he shapechanges (Wolf-Azazel,
  Serpent-Azazel: the monster name/sprite/recall title follow), killed with Hellmaul + 2x Ring of Speed in
  ~35 rounds and ~12 Potions of Healing: "Azazel, the Sorcerer, is defeated!", "A magical staircase
  appears...", back on DL99 with the stairs next to you and his drop ('Mundwine'). Took the stairs to **DL100**.
- **DL100:** Abaddon, Lord of the Abyss (Morgoth) summoned and fought in the arena; he outpaced 40
  Potions of Healing (+40 speed, ~300-600 damage per player turn) and killed me at 92%. No UI problems seen
  during either boss fight (messages, status, big stat values "18/***" are authentic).
- Priest end game (DL60/DL99): Holy Word ("dissolve"/"shudder" + heal), Word of Destruction (map is
  re-shaped and forgotten, renders fine), Spear/Light of the Hunter-/Wind-King, Healing, Glyph, Remove
  Curse (permanent teleport curse can't be removed: authentic), Word of Recall (activates, yanks you up),
  Clairvoyance, Enchant Weapon (item prompt, "Your Mace glows brightly!").

## Tested and working (Druid / Priest / general)

- **Birth screens** (real keys) for Halfling Druid, Dwarf Priest, Halfling Paladin (rolled): race/class/name/
  stats menus, Esc back, title "Continue" after Save and return to title. (Races are the forked names:
  Halfling = Hobbit, Highborn = Dúnadan.)
- **Town:** shops via walking and via map travel (M, cursor, Enter), buying with the quantity dialog
  (arrows ±1/±10), Give tab, wear/wield from the pack, resting (R), saving (Ctrl+S).
- **Druid DL1-5** (Half-Elf died on DL2 to a cave spider swarm; High-Elf with an XP boost to L13 played DL1-5):
  Detect Life (far-reaching, authentic), Stinking Cloud (ball at a monster and at a free grid target set with
  `*` + Shift+Enter, "At current target"), Confuse Monster, Slow Monster (monster status "confused, slowed"
  in the target HUD), Lightning Strike (yellow ball), Earth Rising (short beam; target 8 away is out of its
  6-grid reach: authentic), Turn Stone to Mud with the relative direction grid ("The wall turns into
  mud!"), Sense Surroundings (minimap fills), Cure/Resist Poison ("RPois" status, rest stops when it
  expires: authentic), Remove Hunger. Druids can wear gloves with no penalty or message (authentic: no
  CUMBER_GLOVE); the raised casting hand is drawn gloved.
- **Druid L50 books:** every spell in all five books cast: Trance, Mass Sleep, Tremor, Haste Self ("Fast
  (+10)"), Revitalize/Herbal Curing/Rapid Regeneration (silent when nothing to cure: authentic), Meteor Swarm,
  Rift, Ice Storm (PROJECT_LOS: no visual), Volcanic Eruption (fire ball + earthquake), River of Lightning.
- **Priest DL1-12:** random prayer learning via "Study which book?", Call Light ("5 cave orcs cringe from the
  light!", status Light 2->3), Minor Healing (+24 HP at L13, matches "heal 23/3%"), Bless ("Blssd"),
  Heroism (silent below CL20 at full HP: authentic), Orb of Draining (white burst), Spear of Light (beam,
  lights the corridor), Detect Evil, Sense Invisible, Protection from Evil ("ProtEvil"), Smite Evil ("AttEvil",
  "Your Mace is imbued with holy force!"), Glyph of Warding, Portal, Remembrance, Clairvoyance, Word of Recall.
- Fail-rate rises by 5 per missing SP and the "Attempt it anyway?" confirm works (y/n keys).
- Cure Serious Wounds cures confusion, Healing cures blindness (authentic 4.2 rules).
- Page reload mid-game continues the running engine; "Engine restarted" recovery after each crash reloads the
  last save cleanly (that is how I "changed back" from every shape).

## Test tooling left behind (not part of the build)

/Users/kevinweaver/Dev/Thangorodrim-playtest/playtest/divine/ — driver.mjs (persistent Playwright page with
an HTTP control port), bot.mjs (explore/fight bot), boss.mjs / melee.mjs (boss fights), setup-end.mjs
(maxed endgame character), cast.sh, wasmtest/fox.ts (WASM hang repro). Save copies of interesting states are
in my scratchpad (explore-loop-save, endgame-paladin-*).
