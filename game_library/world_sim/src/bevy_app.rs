use bevy_app::{App, Plugin, Update};
use bevy_ecs::prelude::Resource;
use bevy_ecs::system::ResMut;

use crate::world_api::{Vec3i, WorldCommand, WorldSnapshot, WorldUpdate};
use crate::world_core::{WorldConfig, WorldState};

const DEFAULT_PLAYER_ID: u64 = 1;

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
        if self.settings.spawn_default_player {
            world
                .spawn_entity(DEFAULT_PLAYER_ID, Vec3i::ZERO)
                .expect("default player should spawn in bounds");
        }

        app.insert_resource(WorldSimState { world })
            .init_resource::<WorldCommandQueue>()
            .init_resource::<WorldTickControl>()
            .init_resource::<WorldUpdateBuffer>()
            .add_systems(Update, run_simulation_tick);

        let initial_snapshot = app.world().resource::<WorldSimState>().world.snapshot();
        let mut updates = app.world_mut().resource_mut::<WorldUpdateBuffer>();
        updates.0.push(WorldUpdate::Snapshot(initial_snapshot));
    }
}

fn run_simulation_tick(
    mut tick_control: ResMut<WorldTickControl>,
    mut sim_state: ResMut<WorldSimState>,
    mut command_queue: ResMut<WorldCommandQueue>,
    mut updates: ResMut<WorldUpdateBuffer>,
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
    for command in queued {
        if let Some(delta) = sim_state.world.apply_command(command) {
            updates.0.push(WorldUpdate::Delta(delta));
        } else {
            eprintln!("World command rejected (likely out of bounds or unknown entity)");
        }
    }
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
        let runtime = self.app.world_mut().resource::<WorldSimState>();
        runtime.world.snapshot()
    }
}
