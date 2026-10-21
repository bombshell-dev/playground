/*
 * Lexbor-backed front-end shim for the Bombshell CSS pipeline.
 *
 * Drives lexbor's syntax parser with custom callbacks and emits a flat event
 * stream (byte spans into the original stylesheet text) for the Rust side,
 * which does all semantic work: nesting expansion, condition parsing,
 * canonicalization, and IR emission.
 *
 * Event kinds:
 *   LBX_STYLE_BEGIN  a = prelude span            flags bit1 = failed
 *   LBX_STYLE_END    (no data)
 *   LBX_AT_BEGIN     a = at-rule name span
 *   LBX_AT_PRELUDE   a = prelude span            flags bit1 = failed
 *   LBX_AT_END       a = full rule span          flags bit0 = has_block
 *   LBX_DECL         a = name span, b = value span
 *                    flags bit0 = important, bit1 = failed
 */
#include <lexbor/css/syntax/syntax.h>
#include <lexbor/css/parser.h>

#ifdef LBX_FREESTANDING
/* Minimal libc for wasm32-unknown-unknown; word-wise for speed. */
void *
memcpy(void *d, const void *s, unsigned long n)
{
    unsigned char *dd = d;
    const unsigned char *ss = s;

    for (; n >= 8; n -= 8, dd += 8, ss += 8) {
        __builtin_memcpy(dd, ss, 8);
    }

    while (n--) {
        *dd++ = *ss++;
    }

    return d;
}

void *
memmove(void *d, const void *s, unsigned long n)
{
    unsigned char *dd = d;
    const unsigned char *ss = s;

    if ((uintptr_t) dd < (uintptr_t) ss) {
        return memcpy(d, s, n);
    }

    dd += n;
    ss += n;

    for (; n >= 8; n -= 8, dd -= 8, ss -= 8) {
        __builtin_memcpy(dd - 8, ss - 8, 8);
    }

    while (n--) {
        *--dd = *--ss;
    }

    return d;
}

void *
memset(void *d, int c, unsigned long n)
{
    unsigned char *dd = d;
    unsigned char v = (unsigned char) c;

    for (; n >= 8; n -= 8, dd += 8) {
        __builtin_memset(dd, v, 8);
    }

    while (n--) {
        *dd++ = v;
    }

    return d;
}

int
memcmp(const void *a, const void *b, unsigned long n)
{
    const unsigned char *x = a;
    const unsigned char *y = b;

    while (n--) {
        if (*x != *y) {
            return *x - *y;
        }

        x++;
        y++;
    }

    return 0;
}

unsigned long
strlen(const char *s)
{
    const char *p = s;

    while (*p) {
        p++;
    }

    return (unsigned long) (p - s);
}
#endif /* LBX_FREESTANDING */

#define LBX_STYLE_BEGIN  0
#define LBX_STYLE_END    1
#define LBX_AT_BEGIN     2
#define LBX_AT_PRELUDE   3
#define LBX_AT_END       4
#define LBX_DECL         5

#define LBX_FLAG_HAS_BLOCK  0x01
#define LBX_FLAG_IMPORTANT  0x01
#define LBX_FLAG_FAILED     0x02

typedef struct {
    uint8_t kind;
    uint8_t flags;
    uint32_t a0;
    uint32_t a1;
    uint32_t b0;
    uint32_t b1;
}
lbx_event_t;

typedef struct {
    const unsigned char *css;
    size_t css_len;

    lbx_event_t *events;
    size_t events_len;
    size_t events_cap;

    uintptr_t prelude_begin;
    uintptr_t prelude_end;
    bool prelude_seen;

    uintptr_t decl_name_begin;
    uintptr_t decl_name_end;

    uintptr_t q_begin;
    bool q_open;

    struct {
        uintptr_t begin;
        bool has_block;
    }
    at_stack[64];
    size_t at_depth;

    bool oom;
}
lbx_ctx_t;

static void lbx_emit(lbx_ctx_t *ctx, uint8_t kind, uint8_t flags,
                     uintptr_t a0, uintptr_t a1, uintptr_t b0, uintptr_t b1);

static bool lbx_state_success(lxb_css_parser_t *parser,
                              const lxb_css_syntax_token_t *token, void *ctx);
