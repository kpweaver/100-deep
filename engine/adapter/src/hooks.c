/**
 * \file hooks.c
 * \brief Angband's game-input hooks implemented as protocol prompts.
 *
 * When a native command needs more input (an item, a direction, a target,
 * a confirmation...) the engine calls one of the hooks in game-input.h.
 * The stock textui shows a menu; we instead send a "prompt" message and
 * block until the client answers.  Because the engine itself asks, the
 * native filters, inscriptions checks and confirmations are all preserved.
 *
 * Every answer is validated against the candidate list the engine produced,
 * so a client cannot select an item or spell the native UI would not offer.
 */
#include "adapter.h"

#include "cave.h"
#include "effects.h"
#include "effects-info.h"
#include "game-input.h"
#include "init.h"
#include "mon-desc.h"
#include "mon-util.h"
#include "monster.h"
#include "obj-curse.h"
#include "obj-desc.h"
#include "obj-gear.h"
#include "obj-knowledge.h"
#include "obj-pile.h"
#include "obj-util.h"
#include "player-calcs.h"
#include "player-spell.h"
#include "target.h"
#include "ui-game.h"
#include "ui-keymap.h"
#include "ui-object.h"

static int prompt_serial;
static jw pending_prompt;	/* JSON of the prompt awaiting an answer */
static bool prompt_active;

bool hooks_prompt_pending(void)
{
	return prompt_active;
}

void hooks_resend_pending(void)
{
	if (prompt_active) proto_send(&pending_prompt);
}

/* Start building a prompt; caller adds fields then calls await_answer() */
static void prompt_begin(jw *w, const char *kind, const char *text)
{
	jw_init(w);
	jw_obj_begin(w);
	jw_kstr(w, "type", "prompt");
	jw_kint(w, "id", ++prompt_serial);
	jw_kstr(w, "kind", kind);
	jw_kstr(w, "prompt", text ? text : "");
}

/*
 * Send the prompt and wait for a matching answer.  Returns the answer
 * message (caller frees) or NULL if the player cancelled.
 *
 * A fresh state snapshot precedes each prompt so the client shows any
 * messages generated so far (e.g. "You have no potions") in context.
 */
static jv *await_answer(jw *w)
{
	int id = prompt_serial;
	jv *result = NULL;

	jw_obj_end(w);

	snapshot_send(false);

	jw_free(&pending_prompt);
	pending_prompt = *w;	/* take ownership */
	prompt_active = true;
	proto_send(&pending_prompt);

	while (true) {
		jv *msg = proto_next();
		const char *type = jv_get_str(msg, "type", "");

		if (streq(type, "answer") || streq(type, "cancel")) {
			long aid = jv_get_int(msg, "id", -1);
			if (aid != id) {
				proto_send_error("stale_answer",
					"Answer for prompt %ld but prompt %d is pending", aid, id);
				jv_free(msg);
				continue;
			}
			if (streq(type, "cancel") || jv_get_bool(msg, "cancel", false)) {
				jv_free(msg);
				result = NULL;
			} else {
				result = msg;
			}
			break;
		}

		if (streq(type, "save")) {
			proto_send_error("prompt_pending", "Cannot save while a prompt is pending");
		} else {
			proto_send_error("prompt_pending",
				"A prompt is awaiting an answer; '%s' ignored", type);
		}
		jv_free(msg);
	}

	prompt_active = false;
	jw_free(&pending_prompt);
	jw_init(&pending_prompt);
	return result;
}

/* ------------------------------------------------------------------------
 * Simple prompts
 * ------------------------------------------------------------------------ */
static bool hook_get_check(const char *prompt)
{
	jw w;
	jv *ans;
	bool yes;

	prompt_begin(&w, "confirm", prompt);
	ans = await_answer(&w);
	if (!ans) return false;
	yes = jv_get_bool(ans, "value", false);
	jv_free(ans);
	return yes;
}

static bool hook_get_string(const char *prompt, char *buf, size_t len)
{
	jw w;
	jv *ans;
	const char *s;

	prompt_begin(&w, "string", prompt);
	jw_kstr(&w, "default", buf);
	jw_kint(&w, "maxLength", (long)len - 1);
	ans = await_answer(&w);
	if (!ans) return false;
	s = jv_get_str(ans, "value", NULL);
	if (!s) {
		jv_free(ans);
		return false;
	}
	my_strcpy(buf, s, len);
	jv_free(ans);
	return true;
}

