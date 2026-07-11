//! World and terrain configuration shared by sim and replay metadata.

use serde::{Deserialize, Serialize};

use super::Vec3u;

/// Default voxels along each chunk edge.
pub const DEFAULT_CHUNK_EDGE: u32 = 16;
/// Default world extent in chunks (`1×1×1`).
pub const DEFAULT_WORLD_CHUNKS: Vec3u = Vec3u { x: 1, y: 1, z: 1 };
/// Default discrete ticks to traverse one tile (axis-aligned).
pub const DEFAULT_MOVEMENT_TICKS_PER_TILE: u32 = 10;

/// Cave / noise parameters for procedural terrain.
///
/// Noise is f64 Perlin-like (legacy port). Native↔wasm bit identity is not
/// guaranteed; see `docs/design/sim-replay.md` §6.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TerrainConfig {
    pub seed: String,
    pub cave_frequency_xy: f64,
    pub cave_frequency_z: f64,
    pub cave_threshold: f64,
    pub cave_octaves: u32,
    pub cave_persistence: f64,
    pub cave_lacunarity: f64,
}

impl Default for TerrainConfig {
    fn default() -> Self {
        Self {
            seed: "opendwarf".to_string(),
            cave_frequency_xy: 0.15,
            cave_frequency_z: 0.01,
            cave_threshold: 0.11,
            cave_octaves: 4,
            cave_persistence: 0.58,
            cave_lacunarity: 2.0,
        }
    }
}

/// Authoritative world construction parameters.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorldConfig {
    pub chunk_edge: u32,
    pub world_chunks: Vec3u,
    pub movement_ticks_per_tile: u32,
    pub terrain: TerrainConfig,
}

impl Default for WorldConfig {
    fn default() -> Self {
        Self {
            chunk_edge: DEFAULT_CHUNK_EDGE,
            world_chunks: DEFAULT_WORLD_CHUNKS,
            movement_ticks_per_tile: DEFAULT_MOVEMENT_TICKS_PER_TILE,
            terrain: TerrainConfig::default(),
        }
    }
}