static bool lbx_next_success(lxb_css_parser_t *parser,
                             const lxb_css_syntax_token_t *token, void *ctx);

static lxb_status_t lbx_noop_end(lxb_css_parser_t *parser,
                                 const lxb_css_syntax_token_t *token,
                                 void *ctx, bool failed);

static bool lbx_at_prelude(lxb_css_parser_t *parser,
                           const lxb_css_syntax_token_t *token, void *ctx);
static lxb_status_t lbx_at_prelude_end(lxb_css_parser_t *parser,
                                       const lxb_css_syntax_token_t *token,
                                       void *ctx, bool failed);
static lxb_status_t lbx_at_end(lxb_css_parser_t *parser,
                               const lxb_css_syntax_token_t *token,
                               void *ctx, bool failed);
static const lxb_css_syntax_cb_at_rule_t *lbx_begin_at_rule(
    lxb_css_parser_t *parser, const lxb_css_syntax_token_t *token, void *ctx,
    void **out_rule);

static bool lbx_qualified_prelude(lxb_css_parser_t *parser,
                                  const lxb_css_syntax_token_t *token,
                                  void *ctx);
static lxb_status_t lbx_qualified_prelude_end(lxb_css_parser_t *parser,
                                              const lxb_css_syntax_token_t *token,
                                              void *ctx, bool failed);
static lxb_status_t lbx_qualified_end(lxb_css_parser_t *parser,
                                      const lxb_css_syntax_token_t *token,
                                      void *ctx, bool failed);
static const lxb_css_syntax_cb_qualified_rule_t *lbx_begin_qualified(
    lxb_css_parser_t *parser, const lxb_css_syntax_token_t *token, void *ctx,
    void **out_rule);

static const lxb_css_syntax_cb_declarations_t *lbx_begin_declarations(
    lxb_css_parser_t *parser, const lxb_css_syntax_token_t *token, void *ctx,
    void **out_rule);

static const lxb_css_syntax_cb_block_t *lbx_begin_block(
    lxb_css_parser_t *parser, const lxb_css_syntax_token_t *token, void *ctx,
    void **out_rule);

static lxb_css_parser_state_f lbx_decl_name(lxb_css_parser_t *parser,
                                            const lxb_css_syntax_token_t *token,
                                            void *ctx, void **out_rule);
static bool lbx_decl_value_state(lxb_css_parser_t *parser,
                                 const lxb_css_syntax_token_t *token,
                                 void *ctx);
static lxb_status_t lbx_decl_end(lxb_css_parser_t *parser, void *declaration,
                                 void *context,
                                 const lxb_css_syntax_token_t *token,
                                 lxb_css_syntax_declaration_offset_t *offset,
                                 bool important, bool failed);

static lbx_ctx_t lbx_ctx;

static const lxb_css_syntax_cb_list_rules_t lbx_list_rules_cb;
static const lxb_css_syntax_cb_at_rule_t lbx_at_rule_cb;
static const lxb_css_syntax_cb_qualified_rule_t lbx_qualified_rule_cb;
static const lxb_css_syntax_cb_block_t lbx_block_cb;
static const lxb_css_syntax_cb_declarations_t lbx_declarations_cb;

static uintptr_t
lbx_clamp(lbx_ctx_t *ctx, uintptr_t off)
{
    uintptr_t base = (uintptr_t) ctx->css;

    if (off < base || off > base + ctx->css_len) {
        return base + ctx->css_len;
    }

    return off;
}

