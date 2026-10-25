/**
 * \file main-headless.c
 * \brief Entry point for the headless, protocol-driven Angband engine.
 *
 * This executable links the unmodified Angband core and replaces main.c +
 * the textui with a JSON-lines protocol.  The game flow mirrors
 * ui-game.c's play_game()/start_game()/close_game(): birth uses the native
 * CMD_BIRTH_* commands, play pushes native commands and runs
 * run_game_loop(), death records knowledge, score and the dead savefile.
 *
 * Usage:
 *   angband-headless --lib <angband lib dir> --data <writable dir>
 *                    [--save <name>] [--seed <n>] [--debug]
 */
#include "adapter.h"

#include <locale.h>
#include <signal.h>
#include <stdarg.h>
#include <time.h>

#include "buildid.h"
#include "cave.h"
#include "cmd-core.h"
#include "game-world.h"
#include "generate.h"
#include "grafmode.h"
#include "init.h"
#include "mon-lore.h"
#include "mon-make.h"
#include "mon-predicate.h"
#include "mon-util.h"
#include "monster.h"
#include "obj-desc.h"
#include "obj-info.h"
#include "obj-knowledge.h"
#include "obj-util.h"
#include "option.h"
#include "player-birth.h"
#include "player-calcs.h"
#include "player-spell.h"
#include "player-timed.h"
#include "player-util.h"
#include "savefile.h"
#include "ui-game.h"
#include "ui-mon-lore.h"
#include "ui-prefs.h"
#include "z-textblock.h"

enum session_phase session_phase = PHASE_MENU;
bool thang_debug = false;

static const char *opt_lib = NULL;
static const char *opt_data = NULL;
static const char *opt_save = "hero";
static long opt_seed = -1;

/* ------------------------------------------------------------------------
 * Logging / fatal errors
 * ------------------------------------------------------------------------ */
static void plog_stderr(const char *str)
{
	fprintf(stderr, "[angband] %s\n", str);
}

static void quit_hook_fn(const char *str)
{
	if (str && *str) {
		fprintf(stderr, "[angband] fatal: %s\n", str);
		proto_send_error("fatal", "%s", str);
	}
}

/* ------------------------------------------------------------------------
 * Hello / resync
 * ------------------------------------------------------------------------ */
static void send_hello(void)
{
	jw w;
	struct player_race *r;
	struct player_class *c;
	int i;

	jw_init(&w);
	jw_obj_begin(&w);
	jw_kstr(&w, "type", "hello");
	jw_kint(&w, "protocol", THANG_PROTOCOL_VERSION);
	jw_kstr(&w, "engine", buildid);
	jw_kstr(&w, "savefile", savefile);
	jw_kbool(&w, "saveExists", file_exists(savefile));

	/* Birth choices straight from the game data */
	jw_key(&w, "races");
	jw_arr_begin(&w);
	for (r = races; r; r = r->next) jw_str(&w, r->name);
	jw_arr_end(&w);
	jw_key(&w, "classes");
	jw_arr_begin(&w);
	for (c = classes; c; c = c->next) jw_str(&w, c->name);
	jw_arr_end(&w);

	/* Interface and birth options (cheat options are never exposed) */
	jw_key(&w, "options");
	jw_arr_begin(&w);
	for (i = 0; i < OPT_MAX; i++) {
		int t = option_type(i);
		if (!option_name(i) || (t != OP_INTERFACE && t != OP_BIRTH)) continue;
		jw_obj_begin(&w);
		jw_kstr(&w, "name", option_name(i));
		jw_kstr(&w, "description", option_desc(i));
		jw_kstr(&w, "kind", t == OP_BIRTH ? "birth" : "interface");
		jw_kbool(&w, "value", player->opts.opt[i]);
		jw_obj_end(&w);
	}
	jw_arr_end(&w);

	snapshot_write_static(&w);
	jw_obj_end(&w);
	proto_send(&w);
	jw_free(&w);
}

static void resync(void)
{
	send_hello();
	snapshot_send(true);
	hooks_resend_pending();
}

/* ------------------------------------------------------------------------
 * Saving (mirrors save_game_checked() without terminal output)
 * ------------------------------------------------------------------------ */
