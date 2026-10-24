# Licences and attribution

> This is a summary from reviewing the licence files. It is not legal advice.
> Check the upstream texts before redistributing builds.

## Angband (engine/upstream)

Angband 4.2.6, upstream commit `f3082213b73f3e463e3d0d60bff4b00462beae6e`
(tag `4.2.6`), included unmodified as a git submodule from
<https://github.com/angband/angband>.

From `engine/upstream/docs/copying.rst`: Angband is free software that you
may redistribute and/or modify under **either** the GNU General Public
License, version 2, **or** the "Angband licence":

> Copyright (c) 1997 Ben Harrison, James E. Wilson, Robert A. Koeneke
>
> This software may be copied and distributed for educational, research, and
> not for profit purposes provided that this copyright and statement are
> included in all such copies. Other copyrights may also apply.

## This project's code

- **engine/adapter** links the Angband core into one executable, so it is a
  derivative work. It is licensed under the **GNU GPL, version 2**, which is
  compatible with Angband's dual licence. Each source file is offered under
  GPLv2. Copyright (c) 2026 Thangorodrim contributors.
- **bridge, client, shared, tests and scripts** run as separate processes or
  in the browser and communicate with the engine only through the JSON
  protocol. For simplicity they are also distributed under **GPLv2**
  (`"license": "GPL-2.0-only"` in package.json).

## David Gervais' 32×32 tiles

`engine/upstream/lib/tiles/gervais/32x32.png` and the associated pref files
(`graf-dvg.prf`, `xtra-dvg.prf`, `flvr-dvg.prf`).

- Original artwork by **David Gervais**. Per Angband's `copying.rst`, it may
  be redistributed, modified and used **only under the terms of the
  [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/)
  licence**.
- The bundled sheet is Buzzkill's *Universal 32x32 Tileset (UT32)*, a
  modified version of Gervais' set, with additional tiles by Rob Fiala, Jeff
  Greene, Thapper (oook.cz) and others, and further tiles from Tangaria's
  tileset for Angband 4.2. The pref mapping was converted by Mogami from
  AngbandTK's dg32-assign, with additional work by Ivan Jekic. See the header
  of `graf-dvg.prf`.
- The client shows this attribution on the title screen. The tiles are
  loaded from the upstream checkout at runtime; this repository does not copy
  or alter them.

## Tilesets that are NOT used

Angband also bundles Adam Bolt's, Nomad's, Shockbolt's and the original 8×8
tiles. The Shockbolt set may not be used or distributed with other projects
without the author's permission. The bridge therefore serves **only** the
`gervais` tile directory (`bridge/src/server.ts`).

## Third-party runtime dependencies

| Package | Licence |
|---|---|
| three | MIT |
| ws | MIT |
| vite, vitest (dev) | MIT |
| typescript (dev) | Apache-2.0 |
| VT323, IM Fell English SC fonts (Google Fonts, loaded at runtime) | SIL Open Font License 1.1 |

The dungeon surface textures are generated procedurally at runtime
(`client/src/renderer/textures.ts`), and the sound cues are synthesised with
WebAudio (`client/src/audio/sfx.ts`). No third-party art or audio assets are
included.