static void
lbx_emit(lbx_ctx_t *ctx, uint8_t kind, uint8_t flags,
         uintptr_t a0, uintptr_t a1, uintptr_t b0, uintptr_t b1)
{
    if (ctx->oom) {
        return;
    }

    /* Synthetic tokens (e.g. _END) carry pointers outside the input; clamp
     * spans to the stylesheet bounds. */
    a0 = lbx_clamp(ctx, a0);
    a1 = lbx_clamp(ctx, a1);
    b0 = lbx_clamp(ctx, b0);
    b1 = lbx_clamp(ctx, b1);

    if (ctx->events_len == ctx->events_cap) {
        size_t cap = ctx->events_cap == 0 ? 256 : ctx->events_cap * 2;
        lbx_event_t *events = lexbor_realloc(ctx->events, cap * sizeof(lbx_event_t));

        if (events == NULL) {
            ctx->oom = true;
            return;
        }

        ctx->events = events;
        ctx->events_cap = cap;
    }

    lbx_event_t *event = &ctx->events[ctx->events_len++];

    event->kind = kind;
    event->flags = flags;
    event->a0 = (uint32_t) (a0 - (uintptr_t) ctx->css);
    event->a1 = (uint32_t) (a1 - (uintptr_t) ctx->css);
    event->b0 = (uint32_t) (b0 - (uintptr_t) ctx->css);
    event->b1 = (uint32_t) (b1 - (uintptr_t) ctx->css);
}

static void
lbx_prelude_reset(lbx_ctx_t *ctx)
{
    ctx->prelude_begin = 0;
    ctx->prelude_end = 0;
    ctx->prelude_seen = false;
}

/* Consume every remaining token of the current phase. */
static bool
lbx_consume_all(lxb_css_parser_t *parser, const lxb_css_syntax_token_t *token)
{
    while (token != NULL && token->type != LXB_CSS_SYNTAX_TOKEN__END) {
        lxb_css_syntax_parser_consume(parser);
        token = lxb_css_syntax_parser_token(parser);
    }

    return lxb_css_parser_success(parser);
}

/* State callbacks ---------------------------------------------------------- */

static bool
lbx_state_success(lxb_css_parser_t *parser,
                  const lxb_css_syntax_token_t *token, void *ctx)
{
    return lbx_consume_all(parser, token);
}

/* `next` states run after a child rule completes; the parser owns the
 * current token, so they must not consume. */
static bool
lbx_next_success(lxb_css_parser_t *parser,
                 const lxb_css_syntax_token_t *token, void *ctx)
{
    (void) token;
    (void) ctx;

    return lxb_css_parser_success(parser);
}

static bool
lbx_decl_value_state(lxb_css_parser_t *parser,
                     const lxb_css_syntax_token_t *token, void *ctx)
{
    return lbx_consume_all(parser, token);
}

/* Prelude readers: accumulate the span, then consume. */

static bool
lbx_read_prelude(lbx_ctx_t *ctx, lxb_css_parser_t *parser,
                 const lxb_css_syntax_token_t *token)
{
    while (token != NULL && token->type != LXB_CSS_SYNTAX_TOKEN__END) {
        uintptr_t begin = (uintptr_t) lxb_css_syntax_token_base(token)->begin;
        uintptr_t end = begin + lxb_css_syntax_token_base(token)->length;

        if (!ctx->prelude_seen) {
            ctx->prelude_seen = true;
            ctx->prelude_begin = begin;
            ctx->prelude_end = end;
        }
        else {
            if (begin < ctx->prelude_begin) {
                ctx->prelude_begin = begin;
            }
            if (end > ctx->prelude_end) {
                ctx->prelude_end = end;
            }
        }

        lxb_css_syntax_parser_consume(parser);
        token = lxb_css_syntax_parser_token(parser);
    }

    return lxb_css_parser_success(parser);
}

static bool
lbx_at_prelude(lxb_css_parser_t *parser, const lxb_css_syntax_token_t *token,
               void *ctx)
{
    return lbx_read_prelude((lbx_ctx_t *) ctx, parser, token);
}

static bool
lbx_qualified_prelude(lxb_css_parser_t *parser,
                      const lxb_css_syntax_token_t *token, void *ctx)
{
    return lbx_read_prelude((lbx_ctx_t *) ctx, parser, token);
}

/* Done callbacks ----------------------------------------------------------- */

static lxb_status_t
lbx_noop_end(lxb_css_parser_t *parser, const lxb_css_syntax_token_t *token,
             void *ctx, bool failed)
{
    return LXB_STATUS_OK;
}

