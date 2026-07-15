#include "protocol.h"

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

__attribute__((used)) const char ghostwright_protocol_marker[] =
    "GWPT_PROTOCOL_VERSION=1";

typedef struct {
  const uint8_t *data;
  size_t length;
  size_t offset;
} CborCursor;

static uint16_t read_u16_le(const uint8_t *data) {
  return (uint16_t)data[0] | ((uint16_t)data[1] << 8);
}

static uint32_t read_u32_le(const uint8_t *data) {
  return (uint32_t)data[0] | ((uint32_t)data[1] << 8) |
         ((uint32_t)data[2] << 16) | ((uint32_t)data[3] << 24);
}

static void write_u16_le(uint8_t *data, uint16_t value) {
  data[0] = (uint8_t)value;
  data[1] = (uint8_t)(value >> 8);
}

static void write_u32_le(uint8_t *data, uint32_t value) {
  data[0] = (uint8_t)value;
  data[1] = (uint8_t)(value >> 8);
  data[2] = (uint8_t)(value >> 16);
  data[3] = (uint8_t)(value >> 24);
}

static int write_all(int fd, const void *data, size_t length) {
  const uint8_t *cursor = data;
  while (length > 0) {
    ssize_t written = write(fd, cursor, length);
    if (written < 0 && errno == EINTR)
      continue;
    if (written <= 0)
      return -1;
    cursor += written;
    length -= (size_t)written;
  }
  return 0;
}

void gw_protocol_init(GwProtocol *protocol) {
  protocol->output_sequence = 1;
  protocol->input_sequence = 0;
}

void gw_buffer_free(GwBuffer *buffer) {
  free(buffer->data);
  *buffer = (GwBuffer){0};
}

int gw_buffer_append(GwBuffer *buffer, const void *data, size_t length) {
  if (length > SIZE_MAX - buffer->length)
    return -1;
  size_t needed = buffer->length + length;
  if (needed > buffer->capacity) {
    size_t capacity = needed * 2 + 64;
    uint8_t *next = realloc(buffer->data, capacity);
    if (next == NULL)
      return -1;
    buffer->data = next;
    buffer->capacity = capacity;
  }
  memcpy(buffer->data + buffer->length, data, length);
  buffer->length = needed;
  return 0;
}

void gw_buffer_consume(GwBuffer *buffer, size_t length) {
  if (length >= buffer->length) {
    buffer->length = 0;
    return;
  }
  memmove(buffer->data, buffer->data + length, buffer->length - length);
  buffer->length -= length;
}

int gw_protocol_next_frame(GwProtocol *protocol, GwBuffer *buffer,
                           GwFrame *frame) {
  if (buffer->length < GW_HEADER_SIZE)
    return 0;
  const uint8_t *header = buffer->data;
  if (memcmp(header, "GWPT", 4) != 0 ||
      read_u16_le(header + 4) != GW_PROTOCOL_VERSION ||
      read_u32_le(header + 12) != 0)
    return -1;

  uint16_t kind = read_u16_le(header + 6);
  uint32_t sequence = read_u32_le(header + 8);
  uint32_t payload_length = read_u32_le(header + 16);
  uint32_t limit = kind == GW_WRITE ? GW_RAW_LIMIT : GW_CONTROL_LIMIT;
  if (payload_length > limit)
    return -1;
  if (buffer->length < GW_HEADER_SIZE + payload_length)
    return 0;
  if (sequence == 0 || sequence <= protocol->input_sequence)
    return -1;
  protocol->input_sequence = sequence;

  *frame = (GwFrame){
      .kind = kind,
      .sequence = sequence,
      .correlation = 0,
      .payload = header + GW_HEADER_SIZE,
      .payload_length = payload_length,
  };
  return 1;
}