static int hook_get_quantity(const char *prompt, int max)
{
	jw w;
	jv *ans;
	long n;

	/* Same shortcut as the textui: nothing to ask */
	if (max == 1) return 1;

	prompt_begin(&w, "quantity", prompt ? prompt : "Quantity: ");
	jw_kint(&w, "max", max);
	jw_kint(&w, "default", 1);
	ans = await_answer(&w);
	if (!ans) return 0;
	n = jv_get_int(ans, "value", 0);
	jv_free(ans);
	if (n < 0) n = 0;
	if (n > max) n = max;
	return (int)n;
}

static bool hook_get_com(const char *prompt, char *command)
{
	jw w;
	jv *ans;
	const char *s;

	prompt_begin(&w, "key", prompt);
	ans = await_answer(&w);
	if (!ans) return false;
	s = jv_get_str(ans, "value", "");
	if (!s[0]) {
		jv_free(ans);
		return false;
	}
	*command = s[0];
	jv_free(ans);
	return true;
}

/* ------------------------------------------------------------------------
 * Directions and targets
 * ------------------------------------------------------------------------ */
static bool hook_get_rep_dir(int *dir, bool allow_none)
{
	jw w;
	jv *ans;
	long d;

	prompt_begin(&w, "direction", "Direction?");
	jw_kbool(&w, "allowNone", allow_none);
	ans = await_answer(&w);
	if (!ans) return false;
	d = jv_get_int(ans, "value", -1);
	jv_free(ans);
	if (d < 1 || d > 9 || (d == 5 && !allow_none)) {
		proto_send_error("bad_answer", "Invalid direction %ld", d);
		return false;
	}
	*dir = (int)d;
	return true;
}

static void write_target_candidates(jw *w)
{
	struct point_set *targets = target_get_monsters(TARGET_KILL, NULL, true);
	int i;

	jw_key(w, "targets");
	jw_arr_begin(w);
	for (i = 0; i < point_set_size(targets); i++) {
		struct monster *mon = square_monster(cave, targets->pts[i]);
		char name[120];
		if (!mon) continue;
		monster_desc(name, sizeof(name), mon, MDESC_IND_VIS | MDESC_CAPITAL);
		jw_obj_begin(w);
		jw_kint(w, "id", mon->midx);
		jw_kint(w, "x", mon->grid.x);
		jw_kint(w, "y", mon->grid.y);
		jw_kstr(w, "name", name);
		jw_kint(w, "distance", distance(player->grid, mon->grid));
		jw_obj_end(w);
	}
	jw_arr_end(w);
	point_set_dispose(targets);
}

static bool hook_get_aim_dir(int *dir)
{
	jw w;
	jv *ans;

	prompt_begin(&w, "aim", "Direction or target?");
	jw_kbool(&w, "hasTarget", target_okay());
	rng_save();
	write_target_candidates(&w);
	rng_restore();
	ans = await_answer(&w);
	if (!ans) return false;

	if (jv_has(ans, "monster")) {
		long id = jv_get_int(ans, "monster", 0);
		struct monster *mon = (id > 0 && id < cave_monster_max(cave)) ?
			cave_monster(cave, (int)id) : NULL;
		jv_free(ans);
		/* Native targetability rules */
		if (!mon || !mon->race || !target_able(mon)) {
			proto_send_error("bad_answer", "That monster cannot be targeted");
			return false;
		}
		target_set_monster(mon);
		*dir = DIR_TARGET;
		return true;
	}
	if (jv_get_bool(ans, "useTarget", false)) {
		jv_free(ans);
		if (!target_okay()) {
			proto_send_error("bad_answer", "No valid target");
			return false;
		}
		*dir = DIR_TARGET;
		return true;
	}
	{
		long d = jv_get_int(ans, "value", -1);
		jv_free(ans);
		if (d < 1 || d > 9 || d == 5) {
			proto_send_error("bad_answer", "Invalid direction %ld", d);
			return false;
		}
		*dir = (int)d;
		return true;
	}
}

/* ------------------------------------------------------------------------
 * Items
 * ------------------------------------------------------------------------ */
