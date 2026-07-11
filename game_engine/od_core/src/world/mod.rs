//! Shared world wire types for `od_world` and `WorldReplay`.
//!
//! These types form the Increment 2 command / snapshot schema. See
//! `docs/design/od-world.md` and `docs/design/sim-replay.md`.

mod block;
mod command;
mod config;
mod snapshot;
mod vec;

pub use block::BlockType;
pub use command::{MoveEntityError, WorldCommand, WorldCommandError};
pub use config::{
    DEFAULT_CHUNK_EDGE, DEFAULT_MOVEMENT_TICKS_PER_TILE, DEFAULT_WORLD_CHUNKS, TerrainConfig,
    WorldConfig,
};
pub use snapshot::{EntityMovementSnapshot, EntitySnapshot, WorldSnapshot};
pub use vec::{Vec3i, Vec3u};