static int emit_frame(GwProtocol *protocol, uint16_t kind, uint32_t correlation,
                      const void *payload, uint32_t payload_length) {
  uint8_t header[GW_HEADER_SIZE] = {'G', 'W', 'P', 'T'};
  write_u16_le(header + 4, GW_PROTOCOL_VERSION);
  write_u16_le(header + 6, kind);
  write_u32_le(header + 8, protocol->output_sequence++);
  write_u32_le(header + 12, correlation);
  write_u32_le(header + 16, payload_length);
  if (write_all(STDOUT_FILENO, header, sizeof(header)) != 0)
    return -1;
  if (payload_length > 0 &&
      write_all(STDOUT_FILENO, payload, payload_length) != 0)
    return -1;
  return 0;
}

static int cbor_head(GwBuffer *buffer, unsigned major, uint64_t value) {
  uint8_t bytes[5];
  size_t length;
  if (value < 24) {
    bytes[0] = (uint8_t)((major << 5) | value);
    length = 1;
  } else if (value <= UINT8_MAX) {
    bytes[0] = (uint8_t)((major << 5) | 24);
    bytes[1] = (uint8_t)value;
    length = 2;
  } else if (value <= UINT16_MAX) {
    bytes[0] = (uint8_t)((major << 5) | 25);
    bytes[1] = (uint8_t)(value >> 8);
    bytes[2] = (uint8_t)value;
    length = 3;
  } else {
    bytes[0] = (uint8_t)((major << 5) | 26);
    bytes[1] = (uint8_t)(value >> 24);
    bytes[2] = (uint8_t)(value >> 16);
    bytes[3] = (uint8_t)(value >> 8);
    bytes[4] = (uint8_t)value;
    length = 5;
  }
  return gw_buffer_append(buffer, bytes, length);
}

static int cbor_text(GwBuffer *buffer, const char *value) {
  size_t length = strlen(value);
  return cbor_head(buffer, 3, length) ||
         gw_buffer_append(buffer, value, length);
}

static int cbor_uint(GwBuffer *buffer, uint64_t value) {
  return cbor_head(buffer, 0, value);
}

static int cbor_null(GwBuffer *buffer) {
  uint8_t value = 0xf6;
  return gw_buffer_append(buffer, &value, 1);
}

static int cbor_bool(GwBuffer *buffer, bool value) {
  uint8_t encoded = value ? 0xf5 : 0xf4;
  return gw_buffer_append(buffer, &encoded, 1);
}

int gw_emit_ready(GwProtocol *protocol, uint32_t correlation) {
  GwBuffer payload = {0};
  int failed = cbor_head(&payload, 5, 3) || cbor_text(&payload, "version") ||
               cbor_uint(&payload, 1) || cbor_text(&payload, "platform") ||
               cbor_text(&payload, "posix") ||
               cbor_text(&payload, "hostVersion") ||
               cbor_text(&payload, "0.1.0");
  int result = failed ? -1
                      : emit_frame(protocol, GW_READY, correlation,
                                   payload.data, payload.length);
  gw_buffer_free(&payload);
  return result;
}

int gw_emit_spawned(GwProtocol *protocol, uint32_t correlation, pid_t pid,
                    pid_t pgid) {
  GwBuffer payload = {0};
  int failed =
      cbor_head(&payload, 5, 4) || cbor_text(&payload, "pid") ||
      cbor_uint(&payload, (uint64_t)pid) || cbor_text(&payload, "ttyName") ||
      cbor_text(&payload, "pty") || cbor_text(&payload, "execPending") ||
      cbor_bool(&payload, true) || cbor_text(&payload, "processGroupId") ||
      cbor_uint(&payload, (uint64_t)pgid);
  int result = failed ? -1
                      : emit_frame(protocol, GW_SPAWNED, correlation,
                                   payload.data, payload.length);
  gw_buffer_free(&payload);
  return result;
}

int gw_emit_ack(GwProtocol *protocol, uint32_t correlation, uint16_t kind,
                ssize_t bytes_written) {
  GwBuffer payload = {0};
  int failed = cbor_head(&payload, 5, bytes_written < 0 ? 1 : 2) ||
               cbor_text(&payload, "kind") || cbor_uint(&payload, kind);
  if (!failed && bytes_written >= 0)
    failed = cbor_text(&payload, "bytesWritten") ||
             cbor_uint(&payload, bytes_written);
  int result = failed ? -1
                      : emit_frame(protocol, GW_ACK, correlation, payload.data,
                                   payload.length);
  gw_buffer_free(&payload);
  return result;
}

