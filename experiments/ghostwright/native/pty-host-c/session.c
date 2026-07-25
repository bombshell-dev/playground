#define _GNU_SOURCE
#include "session.h"

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>
#if defined(__APPLE__)
#include <util.h>
#else
#include <pty.h>
#endif

extern char **environ;

static uint64_t monotonic_ms(void) {
  struct timespec value;
  if (clock_gettime(CLOCK_MONOTONIC, &value) != 0)
    return 0;
  return (uint64_t)value.tv_sec * 1000 + (uint64_t)value.tv_nsec / 1000000;
}

static int process_group_alive(const GwSession *session) {
  return session->process_group > 1 && kill(-session->process_group, 0) == 0;
}

static int emit_exit_once(GwSession *session, GwProtocol *protocol,
                          int wait_status) {
  if (session->child_exited)
    return 0;
  session->child_exited = true;
  session->wait_status = wait_status;
  session->exited_at_ms = monotonic_ms();
  return gw_emit_process_exit(protocol, wait_status);
}

static int reap_nonblocking(GwSession *session, GwProtocol *protocol) {
  if (session->child_pid <= 0 || session->child_exited)
    return session->child_exited;
  int wait_status;
  pid_t result = waitpid(session->child_pid, &wait_status, WNOHANG);
  if (result == session->child_pid) {
    emit_exit_once(session, protocol, wait_status);
    return 1;
  }
  return 0;
}

static void wait_for_group(GwSession *session, GwProtocol *protocol,
                           unsigned milliseconds) {
  for (unsigned elapsed = 0; elapsed < milliseconds; elapsed += 10) {
    reap_nonblocking(session, protocol);
    if (!process_group_alive(session))
      return;
    usleep(10000);
  }
}

static void terminate_group(GwSession *session, GwProtocol *protocol) {
  if (session->process_group <= 1 || !process_group_alive(session))
    return;
  if (kill(-session->process_group, SIGHUP) == 0) {
    wait_for_group(session, protocol, session->cleanup.hangup_grace_ms);
    if (process_group_alive(session)) {
      kill(-session->process_group, SIGTERM);
      wait_for_group(session, protocol, session->cleanup.terminate_grace_ms);
    }
    if (process_group_alive(session))
      kill(-session->process_group, SIGKILL);
  }
}

static void close_master(GwSession *session, GwProtocol *protocol) {
  if (session->master_fd >= 0) {
    close(session->master_fd);
    session->master_fd = -1;
  }
  if (!session->pty_eof) {
    gw_emit_pty_eof(protocol);
    session->pty_eof = true;
  }
}

void gw_session_init(GwSession *session) {
  *session = (GwSession){
      .master_fd = -1,
      .child_pid = -1,
      .process_group = -1,
      .cleanup =
          {
              .hangup_grace_ms = 500,
              .terminate_grace_ms = 500,
              .post_exit_drain_ms = 1000,
          },
  };
}

int gw_session_spawn(GwSession *session, GwProtocol *protocol,
                     uint32_t correlation, const GwSpawnRequest *request) {
  struct winsize window = {
      .ws_row = request->viewport.rows,
      .ws_col = request->viewport.columns,
      .ws_xpixel = request->viewport.width_pixels,
      .ws_ypixel = request->viewport.height_pixels,
  };
  int slave = -1;
  int barrier[2] = {-1, -1};
  int exec_error[2] = {-1, -1};

  if (openpty(&session->master_fd, &slave, NULL, NULL, &window) != 0 ||
      pipe(barrier) != 0 || pipe(exec_error) != 0) {
    gw_emit_error(protocol, correlation, "GW_LAUNCH", strerror(errno), true);
    if (slave >= 0)
      close(slave);
    return -1;
  }
  fcntl(exec_error[1], F_SETFD, FD_CLOEXEC);

  struct termios attributes;
  if (tcgetattr(slave, &attributes) == 0) {
#ifdef IUTF8
    attributes.c_iflag |= IUTF8;
#endif
    tcsetattr(slave, TCSANOW, &attributes);
  }

  pid_t child = fork();
  if (child < 0) {
    gw_emit_error(protocol, correlation, "GW_LAUNCH", strerror(errno), true);
    close(slave);
    return -1;
  }

  if (child == 0) {
    close(session->master_fd);
    close(barrier[1]);
    close(exec_error[0]);

    if (setsid() < 0 || ioctl(slave, TIOCSCTTY, 0) < 0 ||
        tcsetpgrp(slave, getpid()) < 0 || dup2(slave, STDIN_FILENO) < 0 ||
        dup2(slave, STDOUT_FILENO) < 0 || dup2(slave, STDERR_FILENO) < 0)
      _exit(126);
    if (slave > STDERR_FILENO)
      close(slave);

    char release;
    if (read(barrier[0], &release, 1) != 1)
      _exit(126);
    close(barrier[0]);

    if (request->cwd != NULL && chdir(request->cwd) != 0) {
      int child_errno = errno;
      write(exec_error[1], &child_errno, sizeof(child_errno));
      _exit(126);
    }
    if (request->environment != NULL)
      environ = request->environment;
    execvp(request->command, request->args);

    int child_errno = errno;
    write(exec_error[1], &child_errno, sizeof(child_errno));
    _exit(127);
  }

  close(slave);
  close(barrier[0]);
  close(exec_error[1]);
  session->child_pid = child;
  session->process_group = child;
  session->cleanup = request->cleanup;

  if (gw_emit_spawned(protocol, correlation, child, child) != 0)
    return -1;
  if (write(barrier[1], "x", 1) != 1)
    return -1;
  close(barrier[1]);

  int child_errno = 0;
  ssize_t exec_result;
  do {
    exec_result = read(exec_error[0], &child_errno, sizeof(child_errno));
  } while (exec_result < 0 && errno == EINTR);
  close(exec_error[0]);

  if (exec_result > 0) {
    gw_emit_error(protocol, correlation, "GW_LAUNCH", strerror(child_errno),
                  true);
    gw_session_cleanup(session, protocol);
    return -1;
  }
  return gw_emit_ack(protocol, correlation, GW_SPAWN, -1);
}

