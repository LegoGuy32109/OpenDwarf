//! Synchronous in-process [`WorldSim`] handle (Increment 2).

use od_core::world::{Vec3i, WorldCommand, WorldCommandError, WorldConfig, WorldSnapshot};

use crate::state::WorldState;

/// Headless, Bevy-free world simulator.
#[derive(Debug, Clone)]
pub struct WorldSim {
    state: WorldState,
    primary_entity_id: Option<u64>,
}

impl WorldSim {
    /// Construct a world from `config`.
    ///
    /// When `spawn_default_player` is true, entity id `1` is spawned at
    /// [`WorldState::find_spawn_position`] near the origin (legacy default-player
    /// role; spawn cell uses supported-floor search rather than raw `(0,0,0)`).
    #[must_use]
    pub fn new(config: WorldConfig, spawn_default_player: bool) -> Self {
        let mut state = WorldState::new(config);
        let mut primary_entity_id = None;
        if spawn_default_player {
            let spawn = state
                .find_spawn_position(Vec3i::ZERO)
                .expect("default world should have a spawn position");
            state
                .spawn_entity(1, spawn)
                .expect("default player should spawn in bounds");
            primary_entity_id = Some(1);
        }
        Self {
            state,
            primary_entity_id,
        }
    }

    /// Apply a command against the current tick.
    ///
    /// `MoveEntity` starts interpolation only; use [`Self::step_ticks`] or
    /// [`WorldCommand::AdvanceTicks`] to progress movement. Illegal moves return
    /// [`Err`] without mutating movement state.
    pub fn send_command(&mut self, command: WorldCommand) -> Result<(), WorldCommandError> {
        self.state.apply_command(command).map_err(WorldCommandError::from)
    }

    /// Advance the sim `n` ticks with no wall clock (fast-forward).
    pub fn step_ticks(&mut self, n: u32) {
        self.state.force_advance_ticks(n);
    }

    /// Logic-essential v1 snapshot (no FOV / visibility).
    #[must_use]
    pub fn snapshot(&self) -> WorldSnapshot {
        self.state.snapshot()
    }

    #[must_use]
    pub fn primary_entity_id(&self) -> Option<u64> {
        self.primary_entity_id
    }

    /// Access internal state (tests / tooling).
    #[must_use]
    pub fn state(&self) -> &WorldState {
        &self.state
    }

    /// Mutable access to internal state (tests / tooling).
    pub fn state_mut(&mut self) -> &mut WorldState {
        &mut self.state
    }
}
