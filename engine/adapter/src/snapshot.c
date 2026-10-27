/**
 * \file snapshot.c
 * \brief Export the player's *knowledge* of the game as JSON.
 *
 * Information restriction is enforced here, on the engine side, so hidden
 * state never reaches the client (or its debugging tools):
 *
 *  - Terrain comes from map_info(), which reads the player's memory chunk
 *    (player->cave), exactly what the original map display uses.
 *  - Monsters are exported only when monster_is_visible() and not
 *    camouflaged; hallucination substitutes random races like the textui.
 *  - Objects come from the player's known object piles, so unknown items
 *    appear as "unknown item" markers.
 *
 * Tile coordinates come from Angband's own visual tables (feat_x_attr,
 * monster_x_attr, kind/flavor tables, trap_x_attr) after loading the
 * graphics mode's pref file, so the Gervais mapping is never hardcoded.
 */
#include "adapter.h"

#include <stdarg.h>

#include "cave.h"
#include "game-world.h"
#include "grafmode.h"
#include "init.h"
#include "message.h"
#include "mon-desc.h"
#include "mon-predicate.h"
#include "mon-util.h"
#include "monster.h"
#include "obj-desc.h"
#include "obj-gear.h"
#include "obj-ignore.h"
#include "obj-knowledge.h"
#include "obj-pile.h"
#include "obj-tval.h"
#include "obj-util.h"
#include "player-calcs.h"
#include "player-spell.h"
#include "player-timed.h"
#include "player-util.h"
#include "project.h"
#include "target.h"
#include "trap.h"
#include "ui-display.h"
#include "ui-object.h"
#include "ui-prefs.h"
#include "z-rand.h"

/* ------------------------------------------------------------------------
 * RNG neutrality
 *
 * map_info() and the hallucination display consume the game RNG (as they
 * do in the stock UI).  To guarantee the frontend cannot alter outcomes we
 * snapshot and restore the full WELL1024a state around every export.
 * ------------------------------------------------------------------------ */
static struct {
	uint32_t state_i, z0, z1, z2, value;
	uint32_t STATE[RAND_DEG];
	bool quick;
	int depth;
} rng_saved;

void rng_save(void)
{
	if (rng_saved.depth++ > 0) return;
	rng_saved.state_i = state_i;
	rng_saved.z0 = z0;
	rng_saved.z1 = z1;
	rng_saved.z2 = z2;
	rng_saved.value = Rand_value;
	rng_saved.quick = Rand_quick;
	memcpy(rng_saved.STATE, STATE, sizeof(STATE));
}

void rng_restore(void)
{
	if (--rng_saved.depth > 0) return;
	state_i = rng_saved.state_i;
	z0 = rng_saved.z0;
	z1 = rng_saved.z1;
	z2 = rng_saved.z2;
	Rand_value = rng_saved.value;
	Rand_quick = rng_saved.quick;
	memcpy(STATE, rng_saved.STATE, sizeof(STATE));
}

/* ------------------------------------------------------------------------
 * Collected messages / effects since the last snapshot
 * ------------------------------------------------------------------------ */
#define MAX_PENDING 512

static jw msg_buf;	/* JSON array body of {text,type} */
static int msg_count;
static jw fx_buf;	/* JSON array body of visual effect records */
static int fx_count;
static int level_serial;	/* bumps on each new level */
static int sent_level_serial = -1;
static uint32_t snapshot_seq;

static void reset_pending(void)
{
	jw_reset(&msg_buf);
	jw_arr_begin(&msg_buf);
	msg_count = 0;
	jw_reset(&fx_buf);
	jw_arr_begin(&fx_buf);
	fx_count = 0;
}

static void add_message(const char *text, int type)
{
	if (msg_count >= MAX_PENDING) return;
	jw_obj_begin(&msg_buf);
	jw_kstr(&msg_buf, "text", text);
	jw_kint(&msg_buf, "type", type);
	jw_kint(&msg_buf, "color", message_type_color((uint16_t)type));
	{
		const char *snd = message_sound_name(type);
		if (snd && *snd) jw_kstr(&msg_buf, "sound", snd);
	}
	jw_obj_end(&msg_buf);
	msg_count++;
}

void snapshot_note(const char *fmt, ...)
{
	char buf[512];
	va_list ap;
	va_start(ap, fmt);
	vsnprintf(buf, sizeof(buf), fmt, ap);
	va_end(ap);
	add_message(buf, MSG_GENERIC);
}

static void ev_message(game_event_type type, game_event_data *data, void *user)
{
	if (data && data->message.msg) add_message(data->message.msg, data->message.type);
}

static void ev_bell(game_event_type type, game_event_data *data, void *user)
{
	if (data && data->message.msg) add_message(data->message.msg, MSG_BELL);
}

static void ev_new_level(game_event_type type, game_event_data *data, void *user)
{
	level_serial++;
}

