/**
 * \file panels.c
 * \brief Angband's subwindows, rendered by Angband's own code.
 *
 * Stock frontends can show extra terminal windows: monster list, item list,
 * monster recall, object recall, character sheets.  Rather than re-derive
 * that information, we run the exact textui subwindow functions into
 * offscreen virtual terminals and export what they drew: text runs with
 * Angband colour indices, plus tile glyphs (graphics-mode attr/char with
 * the high bit set) as atlas coordinates.
 *
 * Each panel is only re-sent when its content changes.
 */
#include "adapter.h"

#include <wchar.h>

#include "mon-lore.h"
#include "player-calcs.h"
#include "ui-mon-list.h"
#include "ui-mon-lore.h"
#include "ui-obj-list.h"
#include "ui-object.h"
#include "ui-player.h"
#include "ui-term.h"

/* Offscreen terminals, created on demand and reused */
#define MAX_VTERMS 4
static struct {
	term t;
	int w, h;
	bool used;
} vterms[MAX_VTERMS];

static term *vterm(int w, int h)
{
	int i;
	for (i = 0; i < MAX_VTERMS; i++)
		if (vterms[i].used && vterms[i].w == w && vterms[i].h == h)
			return &vterms[i].t;
	for (i = 0; i < MAX_VTERMS; i++) {
		if (vterms[i].used) continue;
		term_init(&vterms[i].t, w, h, 16);
		vterms[i].w = w;
		vterms[i].h = h;
		vterms[i].used = true;
		return &vterms[i].t;
	}
	return NULL;
}

typedef void (*panel_draw)(void *ctx);

/* Graphics-mode glyphs have the high bit set in both attr and char */
static bool is_tile(int a, wchar_t c)
{
	return (a & 0x80) && c >= 0x80 && c <= 0xFF;
}

static void flush_run(jw *w, char *run, size_t *len, int color)
{
	if (!*len) return;
	run[*len] = '\0';
	jw_arr_begin(w);
	jw_str(w, run);
	jw_int(w, color);
	jw_arr_end(w);
	*len = 0;
}

/*
 * Draw with fn into a w x h virtual terminal and write the result as
 * {"lines": [[segment...], ...]} where a segment is ["text", colour] or
 * [[row, col]] for a tile.  Trailing blank lines are dropped.
 */
static void capture(jw *out, int width, int height, panel_draw fn, void *ctx)
{
	term *old = Term;
	term *t = vterm(width, height);
	int x, y, last = -1;

	jw_key(out, "lines");
	jw_arr_begin(out);
	if (!t) {
		jw_arr_end(out);
		return;
	}

	Term_activate(t);
	Term_clear();
	fn(ctx);

	/* Find the last non-blank row */
	for (y = 0; y < height; y++)
		for (x = 0; x < width; x++)
			if (t->scr->c[y][x] != L' ' && t->scr->c[y][x] != 0) last = y;

	for (y = 0; y <= last; y++) {
		char run[1024];
		size_t len = 0;
		int color = -1, end = width - 1;

		/* Trim trailing spaces */
		while (end >= 0 && (t->scr->c[y][end] == L' ' || t->scr->c[y][end] == 0) &&
				!is_tile(t->scr->a[y][end], t->scr->c[y][end]))
			end--;

		jw_arr_begin(out);
		for (x = 0; x <= end; x++) {
			int a = t->scr->a[y][x];
			wchar_t c = t->scr->c[y][x];
			if (is_tile(a, c)) {
				flush_run(out, run, &len, color);
				jw_arr_begin(out);
				jw_arr_begin(out);
				jw_int(out, a & 0x7F);
				jw_int(out, c & 0x7F);
				jw_arr_end(out);
				jw_arr_end(out);
				continue;
			}
			if (!c) c = L' ';
			if ((a & 0x7F) != color) {
				flush_run(out, run, &len, color);
				color = a & 0x7F;
			}
			if (len < sizeof(run) - 8) {
				char mb[8];
				int n = wctomb(mb, c);
				if (n <= 0) {
					mb[0] = '?';
					n = 1;
				}
				memcpy(run + len, mb, (size_t)n);
				len += (size_t)n;
			}
		}
		flush_run(out, run, &len, color);
		jw_arr_end(out);
	}
	jw_arr_end(out);

	Term_activate(old);
}

