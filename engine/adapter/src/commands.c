/**
 * \file commands.c
 * \brief Translate client "command" messages into native Angband commands.
 *
 * Each action maps to an existing cmd_code (or, for the handful of textui
 * conveniences that are not commands, to the same core function the textui
 * calls).  Optional arguments supplied by the client are attached with the
 * native cmd_set_arg_* functions; the engine still validates them with its
 * own filters and falls back to asking (via the hooks) when they are absent
 * or unacceptable.  No game rule is implemented here.
 */
#include "adapter.h"

#include "cave.h"
#include "cmd-core.h"
#include "cmds.h"
#include "mon-desc.h"
#include "game-input.h"
#include "mon-util.h"
#include "monster.h"
#include "obj-ignore.h"
#include "obj-knowledge.h"
#include "player-attack.h"
#include "player-calcs.h"
#include "player-util.h"
#include "target.h"

static char last_error[256];

const char *commands_last_error(void)
{
	return last_error;
}

static bool fail(const char *fmt, const char *arg)
{
	strnfmt(last_error, sizeof(last_error), fmt, arg ? arg : "");
	return false;
}

struct action_map {
	const char *name;
	cmd_code code;
	/* Argument usage */
	bool takes_dir;		/* "direction" argument */
	bool takes_item;	/* "item" argument */
	bool takes_target;	/* "target" (aim) argument */
	bool (*prereq)(void);	/* textui prerequisite check, if any */
};

static const struct action_map actions[] = {
	/* Movement */
	{ "walk",          CMD_WALK,        true,  false, false, NULL },
	{ "run",           CMD_RUN,         true,  false, false, NULL },
	{ "jump",          CMD_JUMP,        true,  false, false, NULL },
	{ "hold",          CMD_HOLD,        false, false, false, NULL },
	{ "go_up",         CMD_GO_UP,       false, false, false, NULL },
	{ "go_down",       CMD_GO_DOWN,     false, false, false, NULL },
	{ "explore",       CMD_EXPLORE,     false, false, false, NULL },
	{ "navigate_up",   CMD_NAVIGATE_UP, false, false, false, NULL },
	{ "navigate_down", CMD_NAVIGATE_DOWN, false, false, false, NULL },
	/* Terrain interaction */
	{ "open",          CMD_OPEN,        true,  false, false, NULL },
	{ "close",         CMD_CLOSE,       true,  false, false, NULL },
	{ "tunnel",        CMD_TUNNEL,      true,  false, false, NULL },
	{ "disarm",        CMD_DISARM,      true,  false, false, NULL },
	{ "alter",         CMD_ALTER,       true,  false, false, NULL },
	{ "steal",         CMD_STEAL,       true,  false, false, NULL },
	/* Objects */
	{ "pickup",        CMD_PICKUP,      false, true,  false, NULL },
	{ "autopickup",    CMD_AUTOPICKUP,  false, false, false, NULL },
	{ "wield",         CMD_WIELD,       false, true,  false, NULL },
	{ "takeoff",       CMD_TAKEOFF,     false, true,  false, NULL },
	{ "drop",          CMD_DROP,        false, true,  false, NULL },
	{ "eat",           CMD_EAT,         false, true,  false, NULL },
	{ "quaff",         CMD_QUAFF,       false, true,  false, NULL },
	{ "read",          CMD_READ_SCROLL, false, true,  false, player_can_read_prereq },
	{ "use_staff",     CMD_USE_STAFF,   false, true,  false, NULL },
	{ "aim_wand",      CMD_USE_WAND,    false, true,  true,  NULL },
	{ "zap_rod",       CMD_USE_ROD,     false, true,  true,  NULL },
	{ "activate",      CMD_ACTIVATE,    false, true,  true,  NULL },
	{ "use",           CMD_USE,         false, true,  true,  NULL },
	{ "refill",        CMD_REFILL,      false, true,  false, player_can_refuel_prereq },
	{ "fire",          CMD_FIRE,        false, true,  true,  player_can_fire_prereq },
	{ "throw",         CMD_THROW,       false, true,  true,  NULL },
	{ "inscribe",      CMD_INSCRIBE,    false, true,  false, NULL },
	{ "uninscribe",    CMD_UNINSCRIBE,  false, true,  false, NULL },
	/* Magic */
	{ "study",         CMD_STUDY,       false, true,  false, player_can_study_prereq },
	{ "cast",          CMD_CAST,        false, false, true,  player_can_cast_prereq },
	/* Time */
	{ "rest",          CMD_REST,        false, false, false, NULL },
	{ NULL, CMD_NULL, false, false, false, NULL }
};

