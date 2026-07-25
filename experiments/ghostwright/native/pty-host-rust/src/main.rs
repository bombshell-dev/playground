mod protocol;
mod session;

use protocol::{decode_signal, decode_spawn, decode_viewport, kind, Protocol, RAW_LIMIT};
use session::Session;
use std::io;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HostState {
    Initial,
    Ready,
    Running,
    Draining,
    Closed,
}

struct Host {
    protocol: Protocol,
    session: Session,
    state: HostState,
}

impl Host {
    fn new() -> Self {
        Self {
            protocol: Protocol::new(),
            session: Session::new(),
            state: HostState::Initial,
        }
    }

    fn command(&mut self, frame: protocol::Frame) -> Result<bool, Box<dyn std::error::Error>> {
        match frame.kind {
            kind::HELLO if self.state == HostState::Initial => {
                self.protocol.ready(frame.sequence)?;
                self.state = HostState::Ready;
            }
            kind::SPAWN if self.state == HostState::Ready => {
                let request = match decode_spawn(&frame.payload) {
                    Ok(request) => request,
                    Err(error) => {
                        self.protocol.error(
                            frame.sequence,
                            "GW_LAUNCH",
                            &format!("malformed SPAWN payload: {error}"),
                            true,
                        )?;
                        return Ok(true);
                    }
                };
                if self
                    .session
                    .spawn(&mut self.protocol, frame.sequence, &request)
                    .is_err()
                {
                    return Ok(true);
                }
                self.state = HostState::Running;
            }
            kind::WRITE if self.state == HostState::Running => {
                match self.session.write(&frame.payload) {
                    Ok(written) => {
                        self.protocol
                            .ack(frame.sequence, kind::WRITE, Some(written))?;
                    }
                    Err(error) => {
                        self.protocol.error(
                            frame.sequence,
                            "GW_LAUNCH",
                            &error.to_string(),
                            false,
                        )?;
                    }
                }
            }
            kind::RESIZE if self.state == HostState::Running => {
                match decode_viewport(&frame.payload)
                    .map_err(|error| error.to_string())
                    .and_then(|viewport| {
                        self.session
                            .resize(viewport)
                            .map_err(|error| error.to_string())
                    }) {
                    Ok(()) => self.protocol.ack(frame.sequence, kind::RESIZE, None)?,
                    Err(error) => {
                        self.protocol
                            .error(frame.sequence, "GW_LAUNCH", &error, false)?;
                    }
                }
            }
            kind::SIGNAL if self.state == HostState::Running => {
                match decode_signal(&frame.payload)
                    .map_err(|error| error.to_string())
                    .and_then(|request| {
                        self.session
                            .signal(&request)
                            .map_err(|error| error.to_string())
                    }) {
                    Ok(()) => self.protocol.ack(frame.sequence, kind::SIGNAL, None)?,
                    Err(error) => {
                        self.protocol
                            .error(frame.sequence, "GW_LAUNCH", &error, false)?;
                    }
                }
            }
            kind::CLOSE if self.state != HostState::Initial => {
                self.session.cleanup(&mut self.protocol)?;
                self.state = HostState::Closed;
                self.protocol.ack(frame.sequence, kind::CLOSE, None)?;
                return Ok(true);
            }
            _ => {
                self.protocol.error(
                    frame.sequence,
                    "GW_PROTOCOL",
                    "command invalid in current state",
                    false,
                )?;
            }
        }
        Ok(false)
    }

    fn read_control(&mut self) -> Result<bool, Box<dyn std::error::Error>> {
        let mut bytes = [0_u8; RAW_LIMIT];
        let length = unsafe {
            nix::libc::read(
                nix::libc::STDIN_FILENO,
                bytes.as_mut_ptr().cast(),
                bytes.len(),
            )
        };
        if length <= 0 {
            if length < 0 && io::Error::last_os_error().raw_os_error() == Some(nix::libc::EINTR) {
                return Ok(false);
            }
            self.session.cleanup(&mut self.protocol)?;
            return Ok(true);
        }
        self.protocol.append(&bytes[..length as usize]);
        loop {
            let frame = match self.protocol.next_frame() {
                Ok(Some(frame)) => frame,
                Ok(None) => return Ok(false),
                Err(error) => {
                    self.protocol
                        .error(0, "GW_PROTOCOL", &error.to_string(), true)?;
                    self.session.cleanup(&mut self.protocol)?;
                    return Ok(true);
                }
            };
            if self.command(frame)? {
                return Ok(true);
            }
        }
    }

    fn run(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        unsafe {
            nix::libc::signal(nix::libc::SIGPIPE, nix::libc::SIG_IGN);
        }
        loop {
            let mut descriptors = [
                nix::libc::pollfd {
                    fd: nix::libc::STDIN_FILENO,
                    events: nix::libc::POLLIN,
                    revents: 0,
                },
                nix::libc::pollfd {
                    fd: self.session.poll_fd().unwrap_or(-1),
                    events: nix::libc::POLLIN,
                    revents: 0,
                },
            ];
            let count = if descriptors[1].fd >= 0 { 2 } else { 1 };
            let result = unsafe { nix::libc::poll(descriptors.as_mut_ptr(), count, 25) };
            if result < 0 {
                let error = io::Error::last_os_error();
                if error.raw_os_error() != Some(nix::libc::EINTR) {
                    return Err(error.into());
                }
            }

            if descriptors[0].revents & (nix::libc::POLLIN | nix::libc::POLLHUP) != 0
                && self.read_control()?
            {
                return Ok(());
            }
            if count == 2 && descriptors[1].revents & (nix::libc::POLLIN | nix::libc::POLLHUP) != 0
            {
                self.session.read_pty(&mut self.protocol)?;
            }
            self.session.tick(&mut self.protocol)?;
            if self.session.child_exited() && self.state == HostState::Running {
                self.state = HostState::Draining;
            }
            if self.session.child_exited() && self.session.pty_eof() {
                self.state = HostState::Closed;
            }
        }
    }
}

fn main() {
    if let Err(error) = Host::new().run() {
        eprintln!("ghostwright rust pty-host: {error}");
        std::process::exit(2);
    }
}