static bool save_now(void)
{
	bool ok;

	if (session_phase != PHASE_GAME || !character_generated || player->is_dead)
		return false;

	disturb(player);
	handle_stuff(player);
	my_strcpy(player->died_from, "(saved)", sizeof(player->died_from));
	ok = savefile_save(savefile);
	if (!lore_save("lore.txt")) plog("lore save failed!");
	my_strcpy(player->died_from, "(alive and well)", sizeof(player->died_from));
	return ok;
}

static void ev_autosave(game_event_type type, game_event_data *data, void *user)
{
	if (player->upkeep->autosave) {
		save_now();
		player->upkeep->autosave = false;
	}
}

static void on_eof(void)
{
	/* The client went away for good: save like a SIGHUP in the stock game */
	if (session_phase == PHASE_GAME) save_now();
}

/* ------------------------------------------------------------------------
 * Visuals: load the graphics mode's pref files (Gervais = mode 3)
 * ------------------------------------------------------------------------ */
static void load_visuals(void)
{
	/* Pref files can contain conditionals on race/class; re-evaluate */
	reset_visuals(true);
}

/* ------------------------------------------------------------------------
 * Engine lifecycle
 * ------------------------------------------------------------------------ */
static void register_handlers(void)
{
	snapshot_register_events();
	event_add_handler(EVENT_NEW_LEVEL_DISPLAY, ev_autosave, NULL);
}

static void engine_init(void)
{
	init_angband();
	if (opt_seed >= 0) Rand_state_init((uint32_t)opt_seed);
	register_handlers();
}

/* Restart the core for a fresh game (the play_again path of play_game()) */
static void engine_reinit(void)
{
	play_again = true;
	if (cave) wipe_mon_list(cave, player);
	cleanup_angband();
	chunk_list_max = 0;
	init_angband();
	play_again = false;
	if (opt_seed >= 0) Rand_state_init((uint32_t)opt_seed);
	register_handlers();
	snapshot_reset_map();
	panels_reset();
}

/* Enter the world after birth or load (mirrors start_game()) */
static void enter_world(void)
{
	event_signal(EVENT_LEAVE_INIT);
	event_signal(EVENT_ENTER_GAME);
	event_signal(EVENT_ENTER_WORLD);
	player->upkeep->autosave = false;
	if (!character_dungeon) prepare_next_level(player);
	on_new_level();
	session_phase = PHASE_GAME;
	load_visuals();
	snapshot_reset_map();
}

/* Apply {"name": bool} pairs for options of the given type only */
static void apply_options(const jv *set, int allowed_type)
{
	int i, opt;
	if (!set || set->type != JV_OBJ) return;
	for (i = 0; i < set->count; i++) {
		bool found = false;
		for (opt = 0; opt < OPT_MAX; opt++) {
			if (!option_name(opt) || !streq(option_name(opt), set->keys[i])) continue;
			found = true;
			if (option_type(opt) != allowed_type) {
				proto_send_error("bad_option", "Option '%s' cannot be changed now",
					set->keys[i]);
				break;
			}
			option_set(set->keys[i], (set->items[i]->type == JV_BOOL) ?
				set->items[i]->b : set->items[i]->n != 0);
			break;
		}
		if (!found) proto_send_error("bad_option", "Unknown option '%s'", set->keys[i]);
	}
}

static struct player_race *find_race(const char *name)
{
	struct player_race *r;
	for (r = races; r; r = r->next)
		if (name && streq(r->name, name)) return r;
	return NULL;
}

static struct player_class *find_class(const char *name)
{
	struct player_class *c;
	for (c = classes; c; c = c->next)
		if (name && streq(c->name, name)) return c;
	return NULL;
}

