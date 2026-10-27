/**
 * \file store.c
 * \brief Modal store interaction over the protocol.
 *
 * Walking onto a shop entrance makes the core signal EVENT_USE_STORE; like
 * the textui's store menu, our handler runs a nested input loop until the
 * player leaves.  Purchases and sales push the native CMD_BUY / CMD_SELL /
 * CMD_RETRIEVE / CMD_STASH commands and execute them with
 * cmdq_pop(CTX_STORE), exactly as ui-store.c does.  Prices are computed by
 * the native price_item().
 */
#include "adapter.h"

#include "cave.h"
#include "cmd-core.h"
#include "init.h"
#include "mon-util.h"
#include "obj-desc.h"
#include "obj-gear.h"
#include "obj-knowledge.h"
#include "obj-tval.h"
#include "obj-util.h"
#include "player-calcs.h"
#include "store.h"

static struct store *open_store;

bool store_is_open(void)
{
	return open_store != NULL;
}

static int stock_list(struct store *store, struct object ***out)
{
	struct object **list = mem_zalloc(z_info->store_inven_max * sizeof(*list));
	int n = 0;
	store_stock_list(store, list, z_info->store_inven_max);
	while (n < z_info->store_inven_max && list[n]) n++;
	*out = list;
	return n;
}

void store_write_state(jw *w)
{
	struct store *store = open_store;
	struct object **list;
	int n, i;
	bool home;

	if (!store) return;
	home = store->feat == FEAT_HOME;

	jw_key(w, "store");
	jw_obj_begin(w);
	jw_kstr(w, "name", f_info[store->feat].name);
	jw_kbool(w, "home", home);
	if (!home && store->owner) {
		jw_kstr(w, "owner", store->owner->name);
		jw_kint(w, "maxCost", store->owner->max_cost);
	}
	jw_kbool(w, "noSelling", OPT(player, birth_no_selling));

	n = stock_list(store, &list);
	jw_key(w, "stock");
	jw_arr_begin(w);
	for (i = 0; i < n; i++) {
		struct object *obj = list[i];
		char name[160];
		int row, col;
		object_desc(name, sizeof(name), obj,
			ODESC_PREFIX | ODESC_FULL | (home ? 0 : ODESC_STORE), player);
		jw_obj_begin(w);
		jw_key(w, "handle");
		jw_str(w, format("store:%d", i));
		jw_kstr(w, "name", name);
		jw_kint(w, "number", obj->number);
		jw_kint(w, "weight", obj->weight);
		if (!home) jw_kint(w, "price", price_item(store, obj, false, 1));
		jw_kbool(w, "canUse", !tval_is_book_k(obj->kind) || obj_can_browse(obj));
		jw_key(w, "tile");
		if (snapshot_tile_of_kind(obj->kind, &row, &col)) {
			jw_arr_begin(w);
			jw_int(w, row);
			jw_int(w, col);
			jw_arr_end(w);
		} else {
			jw_null(w);
		}
		jw_obj_end(w);
	}
	jw_arr_end(w);
	mem_free(list);

	/* Sale prices for the player's items this store would accept */
	jw_key(w, "sellable");
	jw_arr_begin(w);
	for (i = 0; i < z_info->pack_size; i++) {
		struct object *obj = player->upkeep->inven[i];
		if (!obj) continue;
		if (!home && !store_will_buy_tester(obj)) continue;
		jw_obj_begin(w);
		jw_key(w, "handle");
		jw_str(w, format("inven:%d", i));
		if (!home) jw_kint(w, "price", price_item(store, obj, true, 1));
		jw_obj_end(w);
	}
	jw_arr_end(w);
	jw_obj_end(w);
}

static struct object *store_item(struct store *store, const char *handle)
{
	int idx, n;
	struct object **list, *obj = NULL;
	if (!handle || sscanf(handle, "store:%d", &idx) != 1) return NULL;
	n = stock_list(store, &list);
	if (idx >= 0 && idx < n) obj = list[idx];
	mem_free(list);
	return obj;
}

/* Run one native command in store context, as ui-store.c does */
static void run_store_command(void)
{
	cmdq_pop(CTX_STORE);
	notice_stuff(player);
	handle_stuff(player);
}

/*
 * Shops are used from the street: the player walks into the door and the
 * shop opens with them still standing outside it.  The core's store
 * commands need the player on the entrance, so they stand there while the
 * shop is open, but snapshots show them outside (store_shown_grid) and they
 * step back out on leaving.  That is the grid they came from, or if it
 * isn't known (a long run ends at the door) or is blocked, another open
 * grid next to the door, straight ahead of it first.
 */
static struct loc store_exit;

static struct loc find_store_exit(struct loc from)
{
	struct loc grid = player->grid;
	int i, pass;

