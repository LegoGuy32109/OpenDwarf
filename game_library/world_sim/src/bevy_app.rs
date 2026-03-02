use bevy_app::{App, Plugin, Update};
use bevy_ecs::prelude::Resource;
use bevy_ecs::system::ResMut;

use crate::world_api::{Vec3i, WorldCommand, WorldSnapshot, WorldUpdate};
use crate::world_core::{MoveEntityError, WorldConfig, WorldState};

#[derive(Resource, Debug, Clone)]
pub struct WorldSimSettings {
    pub config: WorldConfig,
    pub spawn_default_player: bool,
}

impl Default for WorldSimSettings {
    fn default() -> Self {
        Self {
            config: WorldConfig::default(),
            spawn_default_player: true,
        }
    }
}

#[derive(Resource, Debug, Default)]
pub struct WorldCommandQueue(pub Vec<WorldCommand>);

impl WorldCommandQueue {
    pub fn push(&mut self, command: WorldCommand) {
        self.0.push(command);
    }

    pub fn move_entity(&mut self, id: u64, direction: Vec3i) {
        self.push(WorldCommand::MoveEntity { id, direction });
    }

    pub fn advance_ticks(&mut self, count: u32) {
        self.push(WorldCommand::AdvanceTicks { count });
    }

    pub fn set_chunk_loaded(&mut self, chunk: Vec3i, loaded: bool) {
        self.push(WorldCommand::SetChunkLoaded { chunk, loaded });
    }

    #[must_use]
    pub fn drain(&mut self) -> Vec<WorldCommand> {
        std::mem::take(&mut self.0)
    }
}

#[derive(Resource, Debug, Default)]
pub struct WorldUpdateBuffer(pub Vec<WorldUpdate>);

impl WorldUpdateBuffer {
    #[must_use]
    pub fn drain(&mut self) -> Vec<WorldUpdate> {
        std::mem::take(&mut self.0)
    }
}

#[derive(Resource, Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorldTickControl {
    Run,
    Paused,
    Step(u32),
}

impl Default for WorldTickControl {
    fn default() -> Self {
        Self::Run
    }
}

#[derive(Resource)]
pub struct WorldSimState {
    pub world: WorldState,
}

#[derive(Resource, Debug, Clone)]
pub struct WorldView(pub WorldSnapshot);

impl WorldView {
    #[must_use]
    pub fn snapshot(&self) -> &WorldSnapshot {
        &self.0
    }
}

#[derive(Resource, Debug, Clone, Default)]
pub struct WorldSimDiagnostics {
    pub commands_processed: u64,
    pub rejected_unknown_entity: u64,
    pub rejected_out_of_bounds: u64,
    pub rejected_chunk_not_loaded: u64,
    pub loaded_chunk_count: usize,
    pub last_center_chunk_load_requested: Option<Vec3i>,
}

#[derive(Resource, Debug, Clone, Copy, Default)]
pub struct PrimarySimulationEntityId(pub Option<u64>);

pub struct WorldSimulationPlugin {
    pub settings: WorldSimSettings,
}

impl Default for WorldSimulationPlugin {
    fn default() -> Self {
        Self {
            settings: WorldSimSettings::default(),
        }
    }
}

impl Plugin for WorldSimulationPlugin {
    fn build(&self, app: &mut App) {
        let mut world = WorldState::new(self.settings.config.clone());
        let mut primary_entity = None;
        if self.settings.spawn_default_player {
            primary_entity = Some(
                world
                    .spawn_entity_auto(Vec3i::ZERO)
                    .expect("default player should spawn in bounds"),
            );
        }

        app.insert_resource(WorldSimState { world })
            .insert_resource(PrimarySimulationEntityId(primary_entity))
            .insert_resource(WorldSimDiagnostics::default())
            .init_resource::<WorldCommandQueue>()
            .init_resource::<WorldTickControl>()
            .init_resource::<WorldUpdateBuffer>()
            .add_systems(Update, run_simulation_tick);

        let initial_snapshot = app.world().resource::<WorldSimState>().world.snapshot();
        app.insert_resource(WorldView(initial_snapshot.clone()));
        let loaded_chunk_count = app
            .world()
            .resource::<WorldSimState>()
            .world
            .loaded_chunk_count();
        {
            let mut diagnostics = app.world_mut().resource_mut::<WorldSimDiagnostics>();
            diagnostics.loaded_chunk_count = loaded_chunk_count;
        }
        let mut updates = app.world_mut().resource_mut::<WorldUpdateBuffer>();
        updates.0.push(WorldUpdate::Snapshot(initial_snapshot));
    }
}

