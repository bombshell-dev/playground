use crate::protocol::{decode_signal, decode_spawn, Protocol, HEADER_SIZE};

fn frame(payload: &[u8]) -> Vec<u8> {
    let mut frame = vec![0; HEADER_SIZE];
    frame[..4].copy_from_slice(b"GWPT");
    frame[4..6].copy_from_slice(&1u16.to_le_bytes());
    frame[6..8].copy_from_slice(&3u16.to_le_bytes());
    frame[8..12].copy_from_slice(&1u32.to_le_bytes());
    frame[16..20].copy_from_slice(&(payload.len() as u32).to_le_bytes());
    frame.extend_from_slice(payload);
    frame
}

#[test]
fn framing_accepts_every_split_and_rejects_repeated_sequence() {
    let bytes = frame(b"hello");
    for split in 1..bytes.len() {
        let mut protocol = Protocol::new();
        protocol.append(&bytes[..split]);
        assert!(protocol.next_frame().unwrap().is_none());
        protocol.append(&bytes[split..]);
        assert_eq!(protocol.next_frame().unwrap().unwrap().payload, b"hello");
        protocol.append(&bytes);
        assert!(protocol.next_frame().is_err());
    }
}

#[test]
fn oversized_write_fails_from_header_alone() {
    let mut bytes = frame(b"");
    bytes[16..20].copy_from_slice(&65537u32.to_le_bytes());
    let mut protocol = Protocol::new();
    protocol.append(&bytes);
    assert!(protocol.next_frame().is_err());
}

#[test]
fn invalid_signal_target_and_trailing_data_fail() {
    for target in ["typo", ""] {
        let mut e = minicbor::Encoder::new(Vec::new());
        e.map(2)
            .unwrap()
            .str("signal")
            .unwrap()
            .str("SIGTERM")
            .unwrap()
            .str("target")
            .unwrap()
            .str(target)
            .unwrap();
        assert!(decode_signal(&e.into_writer()).is_err());
    }
    let mut e = minicbor::Encoder::new(Vec::new());
    e.map(2)
        .unwrap()
        .str("signal")
        .unwrap()
        .str("SIGTERM")
        .unwrap()
        .str("target")
        .unwrap()
        .str("child")
        .unwrap()
        .null()
        .unwrap();
    assert!(decode_signal(&e.into_writer()).is_err());
}

#[test]
fn malformed_spawn_is_rejected() {
    assert!(decode_spawn(&[]).is_err());
    assert!(decode_spawn(&[0xa0]).is_err());
}
