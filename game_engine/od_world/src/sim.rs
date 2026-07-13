//! Synchronous in-process [`WorldSim`] handle (Increment 2).

use od_core::world::chunk::CHUNK_VOLUME;
use od_core::world::{
    BlockType, EntitySnapshot, Vec3i, Vec3u, WorldCommand, WorldCommandError, WorldConfig,
    WorldConfigError, WorldSnapshot,
};

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
        Self::try_new(config, spawn_default_player)
            .expect("trusted WorldConfig should use the supported chunk edge")
    }

    /// Fallible constructor for untrusted configs (replay/import paths).
    ///
    /// Rejects any chunk edge other than
    /// [`od_core::world::chunk::SUPPORTED_CHUNK_EDGE`] with a typed error
    /// before constructing fixed-size chunk storage.
    pub fn try_new(
        config: WorldConfig,
        spawn_default_player: bool,
    ) -> Result<Self, WorldConfigError> {
        let mut state = WorldState::try_new(config)?;
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
        Ok(Self {
            state,
            primary_entity_id,
        })
    }

    /// Apply a command against the current tick.
    ///
    /// `MoveEntity` starts interpolation only; use [`Self::step_ticks`] or
    /// [`WorldCommand::AdvanceTicks`] to progress movement. Illegal moves return
    /// [`Err`] without mutating movement state.
    pub fn send_command(&mut self, command: WorldCommand) -> Result<(), WorldCommandError> {
        self.state.apply_command(command)
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

    #[must_use]
    pub fn tick_count(&self) -> u64 {
        self.state.tick_count()
    }

    #[must_use]
    pub fn world_chunks(&self) -> Vec3u {
        self.state.world_chunks()
    }

    #[must_use]
    pub fn chunk_edge(&self) -> u32 {
        self.state.chunk_edge()
    }

    #[must_use]
    pub fn world_bounds(&self) -> (Vec3i, Vec3i) {
        self.state.world_bounds()
    }

    #[must_use]
    pub fn entity_position(&self, id: u64) -> Option<Vec3i> {
        self.state.entity_position(id)
    }

    #[must_use]
    pub fn entity_snapshot(&self, id: u64) -> Option<EntitySnapshot> {
        self.state.entity_snapshot(id)
    }

    /// Terrain revision of one chunk, or [`None`] outside the chunk grid.
    #[must_use]
    pub fn chunk_terrain_revision(&self, chunk: Vec3i) -> Option<u64> {
        self.state.chunk_terrain_revision(chunk)
    }

    /// Copy one chunk's blocks into `out`; see [`WorldState::copy_chunk_blocks`].
    pub fn copy_chunk_blocks(&self, chunk: Vec3i, out: &mut [BlockType; CHUNK_VOLUME]) -> bool {
        self.state.copy_chunk_blocks(chunk, out)
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