static void ev_bolt(game_event_type type, game_event_data *data, void *user)
{
	/* bolt.drawing is always false in 4.2's project(); visibility is "seen" */
	if (!data->bolt.seen || fx_count >= MAX_PENDING) return;
	jw_obj_begin(&fx_buf);
	jw_kstr(&fx_buf, "kind", data->bolt.beam ? "beam" : "bolt");
	jw_kint(&fx_buf, "proj", data->bolt.proj_type);
	jw_kint(&fx_buf, "color", projections[data->bolt.proj_type].color);
	jw_kint(&fx_buf, "x", data->bolt.x);
	jw_kint(&fx_buf, "y", data->bolt.y);
	jw_kint(&fx_buf, "fromX", data->bolt.ox);
	jw_kint(&fx_buf, "fromY", data->bolt.oy);
	jw_obj_end(&fx_buf);
	fx_count++;
}

static void ev_missile(game_event_type type, game_event_data *data, void *user)
{
	int row, col;
	if (!data->missile.seen || fx_count >= MAX_PENDING) return;
	jw_obj_begin(&fx_buf);
	jw_kstr(&fx_buf, "kind", "missile");
	jw_kint(&fx_buf, "x", data->missile.x);
	jw_kint(&fx_buf, "y", data->missile.y);
	if (data->missile.obj && snapshot_tile_of_kind(data->missile.obj->kind, &row, &col)) {
		jw_key(&fx_buf, "tile");
		jw_arr_begin(&fx_buf);
		jw_int(&fx_buf, row);
		jw_int(&fx_buf, col);
		jw_arr_end(&fx_buf);
	}
	jw_obj_end(&fx_buf);
	fx_count++;
}

static void ev_explosion(game_event_type type, game_event_data *data, void *user)
{
	int i, seen = 0;
	/* explosion.drawing is always false in 4.2; draw what the player sees */
	if (fx_count >= MAX_PENDING) return;
	for (i = 0; i < data->explosion.num_grids; i++)
		if (data->explosion.player_sees_grid[i]) seen++;
	if (!seen) return;
	jw_obj_begin(&fx_buf);
	jw_kstr(&fx_buf, "kind", "explosion");
	jw_kint(&fx_buf, "proj", data->explosion.proj_type);
	jw_kint(&fx_buf, "color", projections[data->explosion.proj_type].color);
	jw_kint(&fx_buf, "x", data->explosion.centre.x);
	jw_kint(&fx_buf, "y", data->explosion.centre.y);
	jw_key(&fx_buf, "grids");
	jw_arr_begin(&fx_buf);
	for (i = 0; i < data->explosion.num_grids; i++) {
		/* Only grids the player can actually see */
		if (!data->explosion.player_sees_grid[i]) continue;
		jw_arr_begin(&fx_buf);
		jw_int(&fx_buf, data->explosion.blast_grid[i].x);
		jw_int(&fx_buf, data->explosion.blast_grid[i].y);
		jw_int(&fx_buf, data->explosion.distance_to_grid[i]);
		jw_arr_end(&fx_buf);
	}
	jw_arr_end(&fx_buf);
	jw_obj_end(&fx_buf);
	fx_count++;
}

void snapshot_register_events(void)
{
	event_add_handler(EVENT_MESSAGE, ev_message, NULL);
	event_add_handler(EVENT_BELL, ev_bell, NULL);
	event_add_handler(EVENT_NEW_LEVEL_DISPLAY, ev_new_level, NULL);
	event_add_handler(EVENT_BOLT, ev_bolt, NULL);
	event_add_handler(EVENT_MISSILE, ev_missile, NULL);
	event_add_handler(EVENT_EXPLOSION, ev_explosion, NULL);
}

/* ------------------------------------------------------------------------
 * Tiles
 * ------------------------------------------------------------------------ */

/* Graphics-mode attr/char encode the atlas row/column with the high bit set */
static bool tile_from_ac(int a, wchar_t c, int *row, int *col)
{
	if (!(a & 0x80) || !(c & 0x80)) return false;
	*row = a & 0x7F;
	*col = c & 0x7F;
	return true;
}

bool snapshot_tile_of_kind(const struct object_kind *kind, int *row, int *col)
{
	if (!kind) return false;
	return tile_from_ac(object_kind_attr(kind), object_kind_char(kind), row, col);
}

static void write_tile(jw *w, const char *key, int a, wchar_t c)
{
	int row, col;
	jw_key(w, key);
	if (tile_from_ac(a, c, &row, &col)) {
		jw_arr_begin(w);
		jw_int(w, row);
		jw_int(w, col);
		jw_arr_end(w);
	} else {
		jw_null(w);
	}
}

/* ------------------------------------------------------------------------
 * Static data for the hello message
 * ------------------------------------------------------------------------ */