static void handle_new_game(const jv *msg)
{
	struct player_race *r = find_race(jv_get_str(msg, "race", "Human"));
	struct player_class *c = find_class(jv_get_str(msg, "class", "Warrior"));
	const char *name = jv_get_str(msg, "name", "Adventurer");
	const char *stats = jv_get_str(msg, "stats", "points");

	if (!r || !c) {
		proto_send_error("bad_birth", "Unknown race or class");
		return;
	}
	if (!name[0] || strlen(name) >= PLAYER_NAME_LEN) {
		proto_send_error("bad_birth", "Invalid name");
		return;
	}

	if (character_generated || session_phase != PHASE_MENU) engine_reinit();

	/* Native birth sequence (as player_make_simple / ui-birth.c) */
	player->is_dead = true;
	character_generated = false;
	cmdq_push(CMD_BIRTH_INIT);
	cmdq_push(CMD_BIRTH_RESET);
	cmdq_push(CMD_CHOOSE_RACE);
	cmd_set_arg_choice(cmdq_peek(), "choice", r->ridx);
	cmdq_push(CMD_CHOOSE_CLASS);
	cmd_set_arg_choice(cmdq_peek(), "choice", c->cidx);
	if (streq(stats, "roll")) cmdq_push(CMD_ROLL_STATS);
	cmdq_execute(CTX_BIRTH);
	/* Birth options, as set in the birth screen's options menu */
	apply_options(jv_get(msg, "birthOptions"), OP_BIRTH);
	apply_options(jv_get(msg, "options"), OP_INTERFACE);
	cmdq_push(CMD_NAME_CHOICE);
	cmd_set_arg_string(cmdq_peek(), "name", name);
	cmdq_push(CMD_ACCEPT_CHARACTER);
	cmdq_execute(CTX_BIRTH);

	if (!character_generated) {
		proto_send_error("bad_birth", "Character creation failed");
		return;
	}

	enter_world();
	save_now();
	send_hello();
	snapshot_send(true);
}

static void handle_load_game(void)
{
	if (character_generated) engine_reinit();

	player->is_dead = true;
	if (!file_exists(savefile) || !savefile_load(savefile, false)) {
		proto_send_error("load_failed", "Could not load savefile '%s'", savefile);
		return;
	}
	if (player->is_dead) {
		proto_send_error("character_dead", "The character in this savefile is dead");
		session_phase = PHASE_MENU;
		return;
	}
	update_player_object_knowledge(player);
	enter_world();
	send_hello();
	snapshot_send(true);
}

/*
 * Leave the current game for the title screen: save (if alive), then reset
 * the core exactly as play_game() does before offering a new game.
 */
static void handle_close_game(void)
{
	bool ok = true;

	if (session_phase == PHASE_GAME) ok = save_now();
	if (character_generated || session_phase != PHASE_MENU) engine_reinit();
	character_generated = false;
	session_phase = PHASE_MENU;
	if (!ok) proto_send_error("save_failed", "Saving failed before leaving the game");
	send_hello();
	snapshot_send(true);
}

/* Mirrors the dead branch of close_game() */
static void handle_death(void)
{
	event_signal(EVENT_LEAVE_WORLD);
	handle_stuff(player);
	if (OPT(player, birth_randarts)) deactivate_randart_file();
	death_knowledge(player);
	if (!savefile_save(savefile)) plog("death save failed!");
	session_phase = PHASE_DEAD;
	event_signal(EVENT_LEAVE_GAME);
}

static void run_world(void)
{
	store_register_events();
	run_game_loop();
	if (player->is_dead && session_phase == PHASE_GAME) handle_death();
	snapshot_send(false);
}

/* ------------------------------------------------------------------------
 * Read-only queries (never change game state)
 * ------------------------------------------------------------------------ */
static void send_textblock(const char *what, const char *title, textblock *tb)
{
	jw w;
	const wchar_t *wtext = textblock_text(tb);
	size_t max = wcslen(wtext) * 4 + 1;
	char *text = mem_zalloc(max);

	wcstombs(text, wtext, max);
	jw_init(&w);
	jw_obj_begin(&w);
	jw_kstr(&w, "type", "info");
	jw_kstr(&w, "what", what);
	jw_kstr(&w, "title", title);
	jw_kstr(&w, "text", text);
	jw_obj_end(&w);
	proto_send(&w);
	jw_free(&w);
	mem_free(text);
}

