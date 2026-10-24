/**
 * \file adapter.h
 * \brief Shared declarations for the Thangorodrim headless Angband adapter.
 *
 * The adapter replaces Angband's terminal UI ("textui") with a structured
 * JSON-lines protocol on stdin/stdout.  It never reimplements game rules:
 * it pushes native commands onto Angband's command queue, runs the native
 * game loop, implements the native game-input hooks as protocol prompts,
 * and exports what the player is allowed to know.
 */
#ifndef THANG_ADAPTER_H
#define THANG_ADAPTER_H

#include "angband.h"
#include "json.h"

#define THANG_PROTOCOL_VERSION 1

/* Session phase, reported to the client in every state message */
enum session_phase {
	PHASE_MENU = 0,	/* No character loaded: offer new game / continue */
	PHASE_GAME,	/* Character alive in the dungeon */
	PHASE_DEAD	/* Character died; tombstone shown until new game */
};

extern enum session_phase session_phase;
extern bool thang_debug;

/* ---- proto.c: transport ---- */
void proto_init(void);
void proto_send(jw *w);
void proto_send_error(const char *code, const char *fmt, ...);
/* Next client message (caller frees with jv_free).  Handles transport-level
 * messages ("hello", "ping") internally.  Never returns NULL: on EOF the
 * session is saved and the process exits. */
jv *proto_next(void);
/* Set by main: resends hello + full state + any pending prompt */
extern void (*proto_resync_hook)(void);
/* Called on EOF before exit */
extern void (*proto_eof_hook)(void);

/* ---- snapshot.c: authoritative state export ---- */
void snapshot_init(void);
void snapshot_reset_map(void);
void snapshot_send(bool full_map);
void snapshot_write_static(jw *w);	/* feature table + tileset for hello */
void snapshot_write_object_json(jw *w, struct object *obj, const char *handle);
bool snapshot_tile_of_kind(const struct object_kind *kind, int *row, int *col);
/* Message and effect collection (event handlers) */
void snapshot_register_events(void);
void snapshot_note(const char *fmt, ...);

/* RNG neutrality: the adapter must never perturb the game's random stream */
void rng_save(void);
void rng_restore(void);

/* ---- hooks.c: native game-input hooks as protocol prompts ---- */
void hooks_install(void);
/* Re-send the prompt currently awaiting an answer, if any */
void hooks_resend_pending(void);
bool hooks_prompt_pending(void);
/* Item handles: "inven:3", "equip:0", "quiver:1", "floor:0" */
struct object *handle_to_object(const char *handle);
void object_to_handle(const struct object *obj, char *buf, size_t len);

/* ---- commands.c: client command -> native command queue ---- */
/* Returns true if the command was queued and the game loop should run */
bool commands_dispatch(const jv *msg);
const char *commands_last_error(void);

/* ---- store.c: modal store interaction ---- */
void store_register_events(void);
bool store_is_open(void);
void store_write_state(jw *w);

#endif