static const struct action_map *find_action(const char *name)
{
	int i;
	for (i = 0; actions[i].name; i++)
		if (streq(actions[i].name, name)) return &actions[i];
	return NULL;
}

/* ------------------------------------------------------------------------
 * Free (non-turn) UI actions that the textui performs directly
 * ------------------------------------------------------------------------ */

/* Target cycling: same candidate list and rules as the textui's targeting */
static bool target_cycle(int step)
{
	struct point_set *targets = target_get_monsters(TARGET_KILL, NULL, true);
	int n = point_set_size(targets), i, cur = -1;
	struct monster *mon;

	if (!n) {
		point_set_dispose(targets);
		msg("No Available Target.");
		return false;
	}
	if (target_is_set() && target_get_monster()) {
		struct monster *t = target_get_monster();
		for (i = 0; i < n; i++)
			if (loc_eq(targets->pts[i], t->grid)) cur = i;
	}
	cur = (cur < 0) ? 0 : (cur + step + n) % n;
	mon = square_monster(cave, targets->pts[cur]);
	point_set_dispose(targets);
	if (mon && target_able(mon)) {
		char name[120];
		target_set_monster(mon);
		health_track(player->upkeep, mon);
		monster_race_track(player->upkeep, mon->race);
		monster_desc(name, sizeof(name), mon, MDESC_IND_VIS | MDESC_CAPITAL);
		msg("Targeting %s.", name);
		return true;
	}
	return false;
}

/* ------------------------------------------------------------------------
 * Dispatch
 * ------------------------------------------------------------------------ */
