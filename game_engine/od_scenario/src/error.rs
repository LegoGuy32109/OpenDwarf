//! Stage A / runner errors.

use od_core::world::WorldCommandError;
use od_core::StateHash;

use crate::document::ScenarioStep;

/// Failure while running a Scenario on the native Stage A runner.
#[derive(Debug)]
pub enum ScenarioRunError {
    UnsupportedFormatVersion {
        version: u32,
    },
    /// Session / Shell / Input are in the schema but Stage A rejects them.
    UnsupportedInStageA {
        step_index: usize,
        step: ScenarioStep,
    },
    Command {
        step_index: usize,
        source: WorldCommandError,
    },
    NoPrimaryEntity {
        step_index: usize,
    },
    AssertWorldStateHash {
        step_index: usize,
        expected: StateHash,
        actual: StateHash,
    },
    AssertEntityPosition {
        step_index: usize,
        id: u64,
        expected: od_core::world::Vec3i,
        actual: Option<od_core::world::Vec3i>,
    },
    WaitUntilIdleTimeout {
        step_index: usize,
        entity_id: u64,
        max_ticks: u32,
    },
    ReplayVerify(String),
    UnknownKeymapProfile {
        profile: String,
    },
}

impl std::fmt::Display for ScenarioRunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedFormatVersion { version } => {
                write!(f, "unsupported scenario format_version {version}")
            }
            Self::UnsupportedInStageA { step_index, step } => write!(
                f,
                "stage A rejects Session/Shell/Input at step {step_index}: {step:?}"
            ),
            Self::Command { step_index, source } => {
                write!(f, "command failed at step {step_index}: {source}")
            }
            Self::NoPrimaryEntity { step_index } => {
                write!(f, "no primary entity at step {step_index}")
            }
            Self::AssertWorldStateHash {
                step_index,
                expected,
                actual,
            } => write!(
                f,
                "world_state_hash assert failed at step {step_index}: expected {expected}, got {actual}"
            ),
            Self::AssertEntityPosition {
                step_index,
                id,
                expected,
                actual,
            } => write!(
                f,
                "entity position assert failed at step {step_index}: entity {id} expected {expected:?}, got {actual:?}"
            ),
            Self::WaitUntilIdleTimeout {
                step_index,
                entity_id,
                max_ticks,
            } => write!(
                f,
                "wait_until_idle timed out at step {step_index} for entity {entity_id} after {max_ticks} ticks"
            ),
            Self::ReplayVerify(msg) => write!(f, "replay verify: {msg}"),
            Self::UnknownKeymapProfile { profile } => {
                write!(f, "unknown keymap profile {profile:?}")
            }
        }
    }
}

impl std::error::Error for ScenarioRunError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Command { source, .. } => Some(source),
            _ => None,
        }
    }
}