fn run_simulation_tick(
    mut tick_control: ResMut<WorldTickControl>,
    mut sim_state: ResMut<WorldSimState>,
    mut command_queue: ResMut<WorldCommandQueue>,
    mut updates: ResMut<WorldUpdateBuffer>,
    mut world_view: ResMut<WorldView>,
    mut diagnostics: ResMut<WorldSimDiagnostics>,
) {
    let should_tick = match *tick_control {
        WorldTickControl::Run => true,
        WorldTickControl::Paused => false,
        WorldTickControl::Step(remaining) => {
            if remaining == 0 {
                false
            } else {
                *tick_control = WorldTickControl::Step(remaining - 1);
                true
            }
        }
    };
    if !should_tick {
        return;
    }

    let queued = command_queue.drain();
    let mut advanced_time_explicitly = false;
    for command in queued {
        diagnostics.commands_processed = diagnostics.commands_processed.saturating_add(1);
        match command {
            WorldCommand::MoveEntity { id, direction } => {
                match sim_state.world.start_entity_move_with_reason(id, direction) {
                    Ok(()) => {}
                    Err(MoveEntityError::UnknownEntity) => {
                        diagnostics.rejected_unknown_entity =
                            diagnostics.rejected_unknown_entity.saturating_add(1);
                        eprintln!("World command rejected: unknown entity id={id}");
                    }
                    Err(MoveEntityError::MovementInProgress) => {
                        eprintln!("World command rejected: movement already in progress id={id}");
                    }
                    Err(MoveEntityError::NonAdjacentDirection { direction }) => {
                        eprintln!(
                            "World command rejected: non-adjacent move id={id} dir=({}, {}, {})",
                            direction.x, direction.y, direction.z
                        );
                    }
                    Err(MoveEntityError::OutOfBounds { from, to }) => {
                        diagnostics.rejected_out_of_bounds =
                            diagnostics.rejected_out_of_bounds.saturating_add(1);
                        let (min, max) = sim_state.world.world_bounds();
                        eprintln!(
                            "World command rejected: out of bounds id={id} from=({}, {}, {}) to=({}, {}, {}), bounds min=({}, {}, {}) max=({}, {}, {})",
                            from.x,
                            from.y,
                            from.z,
                            to.x,
                            to.y,
                            to.z,
                            min.x,
                            min.y,
                            min.z,
                            max.x,
                            max.y,
                            max.z,
                        );
                    }
                    Err(MoveEntityError::ChunkNotLoaded { from, to, chunk }) => {
                        diagnostics.rejected_chunk_not_loaded =
                            diagnostics.rejected_chunk_not_loaded.saturating_add(1);
                        eprintln!(
                            "World command rejected: chunk not loaded id={id} from=({}, {}, {}) to=({}, {}, {}), chunk=({}, {}, {})",
                            from.x,
                            from.y,
                            from.z,
                            to.x,
                            to.y,
                            to.z,
                            chunk.x,
                            chunk.y,
                            chunk.z,
                        );
                    }
                }
            }
            WorldCommand::AdvanceTicks { count } => {
                advanced_time_explicitly = true;
                for delta in sim_state.world.force_advance_ticks(count) {
                    updates.0.push(WorldUpdate::Delta(delta));
                }
            }
            WorldCommand::SetChunkLoaded { chunk, loaded } => {
                if loaded {
                    diagnostics.last_center_chunk_load_requested = Some(chunk);
                }
                if let Some(delta) = sim_state
                    .world
                    .apply_command(WorldCommand::SetChunkLoaded { chunk, loaded })
                {
                    updates.0.push(WorldUpdate::Delta(delta));
                }
            }
        }
    }
    if !advanced_time_explicitly
        && let Some(delta) = sim_state.world.advance_active_movements_one_tick()
    {
        updates.0.push(WorldUpdate::Delta(delta));
    }

    diagnostics.loaded_chunk_count = sim_state.world.loaded_chunk_count();
    world_view.0 = sim_state.world.snapshot();
}

pub struct WorldSimApp {
    app: App,
}

impl WorldSimApp {
    #[must_use]
    pub fn new(plugin: WorldSimulationPlugin) -> Self {
        let mut app = App::new();
        app.add_plugins(plugin);
        Self { app }
    }

    pub fn send_command(&mut self, command: WorldCommand) -> Result<(), String> {
        let mut command_queue = self.app.world_mut().resource_mut::<WorldCommandQueue>();
        command_queue.push(command);
        Ok(())
    }

    pub fn move_entity(&mut self, id: u64, direction: Vec3i) -> Result<(), String> {
        self.send_command(WorldCommand::MoveEntity { id, direction })
    }

    pub fn set_chunk_loaded(&mut self, chunk: Vec3i, loaded: bool) -> Result<(), String> {
        self.send_command(WorldCommand::SetChunkLoaded { chunk, loaded })
    }

    pub fn step_ticks(&mut self, count: u32) {
        let count = count.max(1);
        {
            let mut tick_control = self.app.world_mut().resource_mut::<WorldTickControl>();
            *tick_control = WorldTickControl::Step(count);
        }
        for _ in 0..count {
            self.app.update();
        }
    }

    pub fn run_updates(&mut self, count: u32) {
        for _ in 0..count.max(1) {
            self.app.update();
        }
    }

    #[must_use]
    pub fn drain_updates(&mut self) -> Vec<WorldUpdate> {
        let mut updates = self.app.world_mut().resource_mut::<WorldUpdateBuffer>();
        updates.drain()
    }

    #[must_use]
    pub fn snapshot(&mut self) -> WorldSnapshot {
        self.app.world().resource::<WorldView>().0.clone()
    }

    #[must_use]
    pub fn primary_entity_id(&mut self) -> Option<u64> {
        let id = self
            .app
            .world_mut()
            .resource::<PrimarySimulationEntityId>();
        id.0
    }

    #[must_use]
    pub fn diagnostics(&self) -> WorldSimDiagnostics {
        self.app.world().resource::<WorldSimDiagnostics>().clone()
    }
}