/* ------------------------------------------------------------------------
 * Panel drawers (each is a stock subwindow function)
 * ------------------------------------------------------------------------ */
#define LIST_W 40
#define LIST_H 22
#define RECALL_W 46
#define RECALL_H 60

static void draw_monlist(void *ctx)
{
	monster_list_show_subwindow(LIST_H, LIST_W);
}

static void draw_itemlist(void *ctx)
{
	object_list_show_subwindow(LIST_H, LIST_W);
}

static void draw_monrecall(void *ctx)
{
	lore_show_subwindow(player->upkeep->monster_race,
		get_lore(player->upkeep->monster_race));
}

static void draw_objrecall(void *ctx)
{
	if (player->upkeep->object)
		display_object_recall(player->upkeep->object);
	else
		display_object_kind_recall(player->upkeep->object_kind);
}

static void draw_player(void *ctx)
{
	display_player(*(int *)ctx);
}

/* ------------------------------------------------------------------------
 * Change tracking and export
 * ------------------------------------------------------------------------ */
enum { P_MONLIST, P_ITEMLIST, P_MONRECALL, P_OBJRECALL, P_MAX };
static const char *panel_keys[P_MAX] = { "monsterList", "itemList", "monsterRecall", "objectRecall" };
static char *last_sent[P_MAX];

void panels_reset(void)
{
	int i;
	for (i = 0; i < P_MAX; i++) {
		string_free(last_sent[i]);
		last_sent[i] = NULL;
	}
}

/* Render one panel; returns its JSON (caller frees) or NULL if not shown */
static char *render_panel(int which)
{
	jw w;
	char *s;

	jw_init(&w);
	jw_obj_begin(&w);
	switch (which) {
		case P_MONLIST:
			capture(&w, LIST_W, LIST_H, draw_monlist, NULL);
			break;
		case P_ITEMLIST:
			capture(&w, LIST_W, LIST_H, draw_itemlist, NULL);
			break;
		case P_MONRECALL:
			if (!player->upkeep->monster_race) {
				jw_free(&w);
				return NULL;
			}
			jw_kstr(&w, "title", player->upkeep->monster_race->name);
			capture(&w, RECALL_W, RECALL_H, draw_monrecall, NULL);
			break;
		case P_OBJRECALL:
			if (!player->upkeep->object && !player->upkeep->object_kind) {
				jw_free(&w);
				return NULL;
			}
			capture(&w, RECALL_W, RECALL_H, draw_objrecall, NULL);
			break;
	}
	jw_obj_end(&w);
	s = string_make(w.buf);
	jw_free(&w);
	return s;
}

void panels_write(jw *w, bool force)
{
	int i;
	bool any = false;

	for (i = 0; i < P_MAX; i++) {
		char *s = render_panel(i);
		bool same = (!s && !last_sent[i]) ||
			(s && last_sent[i] && streq(s, last_sent[i]));
		if (same && !force) {
			string_free(s);
			continue;
		}
		if (!any) {
			jw_key(w, "panels");
			jw_obj_begin(w);
			any = true;
		}
		jw_key(w, panel_keys[i]);
		if (s) jw_raw(w, s);
		else jw_null(w);
		string_free(last_sent[i]);
		last_sent[i] = s;
	}
	if (any) jw_obj_end(w);
}

/* The character sheet pages ('C' in the stock game): 0 basic, 1 flags */
void panels_write_character(jw *w, int page)
{
	capture(w, 80, 24, draw_player, &page);
}
