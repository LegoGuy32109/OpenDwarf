//! Fluent Scenario builder (Rust-primary authoring).

use od_core::session::SessionIntent;
use od_core::world::{Dir, Vec3i, WorldConfig, WorldIntent};
use od_core::StateHash;

use crate::document::{
    AssertStep, EngineAction, InputAction, Scenario, ScenarioStep, ShellAction,
};

/// Type-checked Scenario authoring helper.
#[derive(Debug, Clone)]
pub struct ScenarioBuilder {
    scenario: Scenario,
}

impl ScenarioBuilder {
    #[must_use]
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            scenario: Scenario::new(name),
        }
    }

    #[must_use]
    pub fn world_config(mut self, config: WorldConfig) -> Self {
        self.scenario.world_config = config;
        self
    }

    #[must_use]
    pub fn spawn_default_player(mut self, spawn: bool) -> Self {
        self.scenario.spawn_default_player = spawn;
        self
    }

    #[must_use]
    pub fn keymap_profile(mut self, profile: impl Into<String>) -> Self {
        self.scenario.keymap_profile = profile.into();
        self
    }

    #[must_use]
    pub fn step(mut self, step: ScenarioStep) -> Self {
        self.scenario.steps.push(step);
        self
    }

    #[must_use]
    pub fn world_intent(self, intent: WorldIntent) -> Self {
        self.step(ScenarioStep::World { intent })
    }

    #[must_use]
    pub fn move_player(self, direction: Dir) -> Self {
        self.world_intent(WorldIntent::MovePlayer { direction })
    }

    #[must_use]
    pub fn wait_ticks(self, ticks: u32) -> Self {
        self.world_intent(WorldIntent::WaitTicks { ticks })
    }

    #[must_use]
    pub fn move_player_exact(self, direction: Dir, max_ticks: u32) -> Self {
        self.step(ScenarioStep::MovePlayerExact {
            direction,
            max_ticks,
        })
    }

    #[must_use]
    pub fn wait_until_idle(self, max_ticks: u32) -> Self {
        self.step(ScenarioStep::WaitUntilIdle { max_ticks })
    }

    #[must_use]
    pub fn engine_set_chunk_loaded(self, chunk: Vec3i, loaded: bool) -> Self {
        self.step(ScenarioStep::Engine {
            action: EngineAction::SetChunkLoaded { chunk, loaded },
        })
    }

    #[must_use]
    pub fn assert_world_state_hash(self, expected: StateHash) -> Self {
        self.step(ScenarioStep::Assert {
            assertion: AssertStep::WorldStateHashEq { expected },
        })
    }

    #[must_use]
    pub fn assert_entity_position(self, id: u64, position: Vec3i) -> Self {
        self.step(ScenarioStep::Assert {
            assertion: AssertStep::EntityPosition { id, position },
        })
    }

    #[must_use]
    pub fn record_checkpoint(self, name: impl Into<String>) -> Self {
        self.step(ScenarioStep::RecordCheckpoint { name: name.into() })
    }

    #[must_use]
    pub fn session(self, intent: SessionIntent) -> Self {
        self.step(ScenarioStep::Session { intent })
    }

    #[must_use]
    pub fn shell(self, action: ShellAction) -> Self {
        self.step(ScenarioStep::Shell { action })
    }

    #[must_use]
    pub fn input(self, action: InputAction) -> Self {
        self.step(ScenarioStep::Input { action })
    }

    #[must_use]
    pub fn build(self) -> Scenario {
        self.scenario
    }
}