static lxb_status_t
lbx_at_prelude_end(lxb_css_parser_t *parser, const lxb_css_syntax_token_t *token,
                   void *context, bool failed)
{
    lbx_ctx_t *ctx = context;
    uint8_t flags = failed ? LBX_FLAG_FAILED : 0;

    if (ctx->prelude_seen) {
        lbx_emit(ctx, LBX_AT_PRELUDE, flags,
                 ctx->prelude_begin, ctx->prelude_end, 0, 0);
    }
    else if (ctx->at_depth > 0) {
        /* The prelude state never ran; reconstruct the span from the
         * at-keyword start to the terminator token (`;`, `{`, or EOF). */
        uintptr_t begin = ctx->at_stack[ctx->at_depth - 1].begin;
        uintptr_t end = (uintptr_t) lxb_css_syntax_token_base(token)->begin;

        if (end > begin) {
            lbx_emit(ctx, LBX_AT_PRELUDE, flags, begin, end, 0, 0);
        }
    }

    lbx_prelude_reset(ctx);

    return LXB_STATUS_OK;
}

static lxb_status_t
lbx_at_end(lxb_css_parser_t *parser, const lxb_css_syntax_token_t *token,
           void *context, bool failed)
{
    lbx_ctx_t *ctx = context;
    uint8_t flags = failed ? LBX_FLAG_FAILED : 0;

    if (ctx->at_depth == 0) {
        return LXB_STATUS_OK;
    }

    ctx->at_depth--;

    uintptr_t begin = ctx->at_stack[ctx->at_depth].begin;
    uintptr_t end = (uintptr_t) lxb_css_syntax_token_base(token)->begin
                    + lxb_css_syntax_token_base(token)->length;

    if (end > ctx->css_len + (uintptr_t) ctx->css) {
        end = ctx->css_len + (uintptr_t) ctx->css;
    }

    if (ctx->at_stack[ctx->at_depth].has_block) {
        flags |= LBX_FLAG_HAS_BLOCK;
    }

    lbx_emit(ctx, LBX_AT_END, flags, begin, end, 0, 0);

    return LXB_STATUS_OK;
}

static lxb_status_t
lbx_qualified_prelude_end(lxb_css_parser_t *parser,
                          const lxb_css_syntax_token_t *token, void *context,
                          bool failed)
{
    lbx_ctx_t *ctx = context;

    uint8_t flags = failed ? LBX_FLAG_FAILED : 0;

    if (ctx->prelude_seen) {
        lbx_emit(ctx, LBX_STYLE_BEGIN, flags,
                 ctx->prelude_begin, ctx->prelude_end, 0, 0);
    }

    lbx_prelude_reset(ctx);

    return LXB_STATUS_OK;
}

static lxb_status_t
lbx_qualified_end(lxb_css_parser_t *parser, const lxb_css_syntax_token_t *token,
                  void *context, bool failed)
{
    lbx_emit((lbx_ctx_t *) context, LBX_STYLE_END, 0, 0, 0, 0, 0);

    return LXB_STATUS_OK;
}

static lxb_status_t
lbx_decl_end(lxb_css_parser_t *parser, void *declaration, void *context,
             const lxb_css_syntax_token_t *token,
             lxb_css_syntax_declaration_offset_t *offset,
             bool important, bool failed)
{
    lbx_ctx_t *ctx = context;
    uint8_t flags = 0;

    if (important) {
        flags |= LBX_FLAG_IMPORTANT;
    }

    if (failed) {
        flags |= LBX_FLAG_FAILED;
    }

    uintptr_t value_begin = (uintptr_t) ctx->css + offset->value_begin;
    uintptr_t value_end = (uintptr_t) ctx->css + offset->value_end;

    lbx_emit(ctx, LBX_DECL, flags, ctx->decl_name_begin, ctx->decl_name_end,
             value_begin, value_end);

    return LXB_STATUS_OK;
}

/* Begin callbacks ---------------------------------------------------------- */

static const lxb_css_syntax_cb_at_rule_t *
lbx_begin_at_rule(lxb_css_parser_t *parser, const lxb_css_syntax_token_t *token,
                  void *ctx, void **out_rule)
{
    lbx_ctx_t *c = &lbx_ctx;

    (void) ctx;

    if (c->at_depth == sizeof(c->at_stack) / sizeof(c->at_stack[0])) {
        c->oom = true;
        return NULL;
    }

    uintptr_t begin = (uintptr_t) lxb_css_syntax_token_base(token)->begin;

    c->at_stack[c->at_depth].begin = begin;
    c->at_stack[c->at_depth].has_block = false;
    c->at_depth++;

    lbx_emit(c, LBX_AT_BEGIN, 0, begin,
             begin + lxb_css_syntax_token_base(token)->length, 0, 0);

    *out_rule = c;

    return &lbx_at_rule_cb;
}