static bool hook_get_item(struct object **choice, const char *pmt,
		const char *str, cmd_code cmd, item_tester tester, int mode)
{
	int max = z_info->pack_size + z_info->quiver_size + z_info->floor_size +
		player->body.count;
	struct object **items = mem_zalloc(max * sizeof(*items));
	int n = 0, i;
	jw w;
	jv *ans;
	const char *handle;
	struct object *obj = NULL;
	char hbuf[32];

	/* Same candidate rules as textui_get_item(): equipment is unfiltered
	 * only when there is no command and no tester. */
	if (mode & USE_INVEN) {
		for (i = 0; i < z_info->pack_size && n < max; i++)
			if (object_test(tester, player->upkeep->inven[i]))
				items[n++] = player->upkeep->inven[i];
	}
	if (mode & USE_EQUIP) {
		for (i = 0; i < player->body.count && n < max; i++) {
			struct object *eq = slot_object(player, i);
			if (!eq) continue;
			if ((cmd != CMD_NULL || tester != NULL) && !object_test(tester, eq))
				continue;
			items[n++] = eq;
		}
	}
	if (mode & USE_QUIVER) {
		for (i = 0; i < z_info->quiver_size && n < max; i++)
			if (object_test(tester, player->upkeep->quiver[i]))
				items[n++] = player->upkeep->quiver[i];
	}
	if (mode & USE_FLOOR) {
		int floor_max = z_info->floor_size, fn;
		struct object **floor_list = mem_zalloc(floor_max * sizeof(*floor_list));
		fn = scan_floor(floor_list, floor_max, player,
			OFLOOR_TEST | OFLOOR_SENSE | OFLOOR_VISIBLE, tester);
		for (i = 0; i < fn && n < max; i++)
			if (object_test(tester, floor_list[i])) items[n++] = floor_list[i];
		mem_free(floor_list);
	}

	if (!n) {
		if (str) msg("%s", str);
		mem_free(items);
		return false;
	}

	prompt_begin(&w, "item", pmt);
	jw_kint(&w, "command", cmd);
	jw_kstr(&w, "verb", cmd_verb(cmd) ? cmd_verb(cmd) : "");
	jw_key(&w, "items");
	jw_arr_begin(&w);
	for (i = 0; i < n; i++) {
		object_to_handle(items[i], hbuf, sizeof(hbuf));
		snapshot_write_object_json(&w, items[i], hbuf);
	}
	jw_arr_end(&w);
	ans = await_answer(&w);
	if (!ans) {
		mem_free(items);
		return false;
	}

	handle = jv_get_str(ans, "value", NULL);
	if (handle) {
		struct object *picked = handle_to_object(handle);
		for (i = 0; i < n; i++)
			if (items[i] == picked) obj = picked;
	}
	jv_free(ans);
	mem_free(items);

	if (!obj) {
		proto_send_error("bad_answer", "Item not among the offered choices");
		return false;
	}

	/* Native inscription checks ("!q", "!*"), which may ask to confirm */
	if (!get_item_allow(obj, cmd_lookup_key(cmd, KEYMAP_MODE_ORIG), cmd,
			(mode & IS_HARMLESS) ? true : false))
		return false;

	*choice = obj;
	return true;
}

/* ------------------------------------------------------------------------
 * Spells
 * ------------------------------------------------------------------------ */
static void write_spell(jw *w, struct player *p, int sidx, const char *book_handle,
		bool (*spell_filter)(const struct player *p, int spell))
{
	const struct class_spell *spell = spell_by_index(p, sidx);
	char info[64] = "";

	if (!spell) return;
	if (spell->slevel < 99) get_spell_info(sidx, info, sizeof(info));
	jw_obj_begin(w);
	jw_kint(w, "index", sidx);
	jw_kstr(w, "name", spell->name);
	jw_kint(w, "level", spell->slevel);
	jw_kint(w, "mana", spell->smana);
	jw_kint(w, "fail", spell_chance(sidx));
	jw_kstr(w, "info", info);
	jw_kstr(w, "description", spell->text);
	jw_kbool(w, "learned", (p->spell_flags[sidx] & PY_SPELL_LEARNED) ? true : false);
	jw_kbool(w, "allowed", spell_filter ? spell_filter(p, sidx) : true);
	if (book_handle) jw_kstr(w, "book", book_handle);
	jw_obj_end(w);
}