void snapshot_write_static(jw *w)
{
	int i, l;
	graphics_mode *mode = get_graphics_mode(use_graphics);

	jw_key(w, "tileset");
	jw_obj_begin(w);
	if (mode) {
		jw_kint(w, "id", mode->grafID);
		jw_kstr(w, "name", mode->menuname);
		/* URL path relative to the served lib/tiles directory */
		{
			const char *dir = mode->path;
			size_t n = strlen(ANGBAND_DIR_TILES);
			if (!strncmp(dir, ANGBAND_DIR_TILES, n)) dir += n;
			while (*dir == '/') dir++;
			jw_kstr(w, "url", format("tiles/%s/%s", dir, mode->file));
		}
		jw_kint(w, "cellWidth", mode->cell_width);
		jw_kint(w, "cellHeight", mode->cell_height);
	}
	jw_obj_end(w);

	jw_key(w, "features");
	jw_arr_begin(w);
	for (i = 0; i < FEAT_MAX; i++) {
		struct feature *f = &f_info[i];
		if (!f->name) {
			jw_null(w);
			continue;
		}
		jw_obj_begin(w);
		jw_kint(w, "idx", i);
		jw_kstr(w, "name", f->name);
		jw_key(w, "flags");
		jw_arr_begin(w);
#define FLAG_OUT(F, NAME) if (tf_has(f->flags, F)) jw_str(w, NAME)
		FLAG_OUT(TF_LOS, "los");
		FLAG_OUT(TF_PROJECT, "project");
		FLAG_OUT(TF_PASSABLE, "passable");
		FLAG_OUT(TF_INTERESTING, "interesting");
		FLAG_OUT(TF_PERMANENT, "permanent");
		FLAG_OUT(TF_TRAP, "trap");
		FLAG_OUT(TF_FLOOR, "floor");
		FLAG_OUT(TF_WALL, "wall");
		FLAG_OUT(TF_ROCK, "rock");
		FLAG_OUT(TF_GRANITE, "granite");
		FLAG_OUT(TF_MAGMA, "magma");
		FLAG_OUT(TF_QUARTZ, "quartz");
		FLAG_OUT(TF_GOLD, "gold");
		FLAG_OUT(TF_DOOR_ANY, "door");
		FLAG_OUT(TF_DOOR_CLOSED, "door_closed");
		FLAG_OUT(TF_DOOR_LOCKED, "door_locked");
		FLAG_OUT(TF_SHOP, "shop");
		FLAG_OUT(TF_STAIR, "stair");
		FLAG_OUT(TF_UPSTAIR, "upstair");
		FLAG_OUT(TF_DOWNSTAIR, "downstair");
		FLAG_OUT(TF_TORCH, "torch");
		FLAG_OUT(TF_BRIGHT, "bright");
		FLAG_OUT(TF_FIERY, "fiery");
		FLAG_OUT(TF_SMOOTH, "smooth");
#undef FLAG_OUT
		jw_arr_end(w);
		jw_key(w, "tiles");
		jw_arr_begin(w);
		for (l = 0; l < LIGHTING_MAX; l++) {
			int row, col;
			if (tile_from_ac(feat_x_attr[l][i], feat_x_char[l][i], &row, &col)) {
				jw_arr_begin(w);
				jw_int(w, row);
				jw_int(w, col);
				jw_arr_end(w);
			} else {
				jw_null(w);
			}
		}
		jw_arr_end(w);
		jw_obj_end(w);
	}
	jw_arr_end(w);

	/* Angband's colour palette, for status colours and effects */
	jw_key(w, "palette");
	jw_arr_begin(w);
	for (i = 0; i < MAX_COLORS; i++) {
		jw_arr_begin(w);
		jw_int(w, angband_color_table[i][1]);
		jw_int(w, angband_color_table[i][2]);
		jw_int(w, angband_color_table[i][3]);
		jw_arr_end(w);
	}
	jw_arr_end(w);

	/* The player's own tile (r_info[0] is the player race entry) */
	write_tile(w, "playerTile", monster_x_attr[0], monster_x_char[0]);
}

/* ------------------------------------------------------------------------
 * Map with delta encoding
 * ------------------------------------------------------------------------ */
static uint64_t *cell_cache;
static int cache_w, cache_h;

#define CELL_SENT	0x80000000u
#define CELL_DARK_SHIFT	32
#define CELL_GLOW	((uint64_t)1 << 40)

void snapshot_reset_map(void)
{
	mem_free(cell_cache);
	cell_cache = NULL;
	cache_w = cache_h = 0;
}

void snapshot_init(void)
{
	jw_init(&msg_buf);
	jw_init(&fx_buf);
	reset_pending();
}

/* Pending object piles discovered during the map scan */
struct pile_rec {
	struct loc grid;
	struct grid_data g;
};

