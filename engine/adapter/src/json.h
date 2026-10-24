/**
 * \file json.h
 * \brief Minimal JSON writer and parser for the headless protocol.
 *
 * The writer appends to a growable buffer and handles commas automatically.
 * The parser builds a small tree; only what the protocol needs is supported
 * (objects, arrays, strings, numbers, booleans, null).
 */
#ifndef THANG_JSON_H
#define THANG_JSON_H

#include <stdbool.h>
#include <stddef.h>

/* ---- Writer ---- */

#define JW_MAX_DEPTH 32

typedef struct jw {
	char *buf;
	size_t len, cap;
	int depth;
	bool need_comma[JW_MAX_DEPTH];
	bool after_key;
} jw;

void jw_init(jw *w);
void jw_free(jw *w);
void jw_reset(jw *w);

void jw_obj_begin(jw *w);
void jw_obj_end(jw *w);
void jw_arr_begin(jw *w);
void jw_arr_end(jw *w);
void jw_key(jw *w, const char *key);

void jw_str(jw *w, const char *s);
void jw_int(jw *w, long v);
void jw_bool(jw *w, bool v);
void jw_null(jw *w);
void jw_raw(jw *w, const char *s);

/* key + value conveniences */
void jw_kstr(jw *w, const char *key, const char *s);
void jw_kint(jw *w, const char *key, long v);
void jw_kbool(jw *w, const char *key, bool v);

/* ---- Parser ---- */

typedef enum {
	JV_NULL, JV_BOOL, JV_NUM, JV_STR, JV_ARR, JV_OBJ
} jv_type;

typedef struct jv {
	jv_type type;
	bool b;
	double n;
	char *s;
	/* Arrays and objects: children; objects also have keys */
	struct jv **items;
	char **keys;
	int count;
} jv;

jv *jv_parse(const char *text);
void jv_free(jv *v);

const jv *jv_get(const jv *obj, const char *key);
const char *jv_get_str(const jv *obj, const char *key, const char *def);
long jv_get_int(const jv *obj, const char *key, long def);
bool jv_get_bool(const jv *obj, const char *key, bool def);
bool jv_has(const jv *obj, const char *key);

#endif
