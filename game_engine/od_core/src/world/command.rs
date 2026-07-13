//! World commands and apply-time errors.

use serde::{Deserialize, Serialize};

use super::Vec3i;

/// Commands accepted by [`od_world::WorldSim`] and recorded in `WorldReplay`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorldCommand {
    MoveEntity { id: u64, direction: Vec3i },
    AdvanceTicks { count: u32 },
    SetChunkLoaded { chunk: Vec3i, loaded: bool },
}

/// Why a [`WorldCommand::MoveEntity`] was rejected (fail-closed).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveEntityError {
    UnknownEntity,
    MovementInProgress,
    NonAdjacentDirection {
        direction: Vec3i,
    },
    OutOfBounds {
        from: Vec3i,
        to: Vec3i,
    },
    ChunkNotLoaded {
        from: Vec3i,
        to: Vec3i,
        chunk: Vec3i,
    },
    Blocked,
}

impl std::fmt::Display for MoveEntityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownEntity => write!(f, "unknown entity"),
            Self::MovementInProgress => write!(f, "movement already in progress"),
            Self::NonAdjacentDirection { direction } => write!(
                f,
                "non-adjacent direction ({}, {}, {})",
                direction.x, direction.y, direction.z
            ),
            Self::OutOfBounds { from, to } => write!(
                f,
                "out of bounds from ({}, {}, {}) to ({}, {}, {})",
                from.x, from.y, from.z, to.x, to.y, to.z
            ),
            Self::ChunkNotLoaded { from, to, chunk } => write!(
                f,
                "chunk ({}, {}, {}) not loaded for move from ({}, {}, {}) to ({}, {}, {})",
                chunk.x, chunk.y, chunk.z, from.x, from.y, from.z, to.x, to.y, to.z
            ),
            Self::Blocked => write!(f, "terrain collision"),
        }
    }
}

impl std::error::Error for MoveEntityError {}

/// Error returned by [`od_world::WorldSim::send_command`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorldCommandError {
    MoveEntity(MoveEntityError),
    /// A residency command named a chunk outside the world's chunk grid.
    ChunkOutOfBounds { chunk: Vec3i },
}

impl From<MoveEntityError> for WorldCommandError {
    fn from(value: MoveEntityError) -> Self {
        Self::MoveEntity(value)
    }
}

impl std::fmt::Display for WorldCommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MoveEntity(err) => write!(f, "move entity: {err}"),
            Self::ChunkOutOfBounds { chunk } => write!(
                f,
                "chunk ({}, {}, {}) is outside the world chunk grid",
                chunk.x, chunk.y, chunk.z
            ),
        }
    }
}

impl std::error::Error for WorldCommandError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::MoveEntity(err) => Some(err),
            Self::ChunkOutOfBounds { .. } => None,
        }
    }
}