static void write_known_pile(jw *w, const struct pile_rec *p)
{
	int a = 0;
	wchar_t c = 0;
	struct object *known;
	int count = 0;
	char name[160] = "";

	if (p->g.unseen_money) {
		a = object_kind_attr(unknown_gold_kind);
		c = object_kind_char(unknown_gold_kind);
		my_strcpy(name, "unknown treasure", sizeof(name));
	} else if (p->g.unseen_object) {
		a = object_kind_attr(unknown_item_kind);
		c = object_kind_char(unknown_item_kind);
		my_strcpy(name, "unknown item", sizeof(name));
	} else if (p->g.first_kind) {
		if (p->g.hallucinate) {
			/* Pick a random object kind, as the textui does */
			while (true) {
				struct object_kind *kind = &k_info[randint0(z_info->k_max - 1) + 1];
				if (!kind->name) continue;
				a = kind_x_attr[kind->kidx];
				c = kind_x_char[kind->kidx];
				if (a == 0 || c == 0) continue;
				break;
			}
			my_strcpy(name, "something strange", sizeof(name));
		} else if (p->g.multiple_objects) {
			a = object_kind_attr(pile_kind);
			c = object_kind_char(pile_kind);
		} else {
			a = object_kind_attr(p->g.first_kind);
			c = object_kind_char(p->g.first_kind);
		}
	}

	/* Describe the first displayable known object */
	for (known = square_object(player->cave, p->grid); known; known = known->next) {
		if (known->kind == unknown_item_kind || known->kind == unknown_gold_kind) {
			count++;
			continue;
		}
		if (ignore_known_item_ok(player, known)) continue;
		count++;
		if (!name[0] && !p->g.hallucinate) {
			struct object *real = cave->objects[known->oidx];
			if (real)
				object_desc(name, sizeof(name), real,
					ODESC_PREFIX | ODESC_FULL, player);
		}
	}

	jw_obj_begin(w);
	jw_kint(w, "x", p->grid.x);
	jw_kint(w, "y", p->grid.y);
	write_tile(w, "tile", a, c);
	jw_kstr(w, "name", name);
	jw_kint(w, "count", count);
	jw_kbool(w, "pile", p->g.multiple_objects);
	jw_kbool(w, "seen", p->g.in_view);
	jw_obj_end(w);
}

static void write_map(jw *w, bool full, struct pile_rec **piles, int *n_piles)
{
	int x, y;
	int max_piles = 256, np = 0;
	struct pile_rec *pl = mem_zalloc(max_piles * sizeof(*pl));

	if (!cell_cache || cache_w != cave->width || cache_h != cave->height) {
		snapshot_reset_map();
		cache_w = cave->width;
		cache_h = cave->height;
		cell_cache = mem_zalloc((size_t)cache_w * cache_h * sizeof(uint64_t));
		full = true;
	}
	if (full) memset(cell_cache, 0, (size_t)cache_w * cache_h * sizeof(uint64_t));

	jw_key(w, "map");
	jw_obj_begin(w);
	jw_kint(w, "width", cave->width);
	jw_kint(w, "height", cave->height);
	jw_kbool(w, "full", full);
	jw_key(w, "cells");
	jw_arr_begin(w);
	for (y = 0; y < cave->height; y++) {
		for (x = 0; x < cave->width; x++) {
			struct loc grid = loc(x, y);
			struct grid_data g;
			uint64_t packed;
			int trow = 0, tcol = 0, has_trap = 0, dark = 0, glow;
			uint64_t *slot = &cell_cache[y * cache_w + x];

			map_info(grid, &g);

			/*
			 * Deliberate, small departure from the stock map (user choice):
			 * an unknown grid inside the player's view but unlit is exported
			 * as a "dark silhouette" so a dark corridor between you and a lit
			 * room reads as a corridor.  Mimics apply, so secret doors still
			 * look like granite.
			 */
			if (g.f_idx == FEAT_NONE && square_isview(cave, grid)) {
				struct feature *f = square_feat(cave, grid);
				dark = (int)(f->mimic ? f->mimic->fidx : f->fidx);
			}

			/*
			 * Room light (SQUARE_GLOW) for grids the player knows, so the
			 * client can light rooms as rooms.  g.lighting cannot say this:
			 * it describes light reaching grids in view, and remembered
			 * grids default to LIGHTING_LIT whether they glow or not.
			 */
			glow = (g.f_idx != FEAT_NONE && square_isglow(cave, grid)) ? 1 : 0;

			if (g.trap && !g.hallucinate &&
					(trf_has(g.trap->flags, TRF_VISIBLE) ||
					 trf_has(g.trap->flags, TRF_GLYPH) ||
					 trf_has(g.trap->flags, TRF_WEB))) {
				if (tile_from_ac(trap_x_attr[g.lighting][g.trap->kind->tidx],
						trap_x_char[g.lighting][g.trap->kind->tidx], &trow, &tcol))
					has_trap = 1;
			}

			if (g.first_kind || g.unseen_object || g.unseen_money) {
				if (np == max_piles) {
					max_piles *= 2;
					pl = mem_realloc(pl, max_piles * sizeof(*pl));
				}
				pl[np].grid = grid;
				pl[np].g = g;
				np++;
			}

			packed = CELL_SENT | (g.f_idx & 0xFF) |
				((uint32_t)(g.lighting & 0x3) << 8) |
				((uint32_t)(g.in_view ? 1 : 0) << 10) |
				((uint32_t)has_trap << 11) |
				((uint32_t)(trow & 0x7F) << 12) |
				((uint32_t)(tcol & 0x7F) << 19) |
				((uint64_t)(dark & 0xFF) << CELL_DARK_SHIFT) |
				(glow ? CELL_GLOW : 0);

			if (*slot == packed) continue;
			/* Never-seen unknown grids need not be sent on a full map */
			if (!(*slot & CELL_SENT) && g.f_idx == FEAT_NONE && !dark) {
				*slot = packed;
				continue;
			}
			*slot = packed;

			/* [x, y, feature, lighting, inView, trapTile|null, darkFeature, glow] */
			jw_arr_begin(w);
			jw_int(w, x);
			jw_int(w, y);
			jw_int(w, (long)g.f_idx);
			jw_int(w, g.lighting);
			jw_int(w, g.in_view ? 1 : 0);
			if (has_trap) {
				jw_arr_begin(w);
				jw_int(w, trow);
				jw_int(w, tcol);
				jw_arr_end(w);
			} else {
				jw_null(w);
			}
			jw_int(w, dark);
			jw_int(w, glow);
			jw_arr_end(w);
		}
	}
	jw_arr_end(w);
	jw_obj_end(w);

	*piles = pl;
	*n_piles = np;
}

