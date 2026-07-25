#ifndef GHOSTWRIGHT_PROTOCOL_H
#define GHOSTWRIGHT_PROTOCOL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

#define GW_PROTOCOL_VERSION 1
#define GW_HEADER_SIZE 20
#define GW_CONTROL_LIMIT (1024U * 1024U)
#define GW_RAW_LIMIT 65536U

extern const char ghostwright_protocol_marker[];

typedef enum {
  GW_HELLO = 0x0001,
  GW_SPAWN = 0x0002,
  GW_WRITE = 0x0003,
  GW_RESIZE = 0x0004,
  GW_SIGNAL = 0x0005,
  GW_CLOSE = 0x0006,
  GW_READY = 0x8001,
  GW_SPAWNED = 0x8002,
  GW_ACK = 0x8003,
  GW_ERROR = 0x80ff,
  GW_OUTPUT = 0x8100,
  GW_PROCESS_EXIT = 0x8101,
  GW_PTY_EOF = 0x8102,
} GwFrameKind;

typedef struct {
  uint8_t *data;
  size_t length;
  size_t capacity;
} GwBuffer;

typedef struct {
  uint16_t kind;
  uint32_t sequence;
  uint32_t correlation;
  const uint8_t *payload;
  uint32_t payload_length;
} GwFrame;

typedef struct {
  uint32_t output_sequence;
  uint32_t input_sequence;
} GwProtocol;

typedef struct {
  uint16_t columns;
  uint16_t rows;
  uint16_t width_pixels;
  uint16_t height_pixels;
} GwViewport;

typedef struct {
  unsigned hangup_grace_ms;
  unsigned terminate_grace_ms;
  unsigned post_exit_drain_ms;
} GwCleanupOptions;

typedef struct {
  char *command;
  char **args;
  size_t args_length;
  char **environment;
  size_t environment_length;
  char *cwd;
  GwViewport viewport;
  GwCleanupOptions cleanup;
} GwSpawnRequest;

typedef struct {
  char *signal;
  char *target;
} GwSignalRequest;

void gw_protocol_init(GwProtocol *protocol);
void gw_buffer_free(GwBuffer *buffer);
int gw_buffer_append(GwBuffer *buffer, const void *data, size_t length);
void gw_buffer_consume(GwBuffer *buffer, size_t length);
int gw_protocol_next_frame(GwProtocol *protocol, GwBuffer *buffer,
                           GwFrame *frame);

int gw_decode_spawn(const uint8_t *payload, size_t length,
                    GwSpawnRequest *request);
void gw_spawn_request_free(GwSpawnRequest *request);
int gw_decode_viewport(const uint8_t *payload, size_t length,
                       GwViewport *viewport);
int gw_decode_signal(const uint8_t *payload, size_t length,
                     GwSignalRequest *request);
void gw_signal_request_free(GwSignalRequest *request);

int gw_emit_ready(GwProtocol *protocol, uint32_t correlation);
int gw_emit_spawned(GwProtocol *protocol, uint32_t correlation, pid_t pid,
                    pid_t pgid);
int gw_emit_ack(GwProtocol *protocol, uint32_t correlation, uint16_t kind,
                ssize_t bytes_written);
int gw_emit_error(GwProtocol *protocol, uint32_t correlation, const char *code,
                  const char *message, bool fatal);
int gw_emit_output(GwProtocol *protocol, const uint8_t *data, size_t length);
int gw_emit_process_exit(GwProtocol *protocol, int wait_status);
int gw_emit_pty_eof(GwProtocol *protocol);

#endif
