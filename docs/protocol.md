# Engine protocol v1

The TypeScript definitions in `shared/protocol/src/index.ts` are normative.
This page explains the message flow.

## Transport

- One JSON object per line. The engine reads stdin and writes stdout. The
  bridge relays each line unchanged as one WebSocket text frame.
- Each side processes messages in order. The engine is single-threaded, so
  every message is handled to completion before the next one is read.
- `{"type":"hello"}` asks for a full resync. It can be sent at any time,
  including while a prompt is pending. The bridge sends one whenever a
  client connects.
- `{"type":"ping","id":n}` → `{"type":"pong","id":n}`.

## Engine → client

| type | When | Contents |
|---|---|---|
| `hello` | Startup, after birth/load, on resync, after `options` | Protocol version, engine build id, savefile, races/classes, interface + birth options, tileset (URL, cell size), feature table (flags and per-lighting tiles), player tile, Angband colour palette. |
| `state` | After every command, prompt, free action and resync | `seq` (increases monotonically; restarts after each hello), `phase` (`menu`/`game`/`dead`), `turn`, player, status line, `map` (`full` flag plus changed cells `[x,y,feat,light,inView,trapTile]`), monsters, objects, inventory/equipment/quiver/floor, target, store, messages, effects. |
| `prompt` | The engine needs input for the current command | `id`, `kind` (`item`, `direction`, `aim`, `spell`, `quantity`, `confirm`, `string`, `key`, `curse`, `choice`) and candidate lists. Always preceded by a `state`. |
| `info` | Reply to `query` | Title and text (item info, monster recall, book contents). |
| `saved` | Reply to `save` | `ok`. |
| `error` | Rejected input | `code` (`bad_json`, `command_rejected`, `prompt_pending`, `no_prompt`, `stale_answer`, `bad_answer`, `bad_option`, `in_store`, `load_failed`, `fatal`, …) and message. |

The bridge adds `{"type":"bridge","event":"engine_exit"|"engine_started"|"engine_failed"|"replaced"}`.

## Client → engine

| type | Phase | Notes |
|---|---|---|
| `new_game` | any | `race`, `class`, `name`, `stats` (`points`/`roll`), optional `birthOptions` and `options`. Uses native `CMD_BIRTH_*`. |
| `load_game` | any | Loads the configured savefile. |
| `command` | game | `action` plus optional `dir`, `item` (handle), `quantity`, `useTarget`, `monster`, `book`, `spell`, `text`, `mode`/`turns` (rest), `x`/`y` (pathfind). Optional args are validated by the engine; missing ones produce a prompt. |
| `answer` / `cancel` | prompt pending | Must carry the prompt's `id`. `value` is the choice; `aim` answers may use `monster` or `useTarget`, and `spell` answers include `book`. |
| `options` | game | `set: {name: bool}`. Interface options only. |
| `query` | game | `what: 'item' \| 'book'` with `item`, or `what: 'monster'` with `monster`. Read-only; RNG state is preserved. |
| `save` | game | Saves like the stock "save game" command. |
| `close_game` | game / dead | Saves (if alive) and returns the engine to the title (`menu` phase); reply is `hello` + `state`. |
| `quit` | any | Saves (if alive) and exits. EOF does the same. |

### Item handles

`inven:N`, `equip:N` (body slot index), `quiver:N`, `floor:N` (index in the
pile under the player, ignoring hidden items), `store:N` (store stock, only
inside a store).

### Actions

Movement `walk run jump hold go_up go_down explore navigate_up navigate_down pathfind`;
terrain `open close tunnel disarm alter steal`;
objects `pickup autopickup wield takeoff drop eat quaff read use_staff aim_wand zap_rod activate use refill fire throw inscribe uninscribe ignore`;
magic `study cast`; time `rest`;
free actions `target_closest target_next target_prev target_clear target_monster fire_at_nearest toggle_unignore feeling`;
store `store_buy store_sell store_leave`.

## Example session

```
→ {"type":"new_game","race":"Dwarf","class":"Warrior","name":"Durin"}
← {"type":"hello", ...}
← {"type":"state","seq":2,"phase":"game","turn":1,"player":{"x":23,"y":3,...},"map":{"full":true,...},...}
→ {"type":"command","action":"quaff"}
← {"type":"state","seq":3,...}
← {"type":"prompt","id":1,"kind":"item","prompt":"Quaff which potion? ","items":[{"handle":"inven:1",...}]}
→ {"type":"answer","id":1,"value":"inven:1"}
← {"type":"state","seq":4,"turn":11,"messages":[{"text":"You feel like a killing machine!",...}],...}
```