/* ------------------------------------------------------------------------
 * Monsters
 * ------------------------------------------------------------------------ */
static void write_monsters(jw *w)
{
	int i;
	bool halluc = player->timed[TMD_IMAGE] > 0;

	jw_key(w, "monsters");
	jw_arr_begin(w);
	for (i = 1; i < cave_monster_max(cave); i++) {
		struct monster *mon = cave_monster(cave, i);
		char name[120], status[120];
		int a;
		wchar_t c;

		if (!mon->race) continue;
		if (!monster_is_visible(mon)) continue;
		if (monster_is_camouflaged(mon)) continue;

		if (halluc) {
			while (true) {
				struct monster_race *race = &r_info[randint0(z_info->r_max)];
				if (!race->name) continue;
				a = monster_x_attr[race->ridx];
				c = monster_x_char[race->ridx];
				break;
			}
			my_strcpy(name, "something strange", sizeof(name));
			status[0] = '\0';
		} else {
			a = monster_x_attr[mon->race->ridx];
			c = monster_x_char[mon->race->ridx];
			monster_desc(name, sizeof(name), mon, MDESC_IND_VIS | MDESC_CAPITAL);
			look_mon_desc(status, sizeof(status), i);
		}

		jw_obj_begin(w);
		jw_kint(w, "id", i);
		jw_kint(w, "x", mon->grid.x);
		jw_kint(w, "y", mon->grid.y);
		write_tile(w, "tile", a, c);
		jw_kstr(w, "name", name);
		/* Race shown only when the player can actually tell what it is */
		if (!halluc) jw_kstr(w, "race", mon->race->name);
		jw_kstr(w, "status", status);
		jw_kbool(w, "inView", monster_is_in_view(mon));
		jw_kbool(w, "unique", !halluc && monster_is_shape_unique(mon));
		jw_kbool(w, "asleep", !halluc && mon->m_timed[MON_TMD_SLEEP] > 0);
		/* Health bar is only shown for the tracked monster, as in textui */
		if (!halluc && player->upkeep->health_who == mon && mon->maxhp > 0) {
			jw_kint(w, "healthPct", (long)mon->hp * 100L / mon->maxhp);
		}
		jw_kbool(w, "targeted", target_is_set() && target_get_monster() == mon);
		jw_obj_end(w);
	}
	jw_arr_end(w);
}

/* ------------------------------------------------------------------------
 * Player and gear
 * ------------------------------------------------------------------------ */
void object_to_handle(const struct object *obj, char *buf, size_t len)
{
	int i;
	buf[0] = '\0';
	if (!obj) return;
	for (i = 0; i < z_info->pack_size; i++)
		if (player->upkeep->inven[i] == obj) {
			strnfmt(buf, len, "inven:%d", i);
			return;
		}
	for (i = 0; i < player->body.count; i++)
		if (slot_object(player, i) == obj) {
			strnfmt(buf, len, "equip:%d", i);
			return;
		}
	for (i = 0; i < z_info->quiver_size; i++)
		if (player->upkeep->quiver[i] == obj) {
			strnfmt(buf, len, "quiver:%d", i);
			return;
		}
	{
		int floor_max = z_info->floor_size, n;
		struct object **floor_list = mem_zalloc(floor_max * sizeof(*floor_list));
		n = scan_floor(floor_list, floor_max, player,
			OFLOOR_TEST | OFLOOR_SENSE | OFLOOR_VISIBLE, NULL);
		for (i = 0; i < n; i++)
			if (floor_list[i] == obj) {
				strnfmt(buf, len, "floor:%d", i);
				break;
			}
		mem_free(floor_list);
	}
}

