#include "protocol.h"
#include "session.h"

#include <errno.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

typedef enum {
  HOST_INITIAL,
  HOST_READY,
  HOST_RUNNING,
  HOST_DRAINING,
  HOST_CLOSED,
} HostState;

typedef struct {
  GwProtocol protocol;
  GwSession session;
  GwBuffer input;
  HostState state;
} Host;

static int handle_command(Host *host, const GwFrame *frame) {
  switch (frame->kind) {
  case GW_HELLO:
    if (host->state != HOST_INITIAL)
      break;
    if (gw_emit_ready(&host->protocol, frame->sequence) != 0)
      return -1;
    host->state = HOST_READY;
    return 0;

  case GW_SPAWN: {
    if (host->state != HOST_READY)
      break;
    GwSpawnRequest request;
    if (gw_decode_spawn(frame->payload, frame->payload_length, &request) != 0) {
      gw_emit_error(&host->protocol, frame->sequence, "GW_LAUNCH",
                    "malformed SPAWN payload", true);
      return -1;
    }
    int result = gw_session_spawn(&host->session, &host->protocol,
                                  frame->sequence, &request);
    gw_spawn_request_free(&request);
    if (result != 0)
      return -1;
    host->state = HOST_RUNNING;
    return 0;
  }

  case GW_WRITE: {
    if (host->state != HOST_RUNNING)
      break;
    ssize_t written =
        gw_session_write(&host->session, frame->payload, frame->payload_length);
    if (written < 0) {
      gw_emit_error(&host->protocol, frame->sequence, "GW_LAUNCH",
                    strerror(errno), false);
      return 0;
    }
    return gw_emit_ack(&host->protocol, frame->sequence, GW_WRITE, written);
  }

  case GW_RESIZE: {
    if (host->state != HOST_RUNNING)
      break;
    GwViewport viewport;
    if (gw_decode_viewport(frame->payload, frame->payload_length, &viewport) !=
        0) {
      gw_emit_error(&host->protocol, frame->sequence, "GW_PROTOCOL",
                    "bad resize", false);
    } else if (gw_session_resize(&host->session, &viewport) != 0) {
      gw_emit_error(&host->protocol, frame->sequence, "GW_LAUNCH",
                    strerror(errno), false);
    } else {
      gw_emit_ack(&host->protocol, frame->sequence, GW_RESIZE, -1);
    }
    return 0;
  }

  case GW_SIGNAL: {
    if (host->state != HOST_RUNNING)
      break;
    GwSignalRequest request;
    if (gw_decode_signal(frame->payload, frame->payload_length, &request) !=
        0) {
      gw_emit_error(&host->protocol, frame->sequence, "GW_PROTOCOL",
                    "bad signal", false);
    } else if (gw_session_signal(&host->session, &request) != 0) {
      gw_emit_error(&host->protocol, frame->sequence, "GW_LAUNCH",
                    strerror(errno), false);
    } else {
      gw_emit_ack(&host->protocol, frame->sequence, GW_SIGNAL, -1);
    }
    gw_signal_request_free(&request);
    return 0;
  }

  case GW_CLOSE:
    if (host->state == HOST_INITIAL)
      break;
    gw_session_cleanup(&host->session, &host->protocol);
    host->state = HOST_CLOSED;
    gw_emit_ack(&host->protocol, frame->sequence, GW_CLOSE, -1);
    return 1;

  default:
    break;
  }

  gw_emit_error(&host->protocol, frame->sequence, "GW_PROTOCOL",
                "command invalid in current state", false);
  return 0;
}

static int read_control(Host *host) {
  uint8_t buffer[GW_RAW_LIMIT];
  ssize_t length = read(STDIN_FILENO, buffer, sizeof(buffer));
  if (length <= 0) {
    if (length < 0 && errno == EINTR)
      return 0;
    gw_session_cleanup(&host->session, &host->protocol);
    return 1;
  }
  if (gw_buffer_append(&host->input, buffer, (size_t)length) != 0)
    return -1;

  for (;;) {
    GwFrame frame;
    int decoded = gw_protocol_next_frame(&host->protocol, &host->input, &frame);
    if (decoded == 0)
      return 0;
    if (decoded < 0) {
      gw_emit_error(&host->protocol, 0, "GW_PROTOCOL", "invalid frame", true);
      gw_session_cleanup(&host->session, &host->protocol);
      return -1;
    }
    size_t consumed = GW_HEADER_SIZE + frame.payload_length;
    int command = handle_command(host, &frame);
    gw_buffer_consume(&host->input, consumed);
    if (command != 0)
      return command;
  }
}

int main(void) {
  signal(SIGPIPE, SIG_IGN);
  Host host = {.state = HOST_INITIAL};
  gw_protocol_init(&host.protocol);
  gw_session_init(&host.session);

  for (;;) {
    struct pollfd descriptors[2] = {
        {.fd = STDIN_FILENO, .events = POLLIN},
        {.fd = gw_session_poll_fd(&host.session), .events = POLLIN},
    };
    nfds_t count = descriptors[1].fd >= 0 ? 2 : 1;
    int result = poll(descriptors, count, 25);
    if (result < 0 && errno != EINTR) {
      perror("ghostwright pty-host poll");
      gw_session_cleanup(&host.session, &host.protocol);
      gw_buffer_free(&host.input);
      return 2;
    }

    if (descriptors[0].revents & (POLLIN | POLLHUP)) {
      int control = read_control(&host);
      if (control != 0) {
        gw_buffer_free(&host.input);
        return control < 0 ? 2 : 0;
      }
    }
    if (count == 2 && descriptors[1].revents & (POLLIN | POLLHUP)) {
      if (gw_session_read_pty(&host.session, &host.protocol) != 0) {
        gw_session_cleanup(&host.session, &host.protocol);
        gw_buffer_free(&host.input);
        return 2;
      }
    }

    gw_session_tick(&host.session, &host.protocol);
    if (host.session.child_exited && host.state == HOST_RUNNING)
      host.state = HOST_DRAINING;
    if (host.session.pty_eof && host.session.child_exited)
      host.state = HOST_CLOSED;
  }
}
