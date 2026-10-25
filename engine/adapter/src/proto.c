/**
 * \file proto.c
 * \brief JSON-lines transport over stdin/stdout.
 *
 * Protocol messages go to a private duplicate of the original stdout; the
 * process-wide stdout is redirected to stderr so that any stray printf in
 * the engine can never corrupt the protocol stream.
 */
#include "adapter.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static FILE *proto_out;
void (*proto_resync_hook)(void);
void (*proto_eof_hook)(void);

void proto_init(void)
{
	int fd = dup(STDOUT_FILENO);
	if (fd < 0) {
		perror("dup");
		exit(1);
	}
	proto_out = fdopen(fd, "w");
	dup2(STDERR_FILENO, STDOUT_FILENO);
	setvbuf(stdin, NULL, _IOLBF, 0);
}

void proto_send(jw *w)
{
	if (thang_debug) {
		if (w->len > 600)
			fprintf(stderr, "[engine->] %.300s ... (%zu bytes)\n", w->buf, w->len);
		else
			fprintf(stderr, "[engine->] %s\n", w->buf);
	}
	fwrite(w->buf, 1, w->len, proto_out);
	fputc('\n', proto_out);
	fflush(proto_out);
}

void proto_send_error(const char *code, const char *fmt, ...)
{
	char msg[512];
	va_list ap;
	jw w;

	va_start(ap, fmt);
	vsnprintf(msg, sizeof(msg), fmt, ap);
	va_end(ap);

	jw_init(&w);
	jw_obj_begin(&w);
	jw_kstr(&w, "type", "error");
	jw_kstr(&w, "code", code);
	jw_kstr(&w, "message", msg);
	jw_obj_end(&w);
	proto_send(&w);
	jw_free(&w);
}

/* No legitimate client message comes close to this */
#define MAX_LINE (64 * 1024)

/*
 * Read one line; NULL on EOF.  Over-long lines are consumed and replaced by
 * an empty string, with *too_long set, so a hostile client cannot make the
 * engine allocate without bound.
 */
static char *read_line(bool *too_long)
{
	size_t cap = 1024, len = 0;
	char *buf = malloc(cap);

	*too_long = false;
	while (true) {
		int c = fgetc(stdin);
		if (c == EOF) {
			if (len == 0 && !*too_long) {
				free(buf);
				return NULL;
			}
			break;
		}
		if (c == '\n') break;
		if (*too_long) continue;
		if (len + 2 > MAX_LINE) {
			*too_long = true;
			len = 0;
			continue;
		}
		if (len + 2 > cap) {
			cap *= 2;
			buf = realloc(buf, cap);
		}
		buf[len++] = (char)c;
	}
	buf[len] = '\0';
	return buf;
}

jv *proto_next(void)
{
	while (true) {
		bool too_long;
		char *line = read_line(&too_long);
		jv *msg;
		const char *type;

		if (too_long) {
			proto_send_error("too_long", "Message exceeds %d bytes", MAX_LINE);
			free(line);
			continue;
		}
		if (!line) {
			if (thang_debug) fprintf(stderr, "[engine] stdin closed\n");
			if (proto_eof_hook) proto_eof_hook();
			exit(0);
		}
		if (!line[0]) {
			free(line);
			continue;
		}
		if (thang_debug) fprintf(stderr, "[->engine] %s\n", line);

		msg = jv_parse(line);
		free(line);
		if (!msg || msg->type != JV_OBJ) {
			proto_send_error("bad_json", "Could not parse message");
			jv_free(msg);
			continue;
		}

		type = jv_get_str(msg, "type", "");
		if (streq(type, "hello")) {
			if (proto_resync_hook) proto_resync_hook();
			jv_free(msg);
			continue;
		}
		if (streq(type, "ping")) {
			jw w;
			jw_init(&w);
			jw_obj_begin(&w);
			jw_kstr(&w, "type", "pong");
			jw_kint(&w, "id", jv_get_int(msg, "id", 0));
			jw_obj_end(&w);
			proto_send(&w);
			jw_free(&w);
			jv_free(msg);
			continue;
		}
		return msg;
	}
}