struct object *handle_to_object(const char *handle)
{
	int idx;
	if (!handle) return NULL;
	if (sscanf(handle, "inven:%d", &idx) == 1) {
		if (idx >= 0 && idx < z_info->pack_size) return player->upkeep->inven[idx];
	} else if (sscanf(handle, "equip:%d", &idx) == 1) {
		if (idx >= 0 && idx < player->body.count) return slot_object(player, idx);
	} else if (sscanf(handle, "quiver:%d", &idx) == 1) {
		if (idx >= 0 && idx < z_info->quiver_size) return player->upkeep->quiver[idx];
	} else if (sscanf(handle, "floor:%d", &idx) == 1) {
		int floor_max = z_info->floor_size, n;
		struct object *obj = NULL;
		struct object **floor_list = mem_zalloc(floor_max * sizeof(*floor_list));
		n = scan_floor(floor_list, floor_max, player,
			OFLOOR_TEST | OFLOOR_SENSE | OFLOOR_VISIBLE, NULL);
		if (idx >= 0 && idx < n) obj = floor_list[idx];
		mem_free(floor_list);
		return obj;
	}
	return NULL;
}

/* Which native commands would accept this object (same testers as cmd-obj.c) */
static void write_item_actions(jw *w, struct object *obj, bool equipped)
{
	jw_key(w, "actions");
	jw_arr_begin(w);
	if (equipped) {
		if (obj_can_takeoff(obj)) jw_str(w, "takeoff");
	} else {
		if (obj_can_wear(obj)) jw_str(w, "wield");
	}
	if (tval_is_edible(obj)) jw_str(w, "eat");
	if (tval_is_potion(obj)) jw_str(w, "quaff");
	if (tval_is_scroll(obj)) jw_str(w, "read");
	if (tval_is_staff(obj)) jw_str(w, "use_staff");
	if (tval_is_wand(obj)) jw_str(w, "aim_wand");
	if (tval_is_rod(obj)) jw_str(w, "zap_rod");
	if (obj_is_activatable(obj)) jw_str(w, "activate");
	if (obj_can_refill(obj)) jw_str(w, "refill");
	if (obj_can_fire(obj)) jw_str(w, "fire");
	if (!equipped && obj_can_throw(obj)) jw_str(w, "throw");
	if (obj_can_cast_from(obj) && player_can_cast(player, false)) jw_str(w, "cast");
	if (obj_can_study(obj) && player_can_study(player, false)) jw_str(w, "study");
	if (obj_can_browse(obj)) jw_str(w, "browse");
	if (!equipped || obj_can_takeoff(obj)) jw_str(w, "drop");
	jw_str(w, "inscribe");
	if (obj_has_inscrip(obj)) jw_str(w, "uninscribe");
	jw_str(w, "ignore");
	jw_arr_end(w);
}

void snapshot_write_object_json(jw *w, struct object *obj, const char *handle)
{
	char name[160];
	int row, col;
	bool equipped = handle && !strncmp(handle, "equip:", 6);

	object_desc(name, sizeof(name), obj, ODESC_PREFIX | ODESC_FULL, player);
	jw_obj_begin(w);
	jw_kstr(w, "handle", handle);
	jw_kstr(w, "name", name);
	jw_kint(w, "number", obj->number);
	jw_kint(w, "weight", obj->weight);
	jw_kstr(w, "tval", tval_find_name(obj->tval));
	jw_key(w, "tile");
	if (snapshot_tile_of_kind(obj->kind, &row, &col)) {
		jw_arr_begin(w);
		jw_int(w, row);
		jw_int(w, col);
		jw_arr_end(w);
	} else {
		jw_null(w);
		if (thang_debug)
			fprintf(stderr, "[snapshot] no tile for %s (kidx %d, flavor %d, attr 0x%x char 0x%x)\n",
				name, obj->kind->kidx, obj->kind->flavor ? (int)obj->kind->flavor->fidx : -1,
				object_kind_attr(obj->kind), (unsigned)object_kind_char(obj->kind));
	}
	if (obj->note) jw_kstr(w, "inscription", quark_str(obj->note));
	write_item_actions(w, obj, equipped);
	jw_obj_end(w);
}