static const lxb_css_syntax_cb_qualified_rule_t *
lbx_begin_qualified(lxb_css_parser_t *parser,
                    const lxb_css_syntax_token_t *token, void *ctx,
                    void **out_rule)
{
    (void) ctx;
    *out_rule = &lbx_ctx;

    return &lbx_qualified_rule_cb;
}

static const lxb_css_syntax_cb_declarations_t *
lbx_begin_declarations(lxb_css_parser_t *parser,
                       const lxb_css_syntax_token_t *token, void *ctx,
                       void **out_rule)
{
    (void) parser;
    (void) token;
    (void) ctx;
    *out_rule = &lbx_ctx;

    return &lbx_declarations_cb;
}

static const lxb_css_syntax_cb_block_t *
lbx_begin_block(lxb_css_parser_t *parser, const lxb_css_syntax_token_t *token,
                void *ctx, void **out_rule)
{
    lbx_ctx_t *c = &lbx_ctx;

    (void) parser;
    (void) token;


    if (c->at_depth > 0) {
        c->at_stack[c->at_depth - 1].has_block = true;
    }

    (void) parser;
    (void) token;
    *out_rule = &lbx_ctx;

    return &lbx_block_cb;
}

/* Declaration name: record the span, return the value state. */

static lxb_css_parser_state_f
lbx_decl_name(lxb_css_parser_t *parser, const lxb_css_syntax_token_t *token,
              void *ctx, void **out_rule)
{
    lbx_ctx_t *c = ctx;

    c->decl_name_begin = (uintptr_t) lxb_css_syntax_token_base(token)->begin;
    c->decl_name_end = c->decl_name_begin
                       + lxb_css_syntax_token_base(token)->length;

    *out_rule = &lbx_ctx;

    return lbx_decl_value_state;
}

/* Callback structs ---------------------------------------------------------- */

static const lxb_css_syntax_cb_list_rules_t lbx_list_rules_cb = {
    .cb = {
        .failed = lbx_state_success,
        .end = lbx_noop_end,
    },
    .next = lbx_next_success,
    .at_rule = lbx_begin_at_rule,
    .qualified_rule = lbx_begin_qualified,
};

static const lxb_css_syntax_cb_at_rule_t lbx_at_rule_cb = {
    .cb = {
        .failed = lbx_state_success,
        .end = lbx_at_end,
    },
    .prelude = lbx_at_prelude,
    .prelude_end = lbx_at_prelude_end,
    .block = lbx_begin_block,
};

static const lxb_css_syntax_cb_qualified_rule_t lbx_qualified_rule_cb = {
    .cb = {
        .failed = lbx_state_success,
        .end = lbx_qualified_end,
    },
    .prelude = lbx_qualified_prelude,
    .prelude_end = lbx_qualified_prelude_end,
    .block = lbx_begin_block,
};

static const lxb_css_syntax_cb_block_t lbx_block_cb = {
    .cb = {
        .failed = lbx_state_success,
        .end = lbx_noop_end,
    },
    .next = lbx_next_success,
    .at_rule = lbx_begin_at_rule,
    .declarations = lbx_begin_declarations,
    .qualified_rule = lbx_begin_qualified,
};

static const lxb_css_syntax_cb_declarations_t lbx_declarations_cb = {
    .cb = {
        .failed = lbx_state_success,
        .end = lbx_noop_end,
    },
    .name = lbx_decl_name,
    .end = lbx_decl_end,
};

/* Entry points --------------------------------------------------------------- */

static lbx_ctx_t lbx_ctx;