static void handle_query(const jv *msg)
{
	const char *what = jv_get_str(msg, "what", "");

	if (session_phase == PHASE_MENU || !character_dungeon) {
		proto_send_error("no_game", "No game in progress");
		return;
	}

	rng_save();
	if (streq(what, "item")) {
		struct object *obj = handle_to_object(jv_get_str(msg, "item", NULL));
		if (!obj) {
			proto_send_error("bad_item", "No such item");
		} else {
			char name[160];
			textblock *tb = object_info(obj, OINFO_NONE);
			/* Examining tracks the object, as in the textui (object recall) */
			track_object(player->upkeep, obj);
			object_desc(name, sizeof(name), obj, ODESC_PREFIX | ODESC_FULL, player);
			send_textblock("item", name, tb);
			textblock_free(tb);
		}
	} else if (streq(what, "book")) {
		/* Browse: list a book's spells without spending game time */
		struct object *obj = handle_to_object(jv_get_str(msg, "item", NULL));
		const struct class_book *book = obj ? player_object_to_book(player, obj) : NULL;
		if (!book) {
			proto_send_error("bad_item", "You cannot read that");
		} else {
			char name[160];
			int i;
			textblock *tb = textblock_new();
			object_desc(name, sizeof(name), obj, ODESC_PREFIX | ODESC_FULL, player);
			textblock_append(tb, "%-30s Lv Mana Fail Info\n", "Name");
			for (i = 0; i < book->num_spells; i++) {
				const struct class_spell *spell = &book->spells[i];
				char info[64] = "";
				if (spell->slevel >= 99) continue;
				get_spell_info(spell->sidx, info, sizeof(info));
				textblock_append(tb, "%-30s %2d %4d %3d%% %s%s\n", spell->name,
					spell->slevel, spell->smana, spell_chance(spell->sidx), info,
					(player->spell_flags[spell->sidx] & PY_SPELL_LEARNED) ? "" :
					(spell->slevel > player->lev ? " (too high)" : " (unlearned)"));
			}
			for (i = 0; i < book->num_spells; i++) {
				const struct class_spell *spell = &book->spells[i];
				if (spell->slevel >= 99) continue;
				textblock_append(tb, "\n%s: %s\n", spell->name, spell->text);
			}
			send_textblock("book", name, tb);
			textblock_free(tb);
		}
	} else if (streq(what, "character")) {
		/* The stock character sheet ('C'), drawn by display_player() */
		long page = jv_get_int(msg, "page", 0);
		jw w;
		jw_init(&w);
		jw_obj_begin(&w);
		jw_kstr(&w, "type", "screen");
		jw_kstr(&w, "what", "character");
		jw_kint(&w, "page", page == 1 ? 1 : 0);
		panels_write_character(&w, page == 1 ? 1 : 0);
		jw_obj_end(&w);
		proto_send(&w);
		jw_free(&w);
	} else if (streq(what, "monster")) {
		long id = jv_get_int(msg, "monster", 0);
		struct monster *mon = (id > 0 && id < cave_monster_max(cave)) ?
			cave_monster(cave, (int)id) : NULL;
		/* Recall is only available for monsters the player can see */
		if (!mon || !mon->race || !monster_is_visible(mon) ||
				player->timed[TMD_IMAGE]) {
			proto_send_error("bad_monster", "You see no such monster");
		} else {
			textblock *tb = textblock_new();
			monster_race_track(player->upkeep, mon->race);
			lore_description(tb, mon->race, get_lore(mon->race), false);
			send_textblock("monster", mon->race->name, tb);
			textblock_free(tb);
		}
	} else {
		proto_send_error("bad_query", "Unknown query '%s'", what);
	}
	rng_restore();
}

/* ------------------------------------------------------------------------
 * Main loop
 * ------------------------------------------------------------------------ */
static void usage(void)
{
	fprintf(stderr,
		"usage: angband-headless --lib <dir> --data <dir> [--save <name>] "
		"[--seed <n>] [--debug]\n");
	exit(2);
}

static void path_with_sep(char *out, size_t len, const char *in)
{
	my_strcpy(out, in, len);
	if (!suffix(out, PATH_SEP)) my_strcat(out, PATH_SEP, len);
}