	for (pass = 0; pass < 3; pass++) {
		for (i = 0; i < 8; i++) {
			struct loc to = loc_sum(grid, ddgrid_ddd[i]);
			if (pass == 0 && !loc_eq(to, from)) continue;
			/* ddgrid_ddd lists the four orthogonal directions first */
			if (pass == 1 && i >= 4) break;
			if (!square_in_bounds_fully(cave, to) || !square_ispassable(cave, to) ||
					square_isshop(cave, to) || square(cave, to)->mon)
				continue;
			return to;
		}
	}
	/* Nowhere to stand: stay in the doorway */
	return grid;
}

struct loc store_shown_grid(void)
{
	return open_store ? store_exit : player->grid;
}

static void ev_use_store(game_event_type type, game_event_data *data, void *user)
{
	struct store *store = store_at(cave, player->grid);
	if (!store) return;

	store_exit = find_store_exit(snapshot_player_grid);
	open_store = store;
	if (store->feat != FEAT_HOME && store->owner)
		msg("%s welcomes you.", store->owner->name);
	snapshot_send(false);

	while (true) {
		jv *msg_in = proto_next();
		const char *type_s = jv_get_str(msg_in, "type", "");
		const char *action = jv_get_str(msg_in, "action", "");
		bool home = store->feat == FEAT_HOME;

		if (streq(type_s, "save")) {
			proto_send_error("in_store", "Leave the store before saving");
			jv_free(msg_in);
			continue;
		}
		if (!streq(type_s, "command")) {
			proto_send_error("in_store", "Unexpected '%s' while in a store", type_s);
			jv_free(msg_in);
			continue;
		}

		if (streq(action, "store_leave")) {
			jv_free(msg_in);
			break;
		} else if (streq(action, "store_buy")) {
			struct object *obj = store_item(store, jv_get_str(msg_in, "item", NULL));
			int amt = (int)jv_get_int(msg_in, "quantity", 1);
			if (!obj) {
				proto_send_error("bad_item", "No such store item");
			} else if (amt < 1 || amt > obj->number) {
				proto_send_error("bad_quantity", "Invalid quantity");
			} else {
				cmdq_push(home ? CMD_RETRIEVE : CMD_BUY);
				cmd_set_arg_item(cmdq_peek(), "item", obj);
				cmd_set_arg_number(cmdq_peek(), "quantity", amt);
				run_store_command();
			}
		} else if (streq(action, "store_sell")) {
			struct object *obj = handle_to_object(jv_get_str(msg_in, "item", NULL));
			int amt = (int)jv_get_int(msg_in, "quantity", 1);
			if (!obj) {
				proto_send_error("bad_item", "No such item");
			} else if (amt < 1 || amt > obj->number) {
				proto_send_error("bad_quantity", "Invalid quantity");
			} else if (object_is_equipped(player->body, obj) && !obj_can_takeoff(obj)) {
				msg("Hmmm, it seems to be stuck.");
			} else {
				cmdq_push(home ? CMD_STASH : CMD_SELL);
				cmd_set_arg_item(cmdq_peek(), "item", obj);
				cmd_set_arg_number(cmdq_peek(), "quantity", amt);
				run_store_command();
			}
		} else if (streq(action, "wield") || streq(action, "takeoff") ||
				streq(action, "inscribe") || streq(action, "uninscribe") ||
				streq(action, "ignore")) {
			/* Equipment management is allowed in stores, as in ui-store.c */
			if (commands_dispatch(msg_in)) run_store_command();
			else if (commands_last_error()[0])
				proto_send_error("command_rejected", "%s", commands_last_error());
		} else {
			proto_send_error("in_store", "'%s' is not available in a store", action);
		}
		jv_free(msg_in);
		snapshot_send(false);
	}

	open_store = NULL;
	if (!loc_eq(store_exit, player->grid)) {
		monster_swap(player->grid, store_exit);
		player->upkeep->update |= (PU_UPDATE_VIEW | PU_MONSTERS);
	}

	/* Leaving takes a turn, as in ui-store.c */
	player->upkeep->energy_use = z_info->move_energy;
}

static void ev_leave_store(game_event_type type, game_event_data *data, void *user)
{
	cmd_disable_repeat();
	player->upkeep->update |= (PU_UPDATE_VIEW | PU_MONSTERS);
}

/*
 * The core removes store handlers after each visit, so (like the textui,
 * which re-adds them when entering the world) we re-register before every
 * game-loop run.  Removing first keeps registration idempotent.
 */
void store_register_events(void)
{
	event_remove_handler(EVENT_USE_STORE, ev_use_store, NULL);
	event_remove_handler(EVENT_LEAVE_STORE, ev_leave_store, NULL);
	event_add_handler(EVENT_USE_STORE, ev_use_store, NULL);
	event_add_handler(EVENT_LEAVE_STORE, ev_leave_store, NULL);
}