int gw_emit_error(GwProtocol *protocol, uint32_t correlation, const char *code,
                  const char *message, bool fatal) {
  GwBuffer payload = {0};
  int failed = cbor_head(&payload, 5, 3) || cbor_text(&payload, "code") ||
               cbor_text(&payload, code) || cbor_text(&payload, "fatal") ||
               cbor_bool(&payload, fatal) || cbor_text(&payload, "message") ||
               cbor_text(&payload, message);
  int result = failed ? -1
                      : emit_frame(protocol, GW_ERROR, correlation,
                                   payload.data, payload.length);
  gw_buffer_free(&payload);
  return result;
}

int gw_emit_output(GwProtocol *protocol, const uint8_t *data, size_t length) {
  if (length > GW_RAW_LIMIT)
    return -1;
  return emit_frame(protocol, GW_OUTPUT, 0, data, (uint32_t)length);
}

int gw_emit_process_exit(GwProtocol *protocol, int wait_status) {
  GwBuffer payload = {0};
  int failed = cbor_head(&payload, 5, 2) || cbor_text(&payload, "signal");
  if (!failed) {
    if (WIFSIGNALED(wait_status)) {
      char signal[24];
      snprintf(signal, sizeof(signal), "SIG%d", WTERMSIG(wait_status));
      failed = cbor_text(&payload, signal);
    } else {
      failed = cbor_null(&payload);
    }
  }
  if (!failed)
    failed = cbor_text(&payload, "exitCode");
  if (!failed) {
    failed = WIFEXITED(wait_status)
                 ? cbor_uint(&payload, WEXITSTATUS(wait_status))
                 : cbor_null(&payload);
  }
  int result = failed ? -1
                      : emit_frame(protocol, GW_PROCESS_EXIT, 0, payload.data,
                                   payload.length);
  gw_buffer_free(&payload);
  return result;
}

int gw_emit_pty_eof(GwProtocol *protocol) {
  return emit_frame(protocol, GW_PTY_EOF, 0, NULL, 0);
}

static int cbor_length(CborCursor *cursor, unsigned *major, uint64_t *value) {
  if (cursor->offset >= cursor->length)
    return -1;
  uint8_t head = cursor->data[cursor->offset++];
  *major = head >> 5;
  unsigned additional = head & 31;
  if (additional < 24) {
    *value = additional;
    return 0;
  }
  unsigned bytes = additional == 24   ? 1
                   : additional == 25 ? 2
                   : additional == 26 ? 4
                                      : 0;
  if (bytes == 0 || cursor->offset + bytes > cursor->length)
    return -1;
  *value = 0;
  while (bytes-- > 0)
    *value = (*value << 8) | cursor->data[cursor->offset++];
  return 0;
}

static int cbor_skip(CborCursor *cursor) {
  unsigned major;
  uint64_t length;
  if (cbor_length(cursor, &major, &length) != 0)
    return -1;
  if (major <= 1 || major == 7)
    return 0;
  if (major == 2 || major == 3) {
    if (length > cursor->length - cursor->offset)
      return -1;
    cursor->offset += (size_t)length;
    return 0;
  }
  if (major == 4) {
    while (length-- > 0)
      if (cbor_skip(cursor) != 0)
        return -1;
    return 0;
  }
  if (major == 5) {
    while (length-- > 0)
      if (cbor_skip(cursor) != 0 || cbor_skip(cursor) != 0)
        return -1;
    return 0;
  }
  return -1;
}

static int cbor_text_value(CborCursor *cursor, char **output) {
  unsigned major;
  uint64_t length;
  if (cbor_length(cursor, &major, &length) != 0 || major != 3 ||
      length > cursor->length - cursor->offset)
    return -1;
  char *value = malloc((size_t)length + 1);
  if (value == NULL)
    return -1;
  memcpy(value, cursor->data + cursor->offset, (size_t)length);
  value[length] = '\0';
  cursor->offset += (size_t)length;
  *output = value;
  return 0;
}

