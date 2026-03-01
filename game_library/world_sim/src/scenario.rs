use std::fmt::{Display, Formatter};

use crate::bevy_app::{WorldSimApp, WorldSimulationPlugin};
use crate::replay::{ReplayFile, ReplayRecorder, ReplayRecorderOptions};
use crate::world_api::{Vec3i, WorldCommand, WorldSnapshot};
use crate::world_core::WorldConfig;

#[derive(Debug, Clone)]
pub enum ScenarioStep {
    MoveEntity { id: u64, direction: Vec3i },
    Tick { count: u32 },
    SetChunkLoaded { chunk: Vec3i, loaded: bool },
    AssertEntityPosition { id: u64, expected: Vec3i },
    AssertEntityFacingLeft { id: u64, expected: bool },
    AssertEntityProne { id: u64, expected: bool },
    AssertTick { expected: u64 },
}

#[derive(Debug, Clone)]
pub struct Scenario {
    pub name: String,
    pub world_config: WorldConfig,
    pub spawn_default_player: bool,
    pub steps: Vec<ScenarioStep>,
}

pub struct ScenarioBuilder {
    scenario: Scenario,
}

impl ScenarioBuilder {
    #[must_use]
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            scenario: Scenario {
                name: name.into(),
                world_config: WorldConfig::default(),
                spawn_default_player: true,
                steps: Vec::new(),
            },
        }
    }

    #[must_use]
    pub fn world_config(mut self, world_config: WorldConfig) -> Self {
        self.scenario.world_config = world_config;
        self
    }

    #[must_use]
    pub fn spawn_default_player(mut self, spawn_default_player: bool) -> Self {
        self.scenario.spawn_default_player = spawn_default_player;
        self
    }

    #[must_use]
    pub fn move_entity(mut self, id: u64, direction: Vec3i) -> Self {
        self.scenario
            .steps
            .push(ScenarioStep::MoveEntity { id, direction });
        self
    }

    #[must_use]
    pub fn tick(mut self, count: u32) -> Self {
        self.scenario.steps.push(ScenarioStep::Tick { count });
        self
    }

    #[must_use]
    pub fn set_chunk_loaded(mut self, chunk: Vec3i, loaded: bool) -> Self {
        self.scenario
            .steps
            .push(ScenarioStep::SetChunkLoaded { chunk, loaded });
        self
    }

    #[must_use]
    pub fn assert_entity_position(mut self, id: u64, expected: Vec3i) -> Self {
        self.scenario
            .steps
            .push(ScenarioStep::AssertEntityPosition { id, expected });
        self
    }

    #[must_use]
    pub fn assert_entity_facing_left(mut self, id: u64, expected: bool) -> Self {
        self.scenario
            .steps
            .push(ScenarioStep::AssertEntityFacingLeft { id, expected });
        self
    }

    #[must_use]
    pub fn assert_entity_prone(mut self, id: u64, expected: bool) -> Self {
        self.scenario
            .steps
            .push(ScenarioStep::AssertEntityProne { id, expected });
        self
    }

    #[must_use]
    pub fn assert_tick(mut self, expected: u64) -> Self {
        self.scenario.steps.push(ScenarioStep::AssertTick { expected });
        self
    }

    #[must_use]
    pub fn build(self) -> Scenario {
        self.scenario
    }
}

#[derive(Debug, Clone)]
pub struct ScenarioRunOptions {
    pub record_replay: bool,
    pub replay: ReplayRecorderOptions,
}

impl Default for ScenarioRunOptions {
    fn default() -> Self {
        Self {
            record_replay: true,
            replay: ReplayRecorderOptions::default(),
        }
    }
}

#[derive(Debug)]
pub struct ScenarioRunResult {
    pub final_snapshot: WorldSnapshot,
    pub replay: Option<ReplayFile>,
}

#[derive(Debug)]
pub enum ScenarioError {
    CommandEnqueue(String),
    AssertionFailed(String),
}

impl Display for ScenarioError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CommandEnqueue(err) => write!(f, "Failed to enqueue command: {err}"),
            Self::AssertionFailed(err) => write!(f, "Scenario assertion failed: {err}"),
        }
    }
}

impl std::error::Error for ScenarioError {}