int main(int argc, char *argv[])
{
	int i;
	char libpath[1024], datapath[1024];

	for (i = 1; i < argc; i++) {
		if (streq(argv[i], "--lib") && i + 1 < argc) opt_lib = argv[++i];
		else if (streq(argv[i], "--data") && i + 1 < argc) opt_data = argv[++i];
		else if (streq(argv[i], "--save") && i + 1 < argc) opt_save = argv[++i];
		else if (streq(argv[i], "--seed") && i + 1 < argc) opt_seed = atol(argv[++i]);
		else if (streq(argv[i], "--debug")) thang_debug = true;
		else usage();
	}
	if (getenv("THANG_DEBUG")) thang_debug = true;
	if (!opt_lib || !opt_data) usage();

	/* Wide-character text conversion requires a UTF-8 locale */
	if (!setlocale(LC_CTYPE, "") || !strstr(setlocale(LC_CTYPE, NULL), "UTF-8")) {
		if (!setlocale(LC_CTYPE, "en_US.UTF-8")) setlocale(LC_CTYPE, "C.UTF-8");
	}
	signal(SIGPIPE, SIG_IGN);

	proto_init();
	plog_aux = plog_stderr;
	quit_aux = quit_hook_fn;
	proto_resync_hook = resync;
	proto_eof_hook = on_eof;

	path_with_sep(libpath, sizeof(libpath), opt_lib);
	path_with_sep(datapath, sizeof(datapath), opt_data);
	init_file_paths(libpath, libpath, datapath);
	create_needed_dirs();
	savefile_set_name(opt_save, true, false);

	engine_init();

	/* Visual tables, as textui_init() would set them up */
	cmd_init();
	textui_prefs_init();
	if (!init_graphics_modes()) quit("Cannot load graphics modes (lib/tiles/list.txt)");
	use_graphics = 3;	/* David Gervais' 32x32 tiles (lib/tiles/list.txt) */
	if (!get_graphics_mode(use_graphics)) quit("Gervais tile mode not found");
	/* Base tile mapping only: the included xtra/flavour prefs test $RACE and
	 * $CLASS, which need a character.  Like ui_leave_init() in the textui,
	 * the full set is loaded once a character exists (enter_world()). */
	current_graphics_mode = NULL;
	reset_visuals(true);
	/* Pref-file includes (%:xtra-dvg.prf, %:flvr-dvg.prf) are resolved
	 * against current_graphics_mode->path, as in the stock frontends */
	current_graphics_mode = get_graphics_mode(use_graphics);

	hooks_install();
	snapshot_init();

	session_phase = PHASE_MENU;
	send_hello();
	snapshot_send(true);

	while (true) {
		jv *msg = proto_next();
		const char *type = jv_get_str(msg, "type", "");

		if (streq(type, "new_game")) {
			handle_new_game(msg);
		} else if (streq(type, "load_game")) {
			handle_load_game();
		} else if (streq(type, "command")) {
			if (commands_dispatch(msg)) {
				run_world();
			} else {
				if (commands_last_error()[0])
					proto_send_error("command_rejected", "%s", commands_last_error());
				/* Free actions may have changed target or produced messages */
				snapshot_send(false);
			}
		} else if (streq(type, "close_game")) {
			handle_close_game();
		} else if (streq(type, "save")) {
			jw w;
			bool ok = save_now();
			jw_init(&w);
			jw_obj_begin(&w);
			jw_kstr(&w, "type", "saved");
			jw_kbool(&w, "ok", ok);
			jw_obj_end(&w);
			proto_send(&w);
			jw_free(&w);
		} else if (streq(type, "options")) {
			if (!character_generated) {
				proto_send_error("no_game", "No character loaded");
			} else {
				apply_options(jv_get(msg, "set"), OP_INTERFACE);
				send_hello();
				snapshot_send(false);
			}
		} else if (streq(type, "query")) {
			handle_query(msg);
		} else if (streq(type, "quit")) {
			on_eof();
			jv_free(msg);
			break;
		} else if (streq(type, "answer") || streq(type, "cancel")) {
			proto_send_error("no_prompt", "No prompt is pending");
		} else {
			proto_send_error("bad_type", "Unknown message type '%s'", type);
		}
		jv_free(msg);
	}

	return 0;
}