ssize_t gw_session_write(GwSession *session, const uint8_t *data,
                         size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t written = write(session->master_fd, data + offset, length - offset);
    if (written < 0 && errno == EINTR)
      continue;
    if (written <= 0)
      return offset > 0 ? (ssize_t)offset : -1;
    offset += (size_t)written;
  }
  return (ssize_t)offset;
}

int gw_session_resize(GwSession *session, const GwViewport *viewport) {
  struct winsize window = {
      .ws_row = viewport->rows,
      .ws_col = viewport->columns,
      .ws_xpixel = viewport->width_pixels,
      .ws_ypixel = viewport->height_pixels,
  };
  return ioctl(session->master_fd, TIOCSWINSZ, &window);
}

static int signal_number(const char *name) {
  if (strcmp(name, "SIGINT") == 0 || strcmp(name, "INT") == 0)
    return SIGINT;
  if (strcmp(name, "SIGTERM") == 0 || strcmp(name, "TERM") == 0)
    return SIGTERM;
  if (strcmp(name, "SIGHUP") == 0 || strcmp(name, "HUP") == 0)
    return SIGHUP;
  if (strcmp(name, "SIGKILL") == 0 || strcmp(name, "KILL") == 0)
    return SIGKILL;
  if (strcmp(name, "SIGUSR1") == 0 || strcmp(name, "USR1") == 0)
    return SIGUSR1;
  if (strcmp(name, "SIGUSR2") == 0 || strcmp(name, "USR2") == 0)
    return SIGUSR2;
  return 0;
}

int gw_session_signal(GwSession *session, const GwSignalRequest *request) {
  int signal = signal_number(request->signal);
  if (signal == 0) {
    errno = EINVAL;
    return -1;
  }
  pid_t target = strcmp(request->target, "child") == 0
                     ? session->child_pid
                     : -session->process_group;
  return kill(target, signal);
}

int gw_session_read_pty(GwSession *session, GwProtocol *protocol) {
  uint8_t buffer[GW_RAW_LIMIT];
  ssize_t length = read(session->master_fd, buffer, sizeof(buffer));
  if (length > 0)
    return gw_emit_output(protocol, buffer, (size_t)length);
  if (length == 0 || (length < 0 && (errno == EIO || errno == EBADF))) {
    close_master(session, protocol);
    return 0;
  }
  return errno == EINTR ? 0 : -1;
}

int gw_session_tick(GwSession *session, GwProtocol *protocol) {
  reap_nonblocking(session, protocol);
  if (session->child_exited && !session->pty_eof && session->master_fd >= 0 &&
      monotonic_ms() - session->exited_at_ms >=
          session->cleanup.post_exit_drain_ms) {
    terminate_group(session, protocol);
    close_master(session, protocol);
  }
  return 0;
}

int gw_session_cleanup(GwSession *session, GwProtocol *protocol) {
  terminate_group(session, protocol);
  if (session->master_fd >= 0) {
    close(session->master_fd);
    session->master_fd = -1;
  }
  if (session->child_pid > 0 && !session->child_exited) {
    int wait_status;
    pid_t result;
    do {
      result = waitpid(session->child_pid, &wait_status, 0);
    } while (result < 0 && errno == EINTR);
    if (result == session->child_pid)
      emit_exit_once(session, protocol, wait_status);
  }
  return 0;
}

int gw_session_poll_fd(const GwSession *session) { return session->master_fd; }
