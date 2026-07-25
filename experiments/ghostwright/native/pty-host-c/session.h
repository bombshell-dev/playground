#ifndef GHOSTWRIGHT_SESSION_H
#define GHOSTWRIGHT_SESSION_H

#include "protocol.h"

#include <stdbool.h>
#include <stdint.h>
#include <sys/types.h>

typedef struct {
  int master_fd;
  pid_t child_pid;
  pid_t process_group;
  bool child_exited;
  bool pty_eof;
  int wait_status;
  uint64_t exited_at_ms;
  GwCleanupOptions cleanup;
} GwSession;

void gw_session_init(GwSession *session);
int gw_session_spawn(GwSession *session, GwProtocol *protocol,
                     uint32_t correlation, const GwSpawnRequest *request);
ssize_t gw_session_write(GwSession *session, const uint8_t *data,
                         size_t length);
int gw_session_resize(GwSession *session, const GwViewport *viewport);
int gw_session_signal(GwSession *session, const GwSignalRequest *request);
int gw_session_read_pty(GwSession *session, GwProtocol *protocol);
int gw_session_tick(GwSession *session, GwProtocol *protocol);
int gw_session_cleanup(GwSession *session, GwProtocol *protocol);
int gw_session_poll_fd(const GwSession *session);

#endif
