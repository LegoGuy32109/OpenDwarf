//! Integer vector types shared by world config, commands, and snapshots.

use serde::{Deserialize, Serialize};

/// Signed 3D grid coordinate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Vec3i {
    pub x: i32,
    pub y: i32,
    pub z: i32,
}

impl Vec3i {
    pub const ZERO: Self = Self { x: 0, y: 0, z: 0 };

    #[must_use]
    pub const fn new(x: i32, y: i32, z: i32) -> Self {
        Self { x, y, z }
    }

    #[must_use]
    pub const fn add(self, rhs: Self) -> Self {
        Self {
            x: self.x + rhs.x,
            y: self.y + rhs.y,
            z: self.z + rhs.z,
        }
    }
}

/// Unsigned 3D extent (chunk counts, world size in voxels).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Vec3u {
    pub x: u32,
    pub y: u32,
    pub z: u32,
}

impl Vec3u {
    #[must_use]
    pub const fn new(x: u32, y: u32, z: u32) -> Self {
        Self { x, y, z }
    }
}