pub fn run_scenario(
    scenario: &Scenario,
    options: ScenarioRunOptions,
) -> Result<ScenarioRunResult, ScenarioError> {
    let mut app = WorldSimApp::new(WorldSimulationPlugin {
        settings: crate::bevy_app::WorldSimSettings {
            config: scenario.world_config.clone(),
            spawn_default_player: scenario.spawn_default_player,
        },
    });
    let mut replay = options.record_replay.then(|| {
        let initial_snapshot = app.snapshot();
        let initial_updates = app.drain_updates();
        ReplayRecorder::new(
            scenario.name.clone(),
            scenario.world_config.clone(),
            scenario.spawn_default_player,
            options.replay.clone(),
            initial_snapshot,
            initial_updates,
        )
    });

    for step in &scenario.steps {
        match step {
            ScenarioStep::MoveEntity { id, direction } => {
                let command = WorldCommand::MoveEntity {
                    id: *id,
                    direction: *direction,
                };
                let tick_before = app.snapshot().tick;
                app.send_command(command.clone())
                    .map_err(ScenarioError::CommandEnqueue)?;
                app.step_ticks(1);
                if let Some(recorder) = &mut replay {
                    recorder.record_command(tick_before, command);
                    recorder.record_updates(app.drain_updates());
                    recorder.maybe_checkpoint(&app.snapshot());
                }
            }
            ScenarioStep::Tick { count } => {
                let command = WorldCommand::AdvanceTicks { count: *count };
                let tick_before = app.snapshot().tick;
                app.send_command(command.clone())
                    .map_err(ScenarioError::CommandEnqueue)?;
                app.step_ticks(1);
                if let Some(recorder) = &mut replay {
                    recorder.record_command(tick_before, command);
                    recorder.record_updates(app.drain_updates());
                    recorder.maybe_checkpoint(&app.snapshot());
                }
            }
            ScenarioStep::SetChunkLoaded { chunk, loaded } => {
                let command = WorldCommand::SetChunkLoaded {
                    chunk: *chunk,
                    loaded: *loaded,
                };
                let tick_before = app.snapshot().tick;
                app.send_command(command.clone())
                    .map_err(ScenarioError::CommandEnqueue)?;
                app.step_ticks(1);
                if let Some(recorder) = &mut replay {
                    recorder.record_command(tick_before, command);
                    recorder.record_updates(app.drain_updates());
                    recorder.maybe_checkpoint(&app.snapshot());
                }
            }
            ScenarioStep::AssertEntityPosition { id, expected } => {
                let snapshot = app.snapshot();
                let entity = snapshot
                    .entities
                    .iter()
                    .find(|entity| entity.id == *id)
                    .ok_or_else(|| {
                        ScenarioError::AssertionFailed(format!(
                            "expected entity {id} to exist in snapshot"
                        ))
                    })?;
                if entity.position != *expected {
                    return Err(ScenarioError::AssertionFailed(format!(
                        "entity {id} position mismatch, expected {:?} got {:?}",
                        expected, entity.position
                    )));
                }
            }
            ScenarioStep::AssertTick { expected } => {
                let snapshot = app.snapshot();
                if snapshot.tick != *expected {
                    return Err(ScenarioError::AssertionFailed(format!(
                        "tick mismatch, expected {expected} got {}",
                        snapshot.tick
                    )));
                }
            }
            ScenarioStep::AssertEntityFacingLeft { id, expected } => {
                let snapshot = app.snapshot();
                let entity = snapshot
                    .entities
                    .iter()
                    .find(|entity| entity.id == *id)
                    .ok_or_else(|| {
                        ScenarioError::AssertionFailed(format!(
                            "expected entity {id} to exist in snapshot"
                        ))
                    })?;
                if entity.facing_left != *expected {
                    return Err(ScenarioError::AssertionFailed(format!(
                        "entity {id} facing_left mismatch, expected {:?} got {:?}",
                        expected, entity.facing_left
                    )));
                }
            }
            ScenarioStep::AssertEntityProne { id, expected } => {
                let snapshot = app.snapshot();
                let entity = snapshot
                    .entities
                    .iter()
                    .find(|entity| entity.id == *id)
                    .ok_or_else(|| {
                        ScenarioError::AssertionFailed(format!(
                            "expected entity {id} to exist in snapshot"
                        ))
                    })?;
                if entity.is_prone != *expected {
                    return Err(ScenarioError::AssertionFailed(format!(
                        "entity {id} is_prone mismatch, expected {:?} got {:?}",
                        expected, entity.is_prone
                    )));
                }
            }
        }
    }

    let final_snapshot = app.snapshot();
    let replay = replay.map(|recorder| recorder.finish(final_snapshot.clone()));
    Ok(ScenarioRunResult {
        final_snapshot,
        replay,
    })
}
