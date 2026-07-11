//! Scenario document schema (serde JSON + Rust).

use serde::{Deserialize, Serialize};

use od_core::session::SessionIntent;
use od_core::world::{Dir, Vec3i, WorldConfig, WorldIntent};
use od_core::StateHash;

/// On-disk / in-memory Scenario format version.
pub const SCENARIO_FORMAT_VERSION: u32 = 1;

/// Portable Scenario document (author path).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Scenario {
    pub format_version: u32,
    pub name: String,
    pub world_config: WorldConfig,
    pub spawn_default_player: bool,
    /// Keymap profile id for browser / Shell lowering (default `"esdf"`).
    pub keymap_profile: String,
    pub steps: Vec<ScenarioStep>,
}

impl Scenario {
    #[must_use]
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            format_version: SCENARIO_FORMAT_VERSION,
            name: name.into(),
            world_config: WorldConfig::default(),
            spawn_default_player: true,
            keymap_profile: crate::DEFAULT_KEYMAP_PROFILE.to_string(),
            steps: Vec::new(),
        }
    }
}

/// One step in a [`Scenario`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ScenarioStep {
    Session {
        intent: SessionIntent,
    },
    World {
        intent: WorldIntent,
    },
    /// Sugar: `MovePlayer` then wait until idle (expands into recorded commands).
    MovePlayerExact {
        direction: Dir,
        max_ticks: u32,
    },
    /// Sugar: advance until primary entity is idle.
    WaitUntilIdle {
        max_ticks: u32,
    },
    Engine {
        action: EngineAction,
    },
    Assert {
        assertion: AssertStep,
    },
    Shell {
        action: ShellAction,
    },
    Input {
        action: InputAction,
    },
    RecordCheckpoint {
        name: String,
    },
}

/// Native-only Engine escapes (not `WorldIntent`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EngineAction {
    SetChunkLoaded { chunk: Vec3i, loaded: bool },
}

/// Allowlisted asserts (Stage A: world-core).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AssertStep {
    WorldStateHashEq { expected: StateHash },
    EntityPosition { id: u64, position: Vec3i },
}

/// Shell semantic sugar (lowers to keys in Stage B).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ShellAction {
    OpenShell,
    OpenSettings,
    CloseShell,
}

/// One-off input (Stage B lowering; Stage A reject).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InputAction {
    KeyDown { code: String },
    KeyUp { code: String },
    Press { code: String },
    TypeText { text: String },
}

/// Serialize a Scenario to pretty JSON (+ trailing newline).
///
/// # Errors
///
/// Returns a [`serde_json::Error`] if serialization fails.
pub fn scenario_to_json(scenario: &Scenario) -> Result<String, serde_json::Error> {
    let mut raw = serde_json::to_string_pretty(scenario)?;
    raw.push('\n');
    Ok(raw)
}

/// Parse a Scenario from JSON.
///
/// # Errors
///
/// Returns a [`serde_json::Error`] if the document is invalid JSON or schema.
pub fn scenario_from_json(raw: &str) -> Result<Scenario, serde_json::Error> {
    serde_json::from_str(raw)
}
