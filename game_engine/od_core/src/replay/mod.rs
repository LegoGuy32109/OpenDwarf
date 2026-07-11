//! Authoritative sim/server replay (`WorldReplay` v1).
//!
//! See `docs/design/sim-replay.md`. This is **not** a client-view tape.
//!
//! `replay_commands_to_snapshot` lives in `od_world` (needs [`WorldSim`]).

mod hash;
mod io;
mod record;

pub use hash::{
    WORLD_SNAPSHOT_ENCODING_VERSION, encode_world_snapshot_canonical, world_state_hash,
};
pub use io::{WorldReplayIoError, load_world_replay, save_world_replay};
pub use record::{WorldReplayRecorder, WorldReplayRecorderOptions};

use serde::{Deserialize, Serialize};

use crate::StateHash;
use crate::world::{WorldCommand, WorldConfig, WorldSnapshot};

/// On-disk / in-memory format version for [`WorldReplay`].
pub const WORLD_REPLAY_FORMAT_VERSION: u32 = 1;

/// Metadata describing how a [`WorldReplay`] was produced.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorldReplayMetadata {
    pub format_version: u32,
    pub name: String,
    pub world_config: WorldConfig,
    pub spawn_default_player: bool,
}

/// Events in a [`WorldReplay`] command log.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum WorldReplayEvent {
    Command {
        tick_before: u64,
        command: WorldCommand,
    },
    Checkpoint {
        snapshot: WorldSnapshot,
        state_hash: StateHash,
    },
}

/// Authoritative sim/server replay document (v1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorldReplay {
    pub metadata: WorldReplayMetadata,
    pub events: Vec<WorldReplayEvent>,
    pub final_snapshot: WorldSnapshot,
    pub final_state_hash: StateHash,
}