int
lbx_parse(const unsigned char *css, size_t css_len,
          lbx_event_t **out_events, size_t *out_len)
{
    lxb_css_parser_t *parser;
    lxb_css_memory_t *memory;
    lxb_status_t status;

    *out_events = NULL;
    *out_len = 0;

    memset(&lbx_ctx, 0, sizeof(lbx_ctx_t));

    lbx_ctx.css = css;
    lbx_ctx.css_len = css_len;

    parser = lxb_css_parser_create();
    if (parser == NULL) {
        return 1;
    }

    status = lxb_css_parser_init(parser, NULL);
    if (status != LXB_STATUS_OK) {
        lxb_css_parser_destroy(parser, true);
        return 1;
    }

    memory = lxb_css_memory_create();
    if (memory == NULL) {
        lxb_css_parser_destroy(parser, true);
        return 1;
    }

    status = lxb_css_memory_init(memory, 1024);
    if (status != LXB_STATUS_OK) {
        lxb_css_memory_destroy(memory, true);
        lxb_css_parser_destroy(parser, true);
        return 1;
    }

    lxb_css_parser_memory_set(parser, memory);

    if (lxb_css_syntax_parse_list_rules(parser, &lbx_list_rules_cb,
                                        (const lxb_char_t *) css, css_len) == NULL
        && parser->status != LXB_STATUS_OK && !lbx_ctx.oom)
    {
        lexbor_free(lbx_ctx.events);
        lxb_css_memory_destroy(memory, true);
        lxb_css_parser_destroy(parser, true);
        return 1;
    }

    lxb_css_memory_destroy(memory, true);
    lxb_css_parser_destroy(parser, true);

    if (lbx_ctx.oom) {
        lexbor_free(lbx_ctx.events);
        return 1;
    }

    *out_events = lbx_ctx.events;
    *out_len = lbx_ctx.events_len;


    return 0;
}

void
lbx_free_events(lbx_event_t *events, size_t len)
{
    lexbor_free(events);
}

/*
 * Compat shims for the trimmed vendor build. The legacy css/state.c and the
 * typed at-rule/property layers are not compiled; only these handful of
 * symbols remain referenced by the syntax parser:
 *
 * - lxb_css_state_success is the parser's default running state.
 * - The typed destroy hooks are only reached through lxb_css_rule_destroy's
 *   switch arms for payloads this shim never builds (rule contexts are the
 *   parse context, so `u.*` members are always NULL); real lexbor frees
 *   nothing for a NULL payload either.
 */
bool
lxb_css_state_success(lxb_css_parser_t *parser,
                      const lxb_css_syntax_token_t *token, void *ctx)
{
    switch (token->type) {
        case LXB_CSS_SYNTAX_TOKEN_WHITESPACE:
            lxb_css_syntax_parser_consume(parser);
            return true;
        case LXB_CSS_SYNTAX_TOKEN__END:
            return true;
        default:
            return lxb_css_parser_failed(parser);
    }
}

bool
lxb_css_state_blank(lxb_css_parser_t *parser, const lxb_css_syntax_token_t *token,
                    void *ctx)
{
    return lxb_css_parser_success(parser);
}

bool
lxb_css_state_stop(lxb_css_parser_t *parser, const lxb_css_syntax_token_t *token,
                   void *ctx)
{
    return lxb_css_parser_stop(parser);
}

void *
lxb_css_at_rule__undef_destroy(lxb_css_memory_t *memory, void *style,
                               bool self_destroy)
{
    (void) memory;
    (void) style;
    (void) self_destroy;

    return NULL;
}

void *
lxb_css_at_rule_media_destroy(lxb_css_memory_t *memory, void *style,
                              bool self_destroy)
{
    (void) memory;
    (void) style;
    (void) self_destroy;

    return NULL;
}

void *
lxb_css_at_rule_namespace_destroy(lxb_css_memory_t *memory, void *style,
                                  bool self_destroy)
{
    (void) memory;
    (void) style;
    (void) self_destroy;

    return NULL;
}

void *
lxb_css_property_destroy(lxb_css_memory_t *memory, void *style,
                         int type, bool self_destroy)
{
    (void) memory;
    (void) style;
    (void) type;
    (void) self_destroy;

    return NULL;
}

void
lxb_css_selector_list_destroy(lxb_css_selector_list_t *list)
{
    (void) list;
}