static void write_gear(jw *w)
{
	int i;
	char handle[32];

	jw_key(w, "inventory");
	jw_arr_begin(w);
	for (i = 0; i < z_info->pack_size; i++) {
		struct object *obj = player->upkeep->inven[i];
		if (!obj) continue;
		strnfmt(handle, sizeof(handle), "inven:%d", i);
		snapshot_write_object_json(w, obj, handle);
	}
	jw_arr_end(w);

	jw_key(w, "equipment");
	jw_arr_begin(w);
	for (i = 0; i < player->body.count; i++) {
		struct object *obj = slot_object(player, i);
		jw_obj_begin(w);
		jw_kstr(w, "slot", player->body.slots[i].name);
		jw_key(w, "item");
		if (obj) {
			strnfmt(handle, sizeof(handle), "equip:%d", i);
			snapshot_write_object_json(w, obj, handle);
		} else {
			jw_null(w);
		}
		jw_obj_end(w);
	}
	jw_arr_end(w);

	jw_key(w, "quiver");
	jw_arr_begin(w);
	for (i = 0; i < z_info->quiver_size; i++) {
		struct object *obj = player->upkeep->quiver[i];
		if (!obj) continue;
		strnfmt(handle, sizeof(handle), "quiver:%d", i);
		snapshot_write_object_json(w, obj, handle);
	}
	jw_arr_end(w);

	/* Items on the player's own grid (what 'g'/pickup would offer) */
	{
		int floor_max = z_info->floor_size, n;
		struct object **floor_list = mem_zalloc(floor_max * sizeof(*floor_list));
		n = scan_floor(floor_list, floor_max, player,
			OFLOOR_TEST | OFLOOR_SENSE | OFLOOR_VISIBLE, NULL);
		jw_key(w, "floor");
		jw_arr_begin(w);
		for (i = 0; i < n; i++) {
			strnfmt(handle, sizeof(handle), "floor:%d", i);
			snapshot_write_object_json(w, floor_list[i], handle);
		}
		jw_arr_end(w);
		mem_free(floor_list);
	}
}

static void write_status(jw *w)
{
	int i;

	jw_key(w, "status");
	jw_arr_begin(w);
	for (i = 0; i < TMD_MAX; i++) {
		struct timed_grade *grade;
		if (!player->timed[i]) continue;
		grade = timed_effects[i].grade;
		while (grade && player->timed[i] > grade->max) grade = grade->next;
		if (!grade || !grade->name) continue;
		jw_obj_begin(w);
		jw_kstr(w, "name", grade->name);
		jw_kstr(w, "effect", timed_effects[i].name);
		jw_kint(w, "color", grade->color);
		if (i == TMD_FOOD) jw_kint(w, "pct", player->timed[i] / 100);
		jw_obj_end(w);
	}
	if (player->word_recall) {
		jw_obj_begin(w); jw_kstr(w, "name", "Recall"); jw_kint(w, "color", COLOUR_WHITE); jw_obj_end(w);
	}
	if (player->deep_descent) {
		jw_obj_begin(w); jw_kstr(w, "name", "Descent"); jw_kint(w, "color", COLOUR_WHITE); jw_obj_end(w);
	}
	if (player->upkeep->new_spells) {
		jw_obj_begin(w);
		jw_key(w, "name");
		jw_str(w, format("Study (%d)", player->upkeep->new_spells));
		jw_kint(w, "color", player_book_has_unlearned_spells(player) ? COLOUR_WHITE : COLOUR_L_DARK);
		jw_obj_end(w);
	}
	if (square_isdtrap(cave, player->grid)) {
		jw_obj_begin(w);
		jw_kstr(w, "name", "DTrap");
		jw_kint(w, "color", square_dtrap_edge(cave, player->grid) ? COLOUR_YELLOW : COLOUR_L_GREEN);
		jw_obj_end(w);
	}
	if (player->unignoring) {
		jw_obj_begin(w); jw_kstr(w, "name", "Unignoring"); jw_kint(w, "color", COLOUR_WHITE); jw_obj_end(w);
	}
	jw_arr_end(w);
}