static int hook_get_spell_from_book(struct player *p, const char *verb,
		struct object *book, const char *error,
		bool (*spell_filter)(const struct player *p, int spell))
{
	int *spells = NULL;
	int n, i, any = 0;
	jw w;
	jv *ans;
	long idx;
	char handle[32];

	n = spell_collect_from_book(p, book, &spells);
	for (i = 0; i < n; i++)
		if (!spell_filter || spell_filter(p, spells[i])) any++;
	if (!any) {
		if (error) msg("%s", error);
		mem_free(spells);
		return -1;
	}

	track_object(p->upkeep, book);
	object_to_handle(book, handle, sizeof(handle));
	prompt_begin(&w, "spell", format("%s which %s?", verb,
		player_object_to_book(p, book)->realm->spell_noun));
	jw_kstr(&w, "verb", verb);
	jw_key(&w, "spells");
	jw_arr_begin(&w);
	for (i = 0; i < n; i++) write_spell(&w, p, spells[i], handle, spell_filter);
	jw_arr_end(&w);
	ans = await_answer(&w);
	if (!ans) {
		mem_free(spells);
		return -1;
	}
	idx = jv_get_int(ans, "value", -1);
	jv_free(ans);

	for (i = 0; i < n; i++) {
		if (spells[i] == idx && (!spell_filter || spell_filter(p, (int)idx))) {
			mem_free(spells);
			return (int)idx;
		}
	}
	mem_free(spells);
	proto_send_error("bad_answer", "Spell not available");
	return -1;
}

/*
 * Choose book and spell in a single prompt.  The textui asks for the book
 * first; here every eligible book's spells are listed together and the
 * answer names both, which yields the same native (book, spell) arguments.
 */
static int hook_get_spell(struct player *p, const char *verb,
		item_tester book_filter, cmd_code cmd, const char *book_error,
		bool (*spell_filter)(const struct player *p, int spell),
		const char *spell_error, struct object **rtn_book)
{
	int max = z_info->pack_size + z_info->floor_size;
	struct object **books = mem_zalloc(max * sizeof(*books));
	int nb, i, j, allowed = 0;
	jw w;
	jv *ans;
	long idx;
	const char *bh;
	struct object *chosen_book = NULL;
	char handle[32];

	nb = scan_items(books, max, p, USE_INVEN | USE_FLOOR, book_filter);
	if (!nb) {
		if (book_error) msg("%s", book_error);
		mem_free(books);
		return -1;
	}

	prompt_begin(&w, "spell", format("%s which %s?", verb,
		p->class->magic.books[0].realm ? p->class->magic.books[0].realm->spell_noun : "spell"));
	jw_kstr(&w, "verb", verb);
	jw_key(&w, "spells");
	jw_arr_begin(&w);
	for (i = 0; i < nb; i++) {
		int *spells = NULL;
		int n = spell_collect_from_book(p, books[i], &spells);
		object_to_handle(books[i], handle, sizeof(handle));
		for (j = 0; j < n; j++) {
			write_spell(&w, p, spells[j], handle, spell_filter);
			if (!spell_filter || spell_filter(p, spells[j])) allowed++;
		}
		mem_free(spells);
	}
	jw_arr_end(&w);

	if (!allowed) {
		jw_free(&w);
		if (spell_error) msg("%s", spell_error);
		mem_free(books);
		return -1;
	}

	ans = await_answer(&w);
	if (!ans) {
		mem_free(books);
		return -1;
	}
	idx = jv_get_int(ans, "value", -1);
	bh = jv_get_str(ans, "book", NULL);
	if (bh) {
		struct object *b = handle_to_object(bh);
		for (i = 0; i < nb; i++) if (books[i] == b) chosen_book = b;
	}
	jv_free(ans);
	mem_free(books);

	if (chosen_book) {
		int *spells = NULL;
		int n = spell_collect_from_book(p, chosen_book, &spells);
		for (j = 0; j < n; j++) {
			if (spells[j] == idx && (!spell_filter || spell_filter(p, (int)idx))) {
				mem_free(spells);
				if (rtn_book) *rtn_book = chosen_book;
				return (int)idx;
			}
		}
		mem_free(spells);
	}
	proto_send_error("bad_answer", "Spell not available");
	return -1;
}

/* ------------------------------------------------------------------------
 * Curses and effect lists
 * ------------------------------------------------------------------------ */
