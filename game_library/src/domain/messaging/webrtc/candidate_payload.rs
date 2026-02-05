use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use bevy::prelude::{info, warn};
use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use std::io::{Read, Write};

use super::RemotePeer;

pub fn compress_remote_peers(peers: &[RemotePeer]) -> String {
    let Ok(json) = serde_json::to_string(peers) else {
        return "[]".to_string();
    };
    match gzip_string(&json) {
        Ok(bytes) => BASE64.encode(bytes),
        Err(_) => json,
    }
}

pub fn decompress_remote_peers(text: &str) -> Result<Vec<RemotePeer>, String> {
    if let Ok(bytes) = BASE64.decode(text)
        && let Ok(json) = gunzip_to_string(&bytes)
    {
        return serde_json::from_str(&json).map_err(|err| err.to_string());
    }
    serde_json::from_str(text).map_err(|err| err.to_string())
}

pub fn compress_and_log_payload(label: &str, payload: &[RemotePeer]) -> String {
    match serde_json::to_string(payload) {
        Ok(json) => info!("{label} SDP payload: {json}"),
        Err(err) => warn!("Failed to serialize {label} payload: {err}"),
    }
    let compressed = compress_remote_peers(payload);
    info!("{label} compressed payload: {compressed}");
    compressed
}

fn gzip_string(text: &str) -> Result<Vec<u8>, String> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
    encoder
        .write_all(text.as_bytes())
        .map_err(|err| err.to_string())?;
    encoder.finish().map_err(|err| err.to_string())
}

fn gunzip_to_string(bytes: &[u8]) -> Result<String, String> {
    let mut decoder = GzDecoder::new(bytes);
    let mut output = String::new();
    decoder
        .read_to_string(&mut output)
        .map_err(|err| err.to_string())?;
    Ok(output)
}