static void write_player(jw *w)
{
	int i;
	char buf[32];

	jw_key(w, "player");
	jw_obj_begin(w);
	jw_kstr(w, "name", player->full_name);
	jw_kstr(w, "race", player->race->name);
	jw_kstr(w, "class", player->class->name);
	jw_kstr(w, "title", player->class->title[(player->lev - 1) / 5]);
	jw_kint(w, "x", player->grid.x);
	jw_kint(w, "y", player->grid.y);
	jw_kint(w, "depth", player->depth);
	jw_kint(w, "maxDepth", player->max_depth);
	jw_kbool(w, "daytime", is_daytime());
	jw_kint(w, "level", player->lev);
	jw_kint(w, "maxLevel", player->max_lev);
	jw_kint(w, "exp", player->exp);
	jw_kint(w, "maxExp", player->max_exp);
	jw_kint(w, "expToNext", player->lev < PY_MAX_LEVEL ?
		(long)(player_exp[player->lev - 1] * player->expfact / 100L) : 0);
	jw_kint(w, "hp", player->chp);
	jw_kint(w, "maxHp", player->mhp);
	jw_kint(w, "sp", player->csp);
	jw_kint(w, "maxSp", player->msp);
	jw_kint(w, "gold", player->au);
	jw_kint(w, "ac", player->known_state.ac + player->known_state.to_a);
	jw_kint(w, "speed", player->state.speed - 110);
	/* Light level of the player's square (the stock status bar's "Light") */
	jw_kint(w, "light", square_light(cave, player->grid));
	/* The player's own light source radius, and the Unlight ability */
	jw_kint(w, "lightRadius", player->state.cur_light);
	jw_kbool(w, "unlight", player_has(player, PF_UNLIGHT));
	jw_kint(w, "burden", player->upkeep->total_weight);
	jw_kbool(w, "resting", player_is_resting(player));
	jw_kint(w, "repeats", cmd_get_nrepeats());
	jw_kbool(w, "dead", player->is_dead);
	if (player->is_dead) jw_kstr(w, "diedFrom", player->died_from);
	jw_kbool(w, "canCast", player_can_cast(player, false));
	jw_kbool(w, "canStudy", player->upkeep->new_spells > 0);
	if (player->class->magic.total_spells > 0)
		jw_kstr(w, "spellNoun", player->class->magic.books[0].realm ?
			player->class->magic.books[0].realm->spell_noun : "spell");

	jw_key(w, "stats");
	jw_arr_begin(w);
	for (i = 0; i < STAT_MAX; i++) {
		jw_obj_begin(w);
		jw_kstr(w, "name", stat_names[i]);
		cnv_stat(player->state.stat_use[i], buf, sizeof(buf));
		jw_kstr(w, "value", buf);
		jw_kbool(w, "drained", player->stat_cur[i] < player->stat_max[i]);
		jw_obj_end(w);
	}
	jw_arr_end(w);

	/* What is underfoot */
	{
		struct feature *feat = square_feat(player->cave, player->grid);
		jw_kstr(w, "terrain", feat && feat->name ? feat->name : "");
	}

	/* Level feeling, as in the status bar */
	if (OPT(player, birth_feelings) && player->depth) {
		int obj_feeling = cave->feeling / 10;
		int mon_feeling = cave->feeling - (10 * obj_feeling);
		char lf[16];
		char of[6], mf[6];
		if (cave->feeling_squares < z_info->feeling_need) my_strcpy(of, "?", sizeof(of));
		else if (obj_feeling == 0) my_strcpy(of, "*", sizeof(of));
		else if (obj_feeling == 1) my_strcpy(of, "$", sizeof(of));
		else strnfmt(of, sizeof(of), "%d", 11 - obj_feeling);
		if (mon_feeling == 0) my_strcpy(mf, "?", sizeof(mf));
		else strnfmt(mf, sizeof(mf), "%d", 10 - mon_feeling);
		strnfmt(lf, sizeof(lf), "LF:%s-%s", mf, of);
		jw_kstr(w, "levelFeeling", lf);
	}
	jw_obj_end(w);
	write_status(w);
}

/* ------------------------------------------------------------------------
 * The full state message
 * ------------------------------------------------------------------------ */
struct loc snapshot_player_grid;

void snapshot_send(bool full_map)
{
	jw w;
	struct pile_rec *piles = NULL;
	int n_piles = 0, i;
	static const char *phase_names[] = { "menu", "game", "dead" };

	jw_init(&w);
	jw_obj_begin(&w);
	jw_kstr(&w, "type", "state");
	jw_kint(&w, "seq", (long)++snapshot_seq);
	jw_kstr(&w, "phase", phase_names[session_phase]);

	if (session_phase != PHASE_MENU && character_dungeon && cave && player->cave) {
		rng_save();
		jw_kint(&w, "turn", (long)turn);
		jw_kint(&w, "playerTurns", (long)player->total_energy / 100);
		if (sent_level_serial != level_serial) {
			full_map = true;
			sent_level_serial = level_serial;
		}
		jw_kint(&w, "levelId", level_serial);
		snapshot_player_grid = player->grid;
		write_player(&w);
		write_map(&w, full_map, &piles, &n_piles);
		jw_key(&w, "objects");
		jw_arr_begin(&w);
		for (i = 0; i < n_piles; i++) write_known_pile(&w, &piles[i]);
		jw_arr_end(&w);
		mem_free(piles);
		write_monsters(&w);
		write_gear(&w);
		if (target_is_set()) {
			struct loc tg;
			struct monster *tm = target_get_monster();
			target_get(&tg);
			jw_key(&w, "target");
			jw_obj_begin(&w);
			jw_kint(&w, "x", tg.x);
			jw_kint(&w, "y", tg.y);
			if (tm) jw_kint(&w, "monster", cave_monster_max(cave) > 0 ? tm->midx : 0);
			jw_obj_end(&w);
		}
		if (store_is_open()) store_write_state(&w);
		panels_write(&w, full_map);
		rng_restore();
	}

	jw_arr_end(&msg_buf);
	jw_key(&w, "messages");
	jw_raw(&w, msg_buf.buf);
	jw_arr_end(&fx_buf);
	jw_key(&w, "effects");
	jw_raw(&w, fx_buf.buf);
	reset_pending();

	jw_obj_end(&w);
	proto_send(&w);
	jw_free(&w);
}