static bool hook_get_curse(int *choice, struct object *obj, char *dice_string)
{
	jw w;
	jv *ans;
	int i, count = 0;
	long idx;

	prompt_begin(&w, "curse", format("Remove which curse (spell strength %s)?", dice_string));
	jw_key(&w, "choices");
	jw_arr_begin(&w);
	for (i = 1; i < z_info->curse_max; i++) {
		if (obj->known->curses && obj->known->curses[i].power > 0 &&
				obj->known->curses[i].power < 100 && player_knows_curse(player, i)) {
			jw_obj_begin(&w);
			jw_kint(&w, "value", i);
			jw_kstr(&w, "name", curses[i].name);
			jw_kint(&w, "power", obj->curses[i].power);
			jw_obj_end(&w);
			count++;
		}
	}
	jw_arr_end(&w);
	if (!count) {
		jw_free(&w);
		return false;
	}
	ans = await_answer(&w);
	if (!ans) return false;
	idx = jv_get_int(ans, "value", 0);
	jv_free(ans);
	if (idx < 1 || idx >= z_info->curse_max || !obj->known->curses ||
			obj->known->curses[idx].power <= 0 || obj->known->curses[idx].power >= 100 ||
			!player_knows_curse(player, (int)idx)) {
		proto_send_error("bad_answer", "Invalid curse");
		return false;
	}
	*choice = (int)idx;
	return true;
}

static int hook_get_effect_from_list(const char *prompt, struct effect *effect,
		int count, bool allow_random)
{
	jw w;
	jv *ans;
	struct effect *e;
	int i;
	long idx;
	char name[160];

	if (count == -1) {
		count = 0;
		for (e = effect; e; e = effect_next(e)) count++;
	}

	prompt_begin(&w, "choice", prompt ? prompt : "Which effect?");
	jw_key(&w, "choices");
	jw_arr_begin(&w);
	for (i = 0, e = effect; e && i < count; i++, e = effect_next(e)) {
		effect_get_menu_name(name, sizeof(name), e);
		jw_obj_begin(&w);
		jw_kint(&w, "value", i);
		jw_kstr(&w, "name", name);
		jw_obj_end(&w);
	}
	if (allow_random) {
		jw_obj_begin(&w);
		jw_kint(&w, "value", -2);
		jw_kstr(&w, "name", "random");
		jw_obj_end(&w);
	}
	jw_arr_end(&w);
	ans = await_answer(&w);
	if (!ans) return -1;
	idx = jv_get_int(ans, "value", -1);
	jv_free(ans);
	if ((idx >= 0 && idx < count) || (allow_random && idx == -2)) return (int)idx;
	return -1;
}

/* ------------------------------------------------------------------------
 * Panel hooks
 *
 * The client presents the entire level (first-person view plus full
 * minimap), equivalent to a stock frontend whose map window shows the whole
 * dungeon.  The panel is therefore the full level.
 * ------------------------------------------------------------------------ */
static void hook_get_panel(int *min_y, int *min_x, int *max_y, int *max_x)
{
	*min_y = 0;
	*min_x = 0;
	*max_y = cave ? cave->height : 0;
	*max_x = cave ? cave->width : 0;
}

static bool hook_panel_contains(unsigned int y, unsigned int x)
{
	return cave && y < (unsigned)cave->height && x < (unsigned)cave->width;
}

static bool hook_map_is_visible(void)
{
	return true;
}

static bool hook_confirm_debug(void)
{
	/* Debug/wizard commands are never exposed through this frontend */
	return false;
}

static void hook_view_abilities(struct player_ability *ability_list, int num_abilities)
{
}

void hooks_install(void)
{
	jw_init(&pending_prompt);
	get_string_hook = hook_get_string;
	get_quantity_hook = hook_get_quantity;
	get_check_hook = hook_get_check;
	get_com_hook = hook_get_com;
	get_rep_dir_hook = hook_get_rep_dir;
	get_aim_dir_hook = hook_get_aim_dir;
	get_spell_from_book_hook = hook_get_spell_from_book;
	get_spell_hook = hook_get_spell;
	get_item_hook = hook_get_item;
	get_curse_hook = hook_get_curse;
	get_effect_from_list_hook = hook_get_effect_from_list;
	confirm_debug_hook = hook_confirm_debug;
	get_panel_hook = hook_get_panel;
	panel_contains_hook = hook_panel_contains;
	map_is_visible_hook = hook_map_is_visible;
	view_abilities_hook = hook_view_abilities;
}
