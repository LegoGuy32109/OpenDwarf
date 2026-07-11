//! Gameplay / harness world intents (`WorldIntent`).
//!
//! These are the intent-level cousins of [`super::WorldCommand`]. Scenario
//! (`od_scenario`) wraps them; the live game loop may adopt them later.
//! See `docs/design/scenario.md`.

use serde::{Deserialize, Serialize};

use super::Vec3i;

/// Abstract movement direction (Scenario / intent level — not raw key codes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Dir {
    N,
    S,
    E,
    W,
}

impl Dir {
    /// Unit step on the X/Y plane (Z unchanged). Matches grid adjacency used by
    /// [`super::WorldCommand::MoveEntity`].
    #[must_use]
    pub const fn to_vec3i(self) -> Vec3i {
        match self {
            Self::N => Vec3i::new(0, -1, 0),
            Self::S => Vec3i::new(0, 1, 0),
            Self::E => Vec3i::new(1, 0, 0),
            Self::W => Vec3i::new(-1, 0, 0),
        }
    }
}

/// Intent-level world actions (v1).
///
/// `SetChunkLoaded` is **not** a [`WorldIntent`] — it is an Engine Scenario
/// step that maps to [`super::WorldCommand::SetChunkLoaded`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorldIntent {
    MovePlayer { direction: Dir },
    WaitTicks { ticks: u32 },
}
