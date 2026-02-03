#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

use std::io::{Read, Write};

use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemotePeer {
    pub key: String,
    pub sdp: String,
    #[serde(default)]
    pub candidates: Vec<String>,
}

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
    if let Ok(bytes) = BASE64.decode(text) {
        if let Ok(json) = gunzip_to_string(&bytes) {
            return serde_json::from_str(&json).map_err(|err| err.to_string());
        }
    }
    serde_json::from_str(text).map_err(|err| err.to_string())
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

#[cfg(not(target_arch = "wasm32"))]
mod native_rtc;
#[cfg(target_arch = "wasm32")]
mod web_sys;

#[cfg(not(target_arch = "wasm32"))]
#[allow(unused_imports)]
pub use native_rtc::WebrtcManager;
#[cfg(target_arch = "wasm32")]
#[allow(unused_imports)]
pub use web_sys::WebrtcManager;
