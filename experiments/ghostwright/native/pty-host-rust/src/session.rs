use crate::protocol::{
    CleanupOptions, Protocol, ProtocolError, SignalRequest, SpawnRequest, Viewport, RAW_LIMIT,
};
use nix::pty::{openpty, Winsize};
use nix::sys::signal::Signal;
use nix::sys::wait::{waitpid, WaitPidFlag, WaitStatus};
use nix::unistd::{fork, ForkResult, Pid};
use std::ffi::CString;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::ptr;
use std::thread::sleep;
use std::time::{Duration, Instant};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("POSIX operation failed: {0}")]
    Nix(#[from] nix::Error),
    #[error("I/O operation failed: {0}")]
    Io(#[from] io::Error),
    #[error("protocol output failed: {0}")]
    Protocol(#[from] ProtocolError),
    #[error("launch value contains NUL")]
    Nul(#[from] std::ffi::NulError),
    #[error("child exec failed: {0}")]
    Exec(io::Error),
    #[error("invalid signal {0}")]
    InvalidSignal(String),
}

struct PreparedExec {
    command: CString,
    argv: Vec<*const nix::libc::c_char>,
    _args: Vec<CString>,
    envp: Vec<*mut nix::libc::c_char>,
    _environment: Vec<CString>,
    cwd: Option<CString>,
}

impl PreparedExec {
    fn new(request: &SpawnRequest) -> Result<Self, SessionError> {
        let command = CString::new(request.command.as_str())?;
        let mut args = Vec::with_capacity(request.args.len() + 1);
        args.push(command.clone());
        for argument in &request.args {
            args.push(CString::new(argument.as_str())?);
        }
        let mut argv = args.iter().map(|value| value.as_ptr()).collect::<Vec<_>>();
        argv.push(ptr::null());

        let mut environment = Vec::with_capacity(request.environment.len());
        for (name, value) in &request.environment {
            environment.push(CString::new(format!("{name}={value}"))?);
        }
        let mut envp = environment
            .iter()
            .map(|value| value.as_ptr().cast_mut())
            .collect::<Vec<_>>();
        envp.push(ptr::null_mut());

        Ok(Self {
            command,
            argv,
            _args: args,
            envp,
            _environment: environment,
            cwd: request.cwd.as_deref().map(CString::new).transpose()?,
        })
    }
}

pub struct Session {
    master: Option<OwnedFd>,
    child: Option<Pid>,
    process_group: Option<Pid>,
    child_exited: bool,
    pty_eof: bool,
    exited_at: Option<Instant>,
    cleanup: CleanupOptions,
}

impl Session {
    pub fn new() -> Self {
        Self {
            master: None,
            child: None,
            process_group: None,
            child_exited: false,
            pty_eof: false,
            exited_at: None,
            cleanup: CleanupOptions::default(),
        }
    }

    pub fn poll_fd(&self) -> Option<i32> {
        self.master.as_ref().map(AsRawFd::as_raw_fd)
    }

    pub fn child_exited(&self) -> bool {
        self.child_exited
    }

    pub fn pty_eof(&self) -> bool {
        self.pty_eof
    }

    pub fn spawn(
        &mut self,
        protocol: &mut Protocol,
        correlation: u32,
        request: &SpawnRequest,
    ) -> Result<(), SessionError> {
        let mut prepared = PreparedExec::new(request)?;
        let window = Winsize {
            ws_row: request.viewport.rows,
            ws_col: request.viewport.columns,
            ws_xpixel: request.viewport.width_pixels,
            ws_ypixel: request.viewport.height_pixels,
        };
        let pty = openpty(Some(&window), None)?;
        let (barrier_read, barrier_write) = pipe_cloexec()?;
        let (exec_error_read, exec_error_write) = pipe_cloexec()?;

        let slave_fd = pty.slave.as_raw_fd();
        unsafe {
            let mut attributes = std::mem::zeroed::<nix::libc::termios>();
            if nix::libc::tcgetattr(slave_fd, &mut attributes) == 0 {
                #[cfg(any(target_os = "linux", target_os = "macos"))]
                {
                    attributes.c_iflag |= nix::libc::IUTF8;
                }
                nix::libc::tcsetattr(slave_fd, nix::libc::TCSANOW, &attributes);
            }
        }

        match unsafe { fork()? } {
            ForkResult::Child => unsafe {
                nix::libc::close(pty.master.as_raw_fd());
                nix::libc::close(barrier_write.as_raw_fd());
                nix::libc::close(exec_error_read.as_raw_fd());

                if nix::libc::setsid() < 0
                    || nix::libc::ioctl(slave_fd, nix::libc::TIOCSCTTY.into(), 0) < 0
                    || nix::libc::tcsetpgrp(slave_fd, nix::libc::getpid()) < 0
                    || nix::libc::dup2(slave_fd, nix::libc::STDIN_FILENO) < 0
                    || nix::libc::dup2(slave_fd, nix::libc::STDOUT_FILENO) < 0
                    || nix::libc::dup2(slave_fd, nix::libc::STDERR_FILENO) < 0
                {
                    nix::libc::_exit(126);
                }
                if slave_fd > nix::libc::STDERR_FILENO {
                    nix::libc::close(slave_fd);
                }

                let mut release = 0_u8;
                if nix::libc::read(
                    barrier_read.as_raw_fd(),
                    (&mut release as *mut u8).cast(),
                    1,
                ) != 1
                {
                    nix::libc::_exit(126);
                }
                nix::libc::close(barrier_read.as_raw_fd());

                if let Some(cwd) = &prepared.cwd {
                    if nix::libc::chdir(cwd.as_ptr()) < 0 {
                        write_exec_error(exec_error_write.as_raw_fd());
                        nix::libc::_exit(126);
                    }
                }
                unsafe extern "C" {
                    static mut environ: *mut *mut nix::libc::c_char;
                }
                environ = prepared.envp.as_mut_ptr();
                nix::libc::execvp(prepared.command.as_ptr(), prepared.argv.as_ptr());
                write_exec_error(exec_error_write.as_raw_fd());
                nix::libc::_exit(127);
            },
            ForkResult::Parent { child } => {
                drop(pty.slave);
                drop(barrier_read);
                drop(exec_error_write);
                self.master = Some(pty.master);
                self.child = Some(child);
                self.process_group = Some(child);
                self.cleanup = request.cleanup;

                protocol.spawned(correlation, child.as_raw(), child.as_raw())?;
                write_all_fd(barrier_write.as_raw_fd(), b"x")?;
                drop(barrier_write);

                let mut child_errno = 0_i32;
                let read = read_retry(
                    exec_error_read.as_raw_fd(),
                    (&mut child_errno as *mut i32).cast(),
                    std::mem::size_of::<i32>(),
                )?;
                drop(exec_error_read);
                if read > 0 {
                    let error = io::Error::from_raw_os_error(child_errno);
                    protocol.error(correlation, "GW_LAUNCH", &error.to_string(), true)?;
                    self.cleanup(protocol)?;
                    return Err(SessionError::Exec(error));
                }
                protocol.ack(correlation, crate::protocol::kind::SPAWN, None)?;
                Ok(())
            }
        }
    }

    pub fn write(&self, data: &[u8]) -> Result<usize, SessionError> {
        let fd = self
            .master
            .as_ref()
            .ok_or_else(|| io::Error::from(io::ErrorKind::BrokenPipe))?
            .as_raw_fd();
        Ok(write_all_fd(fd, data)?)
    }

    pub fn resize(&self, viewport: Viewport) -> Result<(), SessionError> {
        let fd = self
            .master
            .as_ref()
            .ok_or_else(|| io::Error::from(io::ErrorKind::BrokenPipe))?
            .as_raw_fd();
        let window = nix::libc::winsize {
            ws_row: viewport.rows,
            ws_col: viewport.columns,
            ws_xpixel: viewport.width_pixels,
            ws_ypixel: viewport.height_pixels,
        };
        if unsafe { nix::libc::ioctl(fd, nix::libc::TIOCSWINSZ, &window) } < 0 {
            return Err(io::Error::last_os_error().into());
        }
        Ok(())
    }

    pub fn signal(&self, request: &SignalRequest) -> Result<(), SessionError> {
        let signal = parse_signal(&request.signal)? as i32;
        let target = if request.target == "child" {
            self.child.map(Pid::as_raw)
        } else {
            self.process_group.map(|pid| -pid.as_raw())
        }
        .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))?;
        if unsafe { nix::libc::kill(target, signal) } < 0 {
            return Err(io::Error::last_os_error().into());
        }
        Ok(())
    }

    pub fn read_pty(&mut self, protocol: &mut Protocol) -> Result<(), SessionError> {
        let Some(master) = self.master.as_ref() else {
            return Ok(());
        };
        let mut buffer = [0_u8; RAW_LIMIT];
        let length = unsafe {
            nix::libc::read(master.as_raw_fd(), buffer.as_mut_ptr().cast(), buffer.len())
        };
        if length > 0 {
            protocol.output(&buffer[..length as usize])?;
        } else if length == 0
            || (length < 0
                && matches!(
                    io::Error::last_os_error().raw_os_error(),
                    Some(code) if code == nix::libc::EIO || code == nix::libc::EBADF
                ))
        {
            self.master.take();
            if !self.pty_eof {
                protocol.pty_eof()?;
                self.pty_eof = true;
            }
        } else if io::Error::last_os_error().raw_os_error() != Some(nix::libc::EINTR) {
            return Err(io::Error::last_os_error().into());
        }
        Ok(())
    }

    pub fn tick(&mut self, protocol: &mut Protocol) -> Result<(), SessionError> {
        self.reap_nonblocking(protocol)?;
        if self.child_exited
            && !self.pty_eof
            && self.exited_at.is_some_and(|at| {
                at.elapsed() >= Duration::from_millis(self.cleanup.post_exit_drain_ms.into())
            })
        {
            self.terminate_group(protocol)?;
            self.master.take();
            protocol.pty_eof()?;
            self.pty_eof = true;
        }
        Ok(())
    }

    pub fn cleanup(&mut self, protocol: &mut Protocol) -> Result<(), SessionError> {
        self.terminate_group(protocol)?;
        self.master.take();
        if let Some(child) = self.child {
            if !self.child_exited {
                loop {
                    match waitpid(child, None) {
                        Ok(status) => {
                            self.emit_exit(protocol, status)?;
                            break;
                        }
                        Err(nix::errno::Errno::EINTR) => continue,
                        Err(error) => return Err(error.into()),
                    }
                }
            }
        }
        Ok(())
    }

    fn emit_exit(
        &mut self,
        protocol: &mut Protocol,
        status: WaitStatus,
    ) -> Result<(), SessionError> {
        if self.child_exited {
            return Ok(());
        }
        let (exit_code, signal) = match status {
            WaitStatus::Exited(_, code) => (Some(code), None),
            WaitStatus::Signaled(_, signal, _) => (None, Some(signal as i32)),
            _ => return Ok(()),
        };
        protocol.process_exit(exit_code, signal)?;
        self.child_exited = true;
        self.exited_at = Some(Instant::now());
        Ok(())
    }

    fn reap_nonblocking(&mut self, protocol: &mut Protocol) -> Result<(), SessionError> {
        let Some(child) = self.child else {
            return Ok(());
        };
        if self.child_exited {
            return Ok(());
        }
        match waitpid(child, Some(WaitPidFlag::WNOHANG))? {
            WaitStatus::StillAlive => {}
            status => self.emit_exit(protocol, status)?,
        }
        Ok(())
    }

    fn group_alive(&self) -> bool {
        self.process_group
            .is_some_and(|group| unsafe { nix::libc::kill(-group.as_raw(), 0) == 0 })
    }

    fn wait_for_group(
        &mut self,
        protocol: &mut Protocol,
        duration: Duration,
    ) -> Result<(), SessionError> {
        let deadline = Instant::now() + duration;
        while Instant::now() < deadline {
            self.reap_nonblocking(protocol)?;
            if !self.group_alive() {
                return Ok(());
            }
            sleep(Duration::from_millis(10));
        }
        Ok(())
    }

    fn terminate_group(&mut self, protocol: &mut Protocol) -> Result<(), SessionError> {
        let Some(group) = self.process_group else {
            return Ok(());
        };
        if !self.group_alive() {
            return Ok(());
        }
        unsafe { nix::libc::kill(-group.as_raw(), nix::libc::SIGHUP) };
        self.wait_for_group(
            protocol,
            Duration::from_millis(self.cleanup.hangup_grace_ms.into()),
        )?;
        if self.group_alive() {
            unsafe { nix::libc::kill(-group.as_raw(), nix::libc::SIGTERM) };
            self.wait_for_group(
                protocol,
                Duration::from_millis(self.cleanup.terminate_grace_ms.into()),
            )?;
        }
        if self.group_alive() {
            unsafe { nix::libc::kill(-group.as_raw(), nix::libc::SIGKILL) };
        }
        Ok(())
    }
}

fn parse_signal(name: &str) -> Result<Signal, SessionError> {
    match name {
        "SIGINT" | "INT" => Ok(Signal::SIGINT),
        "SIGTERM" | "TERM" => Ok(Signal::SIGTERM),
        "SIGHUP" | "HUP" => Ok(Signal::SIGHUP),
        "SIGKILL" | "KILL" => Ok(Signal::SIGKILL),
        "SIGUSR1" | "USR1" => Ok(Signal::SIGUSR1),
        "SIGUSR2" | "USR2" => Ok(Signal::SIGUSR2),
        _ => Err(SessionError::InvalidSignal(name.to_owned())),
    }
}

fn pipe_cloexec() -> Result<(OwnedFd, OwnedFd), io::Error> {
    let mut descriptors = [-1_i32; 2];
    if unsafe { nix::libc::pipe(descriptors.as_mut_ptr()) } < 0 {
        return Err(io::Error::last_os_error());
    }
    for descriptor in descriptors {
        if unsafe { nix::libc::fcntl(descriptor, nix::libc::F_SETFD, nix::libc::FD_CLOEXEC) } < 0 {
            unsafe {
                nix::libc::close(descriptors[0]);
                nix::libc::close(descriptors[1]);
            }
            return Err(io::Error::last_os_error());
        }
    }
    Ok(unsafe {
        (
            OwnedFd::from_raw_fd(descriptors[0]),
            OwnedFd::from_raw_fd(descriptors[1]),
        )
    })
}

fn write_all_fd(fd: i32, data: &[u8]) -> Result<usize, io::Error> {
    let mut offset = 0;
    while offset < data.len() {
        let written =
            unsafe { nix::libc::write(fd, data[offset..].as_ptr().cast(), data.len() - offset) };
        if written < 0 && io::Error::last_os_error().raw_os_error() == Some(nix::libc::EINTR) {
            continue;
        }
        if written <= 0 {
            return Err(io::Error::last_os_error());
        }
        offset += written as usize;
    }
    Ok(offset)
}

fn read_retry(fd: i32, output: *mut nix::libc::c_void, length: usize) -> Result<isize, io::Error> {
    loop {
        let result = unsafe { nix::libc::read(fd, output, length) };
        if result < 0 && io::Error::last_os_error().raw_os_error() == Some(nix::libc::EINTR) {
            continue;
        }
        if result < 0 {
            return Err(io::Error::last_os_error());
        }
        return Ok(result);
    }
}

unsafe fn write_exec_error(fd: i32) {
    let error = nix::errno::Errno::last_raw();
    let bytes = error.to_ne_bytes();
    nix::libc::write(fd, bytes.as_ptr().cast(), bytes.len());
}