static int cbor_uint_value(CborCursor *cursor, uint64_t *output) {
  unsigned major;
  return cbor_length(cursor, &major, output) == 0 && major == 0 ? 0 : -1;
}

static int decode_viewport_cursor(CborCursor *cursor, GwViewport *viewport) {
  unsigned major;
  uint64_t entries;
  if (cbor_length(cursor, &major, &entries) != 0 || major != 5)
    return -1;
  while (entries-- > 0) {
    char *key = NULL;
    uint64_t value;
    if (cbor_text_value(cursor, &key) != 0 ||
        cbor_uint_value(cursor, &value) != 0 || value > UINT16_MAX) {
      free(key);
      return -1;
    }
    if (strcmp(key, "columns") == 0)
      viewport->columns = (uint16_t)value;
    else if (strcmp(key, "rows") == 0)
      viewport->rows = (uint16_t)value;
    else if (strcmp(key, "widthPixels") == 0)
      viewport->width_pixels = (uint16_t)value;
    else if (strcmp(key, "heightPixels") == 0)
      viewport->height_pixels = (uint16_t)value;
    free(key);
  }
  return viewport->columns && viewport->rows && viewport->width_pixels &&
                 viewport->height_pixels
             ? 0
             : -1;
}

static int decode_cleanup(CborCursor *cursor, GwCleanupOptions *cleanup) {
  unsigned major;
  uint64_t entries;
  if (cbor_length(cursor, &major, &entries) != 0 || major != 5)
    return -1;
  while (entries-- > 0) {
    char *key = NULL;
    uint64_t value;
    if (cbor_text_value(cursor, &key) != 0 ||
        cbor_uint_value(cursor, &value) != 0 || value > UINT_MAX) {
      free(key);
      return -1;
    }
    if (strcmp(key, "hangupGraceMs") == 0)
      cleanup->hangup_grace_ms = (unsigned)value;
    else if (strcmp(key, "terminateGraceMs") == 0)
      cleanup->terminate_grace_ms = (unsigned)value;
    else if (strcmp(key, "postExitDrainMs") == 0)
      cleanup->post_exit_drain_ms = (unsigned)value;
    free(key);
  }
  return 0;
}