bool commands_dispatch(const jv *msg)
{
	const char *name = jv_get_str(msg, "action", "");
	const struct action_map *a;
	struct command *cmd;

	last_error[0] = '\0';

	if (session_phase != PHASE_GAME || player->is_dead)
		return fail("No game in progress", NULL);

	/* Free actions handled like the textui does (no energy used) */
	if (streq(name, "target_closest")) {
		if (target_set_closest(TARGET_KILL, NULL)) {
			struct monster *mon = target_get_monster();
			if (mon) health_track(player->upkeep, mon);
		}
		return false;
	}
	if (streq(name, "target_next") || streq(name, "target_prev")) {
		target_cycle(streq(name, "target_next") ? 1 : -1);
		return false;
	}
	if (streq(name, "target_clear")) {
		target_set_monster(NULL);
		return false;
	}
	if (streq(name, "target_monster")) {
		long id = jv_get_int(msg, "monster", 0);
		struct monster *mon = (id > 0 && id < cave_monster_max(cave)) ?
			cave_monster(cave, (int)id) : NULL;
		if (!mon || !mon->race || !target_able(mon))
			return fail("That monster cannot be targeted", NULL);
		target_set_monster(mon);
		health_track(player->upkeep, mon);
		monster_race_track(player->upkeep, mon->race);
		return false;
	}
	if (streq(name, "fire_at_nearest")) {
		/* Core function bound to 'h'/TAB in the textui */
		if (!player_can_fire_prereq()) return false;
		do_cmd_fire_at_nearest();
		return cmdq_peek() != NULL;
	}
	if (streq(name, "ignore")) {
		/* textui "This item only" / "Unignore this item" */
		struct object *obj = handle_to_object(jv_get_str(msg, "item", NULL));
		if (!obj) return fail("No such item", NULL);
		if (obj->known->notice & OBJ_NOTICE_IGNORE)
			obj->known->notice &= ~(OBJ_NOTICE_IGNORE);
		else
			obj->known->notice |= OBJ_NOTICE_IGNORE;
		player->upkeep->notice |= PN_IGNORE;
		notice_stuff(player);
		handle_stuff(player);
		return false;
	}
	if (streq(name, "toggle_unignore")) {
		player->unignoring = !player->unignoring;
		player->upkeep->notice |= PN_IGNORE;
		notice_stuff(player);
		handle_stuff(player);
		return false;
	}
	if (streq(name, "pathfind")) {
		/* Travel to a known grid (the textui's mouse-click travel).  The
		 * core does no argument checking, so validate here; pathing uses
		 * only the player's memory, so nothing hidden is revealed. */
		struct loc grid = loc((int)jv_get_int(msg, "x", -1), (int)jv_get_int(msg, "y", -1));
		if (!square_in_bounds_fully(cave, grid) || !square_isknown(cave, grid))
			return fail("Cannot travel there", NULL);
		if (player->upkeep->steps) {
			mem_free(player->upkeep->steps);
			player->upkeep->steps = NULL;
		}
		cmdq_push(CMD_PATHFIND);
		cmd_set_arg_point(cmdq_peek(), "point", grid);
		return true;
	}
	if (streq(name, "feeling")) {
		display_feeling(false);
		return false;
	}

	a = find_action(name);
	if (!a) return fail("Unknown action '%s'", name);

	if (a->prereq && !a->prereq()) return false;

	if (cmdq_push(a->code) != 0) return fail("Command queue full", NULL);
	cmd = cmdq_peek();

	if (a->takes_dir && jv_has(msg, "dir")) {
		long dir = jv_get_int(msg, "dir", 0);
		if (dir < 1 || dir > 9) {
			cmdq_flush();
			return fail("Invalid direction", NULL);
		}
		cmd_set_arg_direction(cmd, "direction", (int)dir);
	}

	if (a->takes_item && jv_has(msg, "item")) {
		const char *handle = jv_get_str(msg, "item", NULL);
		struct object *obj = handle_to_object(handle);
		if (!obj) {
			cmdq_flush();
			return fail("No item '%s'", handle);
		}
		cmd_set_arg_item(cmd, "item", obj);
	}

	if (a->takes_item && jv_has(msg, "quantity"))
		cmd_set_arg_number(cmd, "quantity", (int)jv_get_int(msg, "quantity", 1));

	if (a->takes_target) {
		if (jv_get_bool(msg, "useTarget", false))
			cmd_set_arg_target(cmd, "target", DIR_TARGET);
		else if (jv_has(msg, "dir")) {
			long dir = jv_get_int(msg, "dir", 0);
			if (dir >= 1 && dir <= 9 && dir != 5)
				cmd_set_arg_target(cmd, "target", (int)dir);
		}
	}

	switch (a->code) {
		case CMD_CAST:
		case CMD_STUDY:
			if (jv_has(msg, "book")) {
				struct object *book = handle_to_object(jv_get_str(msg, "book", NULL));
				if (book) cmd_set_arg_item(cmd, "book", book);
			}
			if (jv_has(msg, "spell"))
				cmd_set_arg_choice(cmd, "spell", (int)jv_get_int(msg, "spell", -1));
			break;
		case CMD_INSCRIBE:
			if (jv_has(msg, "text")) {
				/* Same limit as the textui's inscription prompt */
				char text[80];
				my_strcpy(text, jv_get_str(msg, "text", ""), sizeof(text));
				cmd_set_arg_string(cmd, "inscription", text);
			}
			break;
		case CMD_REST: {
			const char *mode = jv_get_str(msg, "mode", "as_needed");
			int choice;
			if (streq(mode, "as_needed")) choice = REST_COMPLETE;
			else if (streq(mode, "hp_sp")) choice = REST_ALL_POINTS;
			else if (streq(mode, "hp_or_sp")) choice = REST_SOME_POINTS;
			else if (streq(mode, "turns")) {
				choice = (int)jv_get_int(msg, "turns", 1);
				if (choice < 1 || choice > 9999) {
					cmdq_flush();
					return fail("Rest turns must be 1-9999", NULL);
				}
			} else {
				cmdq_flush();
				return fail("Unknown rest mode '%s'", mode);
			}
			cmd_set_arg_choice(cmd, "choice", choice);
			break;
		}
		default:
			break;
	}

	return true;
}
