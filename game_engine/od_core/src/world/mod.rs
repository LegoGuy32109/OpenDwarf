//! Shared world wire types for `od_world` and `WorldReplay`.
//!
//! These types form the Increment 2 command / snapshot schema. See
//! `docs/design/od-world.md` and `docs/design/sim-replay.md`.

mod block;
pub mod chunk;
mod command;
mod config;
mod intent;
mod snapshot;
mod vec;

pub use block::BlockType;
pub use chunk::{
    CHUNK_AREA, CHUNK_VOLUME, SUPPORTED_CHUNK_EDGE, VISIBILITY_WORDS, chunk_coord_to_index,
    chunk_index_to_coord, chunk_min_world_position, world_position_to_chunk_voxel,
};
pub use command::{MoveEntityError, WorldCommand, WorldCommandError};
pub use config::{
    DEFAULT_CHUNK_EDGE, DEFAULT_MOVEMENT_TICKS_PER_TILE, DEFAULT_WORLD_CHUNKS, TerrainConfig,
    WorldConfig, WorldConfigError,
};
pub use intent::{Dir, WorldIntent};
pub use snapshot::{EntityMovementSnapshot, EntitySnapshot, WorldSnapshot};
pub use vec::{Vec3i, Vec3u};
