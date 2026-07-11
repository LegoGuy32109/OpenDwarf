//! bincode save/load for [`WorldReplay`].

use std::fs;
use std::path::Path;

use bincode::config::standard;
use bincode::serde::{decode_from_slice, encode_to_vec};

use crate::replay::{WorldReplay, WORLD_REPLAY_FORMAT_VERSION};

/// Errors from reading or writing a [`WorldReplay`].
#[derive(Debug)]
pub enum WorldReplayIoError {
    Io(std::io::Error),
    Bincode(String),
    UnsupportedVersion { found: u32 },
}

impl std::fmt::Display for WorldReplayIoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(err) => write!(f, "io: {err}"),
            Self::Bincode(err) => write!(f, "bincode: {err}"),
            Self::UnsupportedVersion { found } => write!(
                f,
                "unsupported WorldReplay format_version {found} (expected {WORLD_REPLAY_FORMAT_VERSION})"
            ),
        }
    }
}

impl std::error::Error for WorldReplayIoError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(err) => Some(err),
            Self::Bincode(_) | Self::UnsupportedVersion { .. } => None,
        }
    }
}

impl From<std::io::Error> for WorldReplayIoError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

/// Write a [`WorldReplay`] to disk (bincode, standard config).
pub fn save_world_replay(
    path: impl AsRef<Path>,
    replay: &WorldReplay,
) -> Result<(), WorldReplayIoError> {
    if replay.metadata.format_version != WORLD_REPLAY_FORMAT_VERSION {
        return Err(WorldReplayIoError::UnsupportedVersion {
            found: replay.metadata.format_version,
        });
    }
    let bytes = encode_to_vec(replay, standard()).map_err(|err| {
        WorldReplayIoError::Bincode(err.to_string())
    })?;
    fs::write(path, bytes)?;
    Ok(())
}

/// Load a [`WorldReplay`] from disk; rejects non-v1 `format_version`.
pub fn load_world_replay(path: impl AsRef<Path>) -> Result<WorldReplay, WorldReplayIoError> {
    let bytes = fs::read(path)?;
    let (replay, _): (WorldReplay, usize) =
        decode_from_slice(&bytes, standard()).map_err(|err| {
            WorldReplayIoError::Bincode(err.to_string())
        })?;
    if replay.metadata.format_version != WORLD_REPLAY_FORMAT_VERSION {
        return Err(WorldReplayIoError::UnsupportedVersion {
            found: replay.metadata.format_version,
        });
    }
    Ok(replay)
}
