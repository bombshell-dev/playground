use minicbor::{Decoder, Encoder};
use std::convert::Infallible;
use std::io::{self, Write};
use thiserror::Error;

pub const VERSION: u16 = 1;
pub const HEADER_SIZE: usize = 20;
pub const CONTROL_LIMIT: usize = 1024 * 1024;
pub const RAW_LIMIT: usize = 65_536;

#[used]
#[no_mangle]
pub static GWPT_PROTOCOL_MARKER: [u8; 24] = *b"GWPT_PROTOCOL_VERSION=1\0";

pub mod kind {
    pub const HELLO: u16 = 0x0001;
    pub const SPAWN: u16 = 0x0002;
    pub const WRITE: u16 = 0x0003;
    pub const RESIZE: u16 = 0x0004;
    pub const SIGNAL: u16 = 0x0005;
    pub const CLOSE: u16 = 0x0006;
    pub const READY: u16 = 0x8001;
    pub const SPAWNED: u16 = 0x8002;
    pub const ACK: u16 = 0x8003;
    pub const ERROR: u16 = 0x80ff;
    pub const OUTPUT: u16 = 0x8100;
    pub const PROCESS_EXIT: u16 = 0x8101;
    pub const PTY_EOF: u16 = 0x8102;
}

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("invalid GWPT frame")]
    InvalidFrame,
    #[error("malformed CBOR payload: {0}")]
    Cbor(#[from] minicbor::decode::Error),
    #[error("unable to encode CBOR payload: {0}")]
    Encode(String),
    #[error("protocol output failed: {0}")]
    Io(#[from] io::Error),
    #[error("invalid control payload: {0}")]
    InvalidPayload(&'static str),
}

impl From<minicbor::encode::Error<Infallible>> for ProtocolError {
    fn from(error: minicbor::encode::Error<Infallible>) -> Self {
        Self::Encode(error.to_string())
    }
}

#[derive(Debug)]
pub struct Frame {
    pub kind: u16,
    pub sequence: u32,
    pub payload: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Viewport {
    pub columns: u16,
    pub rows: u16,
    pub width_pixels: u16,
    pub height_pixels: u16,
}

#[derive(Clone, Copy, Debug)]
pub struct CleanupOptions {
    pub hangup_grace_ms: u32,
    pub terminate_grace_ms: u32,
    pub post_exit_drain_ms: u32,
}

impl Default for CleanupOptions {
    fn default() -> Self {
        Self {
            hangup_grace_ms: 500,
            terminate_grace_ms: 500,
            post_exit_drain_ms: 1000,
        }
    }
}

#[derive(Debug)]
pub struct SpawnRequest {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub environment: Vec<(String, String)>,
    pub viewport: Viewport,
    pub cleanup: CleanupOptions,
}

#[derive(Debug)]
pub struct SignalRequest {
    pub signal: String,
    pub target: String,
}

pub struct Protocol {
    input_sequence: u32,
    output_sequence: u32,
    input: Vec<u8>,
}

impl Protocol {
    pub fn new() -> Self {
        Self {
            input_sequence: 0,
            output_sequence: 1,
            input: Vec::new(),
        }
    }

    pub fn append(&mut self, bytes: &[u8]) {
        self.input.extend_from_slice(bytes);
    }

    pub fn next_frame(&mut self) -> Result<Option<Frame>, ProtocolError> {
        if self.input.len() < HEADER_SIZE {
            return Ok(None);
        }
        let header = &self.input[..HEADER_SIZE];
        let version = u16::from_le_bytes([header[4], header[5]]);
        let kind = u16::from_le_bytes([header[6], header[7]]);
        let sequence = u32::from_le_bytes(header[8..12].try_into().unwrap());
        let correlation = u32::from_le_bytes(header[12..16].try_into().unwrap());
        let payload_len = u32::from_le_bytes(header[16..20].try_into().unwrap()) as usize;
        if &header[..4] != b"GWPT" || version != VERSION || correlation != 0 {
            return Err(ProtocolError::InvalidFrame);
        }
        let limit = if kind == kind::WRITE {
            RAW_LIMIT
        } else {
            CONTROL_LIMIT
        };
        if payload_len > limit {
            return Err(ProtocolError::InvalidFrame);
        }
        if self.input.len() < HEADER_SIZE + payload_len {
            return Ok(None);
        }
        if sequence == 0 || sequence <= self.input_sequence {
            return Err(ProtocolError::InvalidFrame);
        }
        self.input_sequence = sequence;
        let payload = self.input[HEADER_SIZE..HEADER_SIZE + payload_len].to_vec();
        self.input.drain(..HEADER_SIZE + payload_len);
        Ok(Some(Frame {
            kind,
            sequence,
            payload,
        }))
    }

    fn emit(&mut self, kind: u16, correlation: u32, payload: &[u8]) -> Result<(), ProtocolError> {
        let mut header = [0_u8; HEADER_SIZE];
        header[..4].copy_from_slice(b"GWPT");
        header[4..6].copy_from_slice(&VERSION.to_le_bytes());
        header[6..8].copy_from_slice(&kind.to_le_bytes());
        header[8..12].copy_from_slice(&self.output_sequence.to_le_bytes());
        header[12..16].copy_from_slice(&correlation.to_le_bytes());
        header[16..20].copy_from_slice(&(payload.len() as u32).to_le_bytes());
        self.output_sequence = self
            .output_sequence
            .checked_add(1)
            .ok_or(ProtocolError::InvalidFrame)?;
        let mut stdout = io::stdout().lock();
        stdout.write_all(&header)?;
        stdout.write_all(payload)?;
        stdout.flush()?;
        Ok(())
    }

    pub fn ready(&mut self, correlation: u32) -> Result<(), ProtocolError> {
        let mut encoder = Encoder::new(Vec::new());
        encoder
            .map(3)?
            .str("version")?
            .u32(1)?
            .str("platform")?
            .str("posix")?
            .str("hostVersion")?
            .str("0.1.0")?;
        self.emit(kind::READY, correlation, &encoder.into_writer())
    }

    pub fn spawned(&mut self, correlation: u32, pid: i32, pgid: i32) -> Result<(), ProtocolError> {
        let mut encoder = Encoder::new(Vec::new());
        encoder
            .map(4)?
            .str("pid")?
            .i32(pid)?
            .str("ttyName")?
            .str("pty")?
            .str("execPending")?
            .bool(true)?
            .str("processGroupId")?
            .i32(pgid)?;
        self.emit(kind::SPAWNED, correlation, &encoder.into_writer())
    }

    pub fn ack(
        &mut self,
        correlation: u32,
        command_kind: u16,
        bytes_written: Option<usize>,
    ) -> Result<(), ProtocolError> {
        let mut encoder = Encoder::new(Vec::new());
        encoder.map(if bytes_written.is_some() { 2 } else { 1 })?;
        encoder.str("kind")?.u16(command_kind)?;
        if let Some(bytes) = bytes_written {
            encoder.str("bytesWritten")?.u64(bytes as u64)?;
        }
        self.emit(kind::ACK, correlation, &encoder.into_writer())
    }

    pub fn error(
        &mut self,
        correlation: u32,
        code: &str,
        message: &str,
        fatal: bool,
    ) -> Result<(), ProtocolError> {
        let mut encoder = Encoder::new(Vec::new());
        encoder
            .map(3)?
            .str("code")?
            .str(code)?
            .str("fatal")?
            .bool(fatal)?
            .str("message")?
            .str(message)?;
        self.emit(kind::ERROR, correlation, &encoder.into_writer())
    }

    pub fn output(&mut self, bytes: &[u8]) -> Result<(), ProtocolError> {
        self.emit(kind::OUTPUT, 0, bytes)
    }

    pub fn process_exit(
        &mut self,
        exit_code: Option<i32>,
        signal: Option<i32>,
    ) -> Result<(), ProtocolError> {
        let mut encoder = Encoder::new(Vec::new());
        encoder.map(2)?.str("signal")?;
        if let Some(signal) = signal {
            encoder.str(&format!("SIG{signal}"))?;
        } else {
            encoder.null()?;
        }
        encoder.str("exitCode")?;
        if let Some(code) = exit_code {
            encoder.i32(code)?;
        } else {
            encoder.null()?;
        }
        self.emit(kind::PROCESS_EXIT, 0, &encoder.into_writer())
    }

    pub fn pty_eof(&mut self) -> Result<(), ProtocolError> {
        self.emit(kind::PTY_EOF, 0, &[])
    }
}

fn definite_map(decoder: &mut Decoder<'_>) -> Result<u64, ProtocolError> {
    decoder.map()?.ok_or(ProtocolError::InvalidPayload(
        "indefinite maps are not supported",
    ))
}

fn definite_array(decoder: &mut Decoder<'_>) -> Result<u64, ProtocolError> {
    decoder.array()?.ok_or(ProtocolError::InvalidPayload(
        "indefinite arrays are not supported",
    ))
}

fn decode_viewport_from(decoder: &mut Decoder<'_>) -> Result<Viewport, ProtocolError> {
    let mut viewport = Viewport::default();
    for _ in 0..definite_map(decoder)? {
        match decoder.str()? {
            "columns" => viewport.columns = decoder.u16()?,
            "rows" => viewport.rows = decoder.u16()?,
            "widthPixels" => viewport.width_pixels = decoder.u16()?,
            "heightPixels" => viewport.height_pixels = decoder.u16()?,
            _ => decoder.skip()?,
        }
    }
    if viewport.columns == 0
        || viewport.rows == 0
        || viewport.width_pixels == 0
        || viewport.height_pixels == 0
    {
        return Err(ProtocolError::InvalidPayload("incomplete viewport"));
    }
    Ok(viewport)
}

fn decode_cleanup(decoder: &mut Decoder<'_>) -> Result<CleanupOptions, ProtocolError> {
    let mut cleanup = CleanupOptions::default();
    for _ in 0..definite_map(decoder)? {
        match decoder.str()? {
            "hangupGraceMs" => cleanup.hangup_grace_ms = decoder.u32()?,
            "terminateGraceMs" => cleanup.terminate_grace_ms = decoder.u32()?,
            "postExitDrainMs" => cleanup.post_exit_drain_ms = decoder.u32()?,
            _ => decoder.skip()?,
        }
    }
    Ok(cleanup)
}

pub fn decode_spawn(bytes: &[u8]) -> Result<SpawnRequest, ProtocolError> {
    let mut decoder = Decoder::new(bytes);
    let mut command = None;
    let mut args = Vec::new();
    let mut cwd = None;
    let mut environment = Vec::new();
    let mut viewport = None;
    let mut cleanup = CleanupOptions::default();
    for _ in 0..definite_map(&mut decoder)? {
        match decoder.str()? {
            "command" => command = Some(decoder.str()?.to_owned()),
            "args" => {
                for _ in 0..definite_array(&mut decoder)? {
                    args.push(decoder.str()?.to_owned());
                }
            }
            "cwd" => {
                if decoder.datatype()? == minicbor::data::Type::Null {
                    decoder.null()?;
                } else {
                    cwd = Some(decoder.str()?.to_owned());
                }
            }
            "env" => {
                for _ in 0..definite_map(&mut decoder)? {
                    environment.push((decoder.str()?.to_owned(), decoder.str()?.to_owned()));
                }
            }
            "viewport" => viewport = Some(decode_viewport_from(&mut decoder)?),
            "cleanup" => cleanup = decode_cleanup(&mut decoder)?,
            _ => decoder.skip()?,
        }
    }
    let command = command.ok_or(ProtocolError::InvalidPayload("missing command"))?;
    if command.is_empty() {
        return Err(ProtocolError::InvalidPayload("empty command"));
    }
    Ok(SpawnRequest {
        command,
        args,
        cwd,
        environment,
        viewport: viewport.ok_or(ProtocolError::InvalidPayload("missing viewport"))?,
        cleanup,
    })
}

pub fn decode_viewport(bytes: &[u8]) -> Result<Viewport, ProtocolError> {
    decode_viewport_from(&mut Decoder::new(bytes))
}

pub fn decode_signal(bytes: &[u8]) -> Result<SignalRequest, ProtocolError> {
    let mut decoder = Decoder::new(bytes);
    let mut signal = None;
    let mut target = None;
    for _ in 0..definite_map(&mut decoder)? {
        match decoder.str()? {
            "signal" => signal = Some(decoder.str()?.to_owned()),
            "target" => target = Some(decoder.str()?.to_owned()),
            _ => decoder.skip()?,
        }
    }
    Ok(SignalRequest {
        signal: signal.ok_or(ProtocolError::InvalidPayload("missing signal"))?,
        target: target.ok_or(ProtocolError::InvalidPayload("missing target"))?,
    })
}