int gw_decode_spawn(const uint8_t *payload, size_t length,
                    GwSpawnRequest *request) {
  *request = (GwSpawnRequest){
      .cleanup = {.hangup_grace_ms = 500,
                  .terminate_grace_ms = 500,
                  .post_exit_drain_ms = 1000},
  };
  CborCursor cursor = {.data = payload, .length = length};
  unsigned major;
  uint64_t entries;
  if (cbor_length(&cursor, &major, &entries) != 0 || major != 5)
    return -1;

  while (entries-- > 0) {
    char *key = NULL;
    if (cbor_text_value(&cursor, &key) != 0)
      goto fail;
    if (strcmp(key, "command") == 0) {
      if (cbor_text_value(&cursor, &request->command) != 0)
        goto key_fail;
    } else if (strcmp(key, "cwd") == 0) {
      if (cursor.offset < cursor.length && cursor.data[cursor.offset] == 0xf6)
        cursor.offset++;
      else if (cbor_text_value(&cursor, &request->cwd) != 0)
        goto key_fail;
    } else if (strcmp(key, "args") == 0) {
      uint64_t count;
      if (cbor_length(&cursor, &major, &count) != 0 || major != 4 ||
          count > SIZE_MAX - 2)
        goto key_fail;
      request->args = calloc((size_t)count + 2, sizeof(char *));
      if (request->args == NULL)
        goto key_fail;
      request->args_length = (size_t)count;
      for (size_t index = 0; index < request->args_length; index++)
        if (cbor_text_value(&cursor, &request->args[index + 1]) != 0)
          goto key_fail;
    } else if (strcmp(key, "env") == 0) {
      uint64_t count;
      if (cbor_length(&cursor, &major, &count) != 0 || major != 5 ||
          count > SIZE_MAX - 1)
        goto key_fail;
      request->environment = calloc((size_t)count + 1, sizeof(char *));
      if (request->environment == NULL)
        goto key_fail;
      request->environment_length = (size_t)count;
      for (size_t index = 0; index < request->environment_length; index++) {
        char *name = NULL;
        char *value = NULL;
        if (cbor_text_value(&cursor, &name) != 0 ||
            cbor_text_value(&cursor, &value) != 0) {
          free(name);
          free(value);
          goto key_fail;
        }
        size_t pair_length = strlen(name) + strlen(value) + 2;
        request->environment[index] = malloc(pair_length);
        if (request->environment[index] == NULL) {
          free(name);
          free(value);
          goto key_fail;
        }
        snprintf(request->environment[index], pair_length, "%s=%s", name,
                 value);
        free(name);
        free(value);
      }
    } else if (strcmp(key, "viewport") == 0) {
      if (decode_viewport_cursor(&cursor, &request->viewport) != 0)
        goto key_fail;
    } else if (strcmp(key, "cleanup") == 0) {
      if (decode_cleanup(&cursor, &request->cleanup) != 0)
        goto key_fail;
    } else if (cbor_skip(&cursor) != 0) {
      goto key_fail;
    }
    free(key);
    continue;

  key_fail:
    free(key);
    goto fail;
  }

  if (request->command == NULL || request->command[0] == '\0' ||
      request->viewport.columns == 0 || request->viewport.rows == 0)
    goto fail;
  if (request->args == NULL) {
    request->args = calloc(2, sizeof(char *));
    if (request->args == NULL)
      goto fail;
  }
  request->args[0] = request->command;
  return cursor.offset == cursor.length ? 0 : -1;

fail:
  gw_spawn_request_free(request);
  return -1;
}

void gw_spawn_request_free(GwSpawnRequest *request) {
  if (request->args != NULL) {
    for (size_t index = 0; index < request->args_length; index++)
      free(request->args[index + 1]);
    free(request->args);
  }
  if (request->environment != NULL) {
    for (size_t index = 0; index < request->environment_length; index++)
      free(request->environment[index]);
    free(request->environment);
  }
  free(request->command);
  free(request->cwd);
  *request = (GwSpawnRequest){0};
}

int gw_decode_viewport(const uint8_t *payload, size_t length,
                       GwViewport *viewport) {
  *viewport = (GwViewport){0};
  CborCursor cursor = {.data = payload, .length = length};
  return decode_viewport_cursor(&cursor, viewport) == 0 &&
                 cursor.offset == cursor.length
             ? 0
             : -1;
}

int gw_decode_signal(const uint8_t *payload, size_t length,
                     GwSignalRequest *request) {
  *request = (GwSignalRequest){0};
  CborCursor cursor = {.data = payload, .length = length};
  unsigned major;
  uint64_t entries;
  if (cbor_length(&cursor, &major, &entries) != 0 || major != 5)
    return -1;
  while (entries-- > 0) {
    char *key = NULL;
    if (cbor_text_value(&cursor, &key) != 0)
      goto fail;
    if (strcmp(key, "signal") == 0) {
      if (cbor_text_value(&cursor, &request->signal) != 0) {
        free(key);
        goto fail;
      }
    } else if (strcmp(key, "target") == 0) {
      if (cbor_text_value(&cursor, &request->target) != 0) {
        free(key);
        goto fail;
      }
    } else if (cbor_skip(&cursor) != 0) {
      free(key);
      goto fail;
    }
    free(key);
  }
  if (request->signal == NULL || request->target == NULL ||
      cursor.offset != cursor.length)
    goto fail;
  return 0;

fail:
  gw_signal_request_free(request);
  return -1;
}

void gw_signal_request_free(GwSignalRequest *request) {
  free(request->signal);
  free(request->target);
  *request = (GwSignalRequest){0};
}
