/*
 * Copyright (C) 2021 Alexander Borisov
 *
 * Author: Alexander Borisov <borisov@lexbor.com>
 */

#include "lexbor/css/log.h"


typedef struct {
    const char *msg;
    size_t length;
}
lxb_css_log_type_str_t;


static const lxb_css_log_type_str_t lxb_css_log_types_map[] = {
    {"Info", 4},
    {"Warning", 7},
    {"Error", 5},
    {"Syntax error", 12}
};


lxb_css_log_t *
lxb_css_log_create(void)
{
    return lexbor_calloc(1, sizeof(lxb_css_log_t));
}

lxb_status_t
lxb_css_log_init(lxb_css_log_t *log, lexbor_mraw_t *mraw)
{
    lxb_status_t status;

    if (log == NULL) {
        return LXB_STATUS_ERROR_OBJECT_IS_NULL;
    }

    status = lexbor_array_obj_init(&log->messages, 64,
                                   sizeof(lxb_css_log_message_t));
    if (status != LXB_STATUS_OK) {
        return status;
    }

    if (mraw != NULL) {
        log->mraw = mraw;
        log->self_mraw = false;
        return LXB_STATUS_OK;
    }

    log->self_mraw = true;

    log->mraw = lexbor_mraw_create();

    return lexbor_mraw_init(log->mraw, 4096);
}

void
lxb_css_log_clean(lxb_css_log_t *log)
{
    if (log != NULL) {
        lexbor_array_obj_clean(&log->messages);

        if (log->self_mraw) {
            lexbor_mraw_clean(log->mraw);
        }
    }
}

lxb_css_log_t *
lxb_css_log_destroy(lxb_css_log_t *log, bool self_destroy)
{
    if (log == NULL) {
        return NULL;
    }

    (void) lexbor_array_obj_destroy(&log->messages, false);

    if (log->self_mraw) {
        (void) lexbor_mraw_destroy(log->mraw, true);
    }

    if (self_destroy) {
        log = lexbor_free(log);
    }

    return log;
}

lxb_css_log_message_t *
lxb_css_log_append(lxb_css_log_t *log, lxb_css_log_type_t type,
                   const lxb_char_t *str, size_t length)
{
    lxb_css_log_message_t *msg;

    msg = lexbor_array_obj_push(&log->messages);
    if (msg == NULL) {
        return NULL;
    }

    if (lexbor_str_init(&msg->text, log->mraw, length) == NULL) {
        lexbor_array_obj_pop(&log->messages);
        return NULL;
    }

    memcpy(msg->text.data, str, length);
    msg->text.length = length;

    msg->text.data[length] = '\0';

    msg->type = type;

    return msg;
}

lxb_css_log_message_t *
lxb_css_log_push(lxb_css_log_t *log, lxb_css_log_type_t type, size_t length)
{
    lxb_css_log_message_t *msg;

    msg = lexbor_array_obj_push(&log->messages);
    if (msg == NULL) {
        return NULL;
    }

    if (lexbor_str_init(&msg->text, log->mraw, length) == NULL) {
        lexbor_array_obj_pop(&log->messages);
        return NULL;
    }

    msg->type = type;

    return msg;
}

lxb_css_log_message_t *
lxb_css_log_format(lxb_css_log_t *log, lxb_css_log_type_t type,
                   const char *format, ...)
{
    (void) type; (void) format;

    /* Size patch: message text is never read by the shim (parser->status is
     * the only observable), so arguments are not formatted. The record itself
     * still exists: callers treat NULL as an allocation failure. */
    return lxb_css_log_push(log, type, 0);
}

lxb_css_log_message_t *
lxb_css_log_not_supported(lxb_css_log_t *log,
                          const char *module_name, const char *description)
{
    (void) module_name; (void) description;

    return lxb_css_log_push(log, LXB_CSS_LOG_SYNTAX_ERROR, 0);
}

const lxb_char_t *
lxb_css_log_type_by_id(lxb_css_log_type_t type, size_t *out_length)
{
    if (out_length != NULL) {
        *out_length = lxb_css_log_types_map[type].length;
    }

    return (const lxb_char_t *) lxb_css_log_types_map[type].msg;
}


