# Game data

The data the engine runs with: monsters, objects, artifacts, classes, races,
dungeon profiles, stores and help text (`gamedata/`, `help/`, `screens/`,
`customize/`), plus David Gervais' tiles and their mapping (`tiles/`).

Forked from Angband 4.2.6 (`engine/upstream` at f3082213b), with
Tolkien-specific names replaced (`docs/renames-from-tolkien.txt`). Edit
these files directly. The format of each file is described in its header and
in Angband's manual ("Modifying Angband").

- Monster bases (`base:` lines, `monster_base.txt`) are looked up by name in
  the engine code. Keep "Morgoth" as an internal base name.
- When you rename a monster, update `tiles/gervais/graf-dvg.prf` too. The
  engine tests check this.
- Run `npm run test:engine` after changes. The engine reports data errors
  with file and line when it starts.
