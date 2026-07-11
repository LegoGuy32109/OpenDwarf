//! Terrain block types for the v1 world snapshot.

use serde::{Deserialize, Serialize};

/// Solid / empty voxel classification used by the Increment 2 sim.
///
/// Canonical hash encoding uses `0 = Air`, `1 = SolidStone`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum BlockType {
    Air = 0,
    SolidStone = 1,
}
