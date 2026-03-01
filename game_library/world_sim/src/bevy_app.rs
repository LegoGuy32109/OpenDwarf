use bevy_app::{App, Plugin, Update};
use bevy_ecs::prelude::Resource;
use bevy_ecs::system::ResMut;

use crate::world_api::{Vec3i, WorldCommand, WorldSnapshot, WorldUpdate};
use crate::world_bus::{InProcessWorldBus, WorldBus};
use crate::world_core::{WorldConfig, WorldState};

const DEFAULT_PLAYER_ID: u64 = 1;

#[derive(Resource)]
struct SimulationRuntime {
    world: WorldState,
    bus: InProcessWorldBus,
}

pub struct WorldSimulationPlugin {
    pub config: WorldConfig,
    pub spawn_default_player: bool,
}

impl Default for WorldSimulationPlugin {
    fn default() -> Self {
        Self {
            config: WorldConfig::default(),
            spawn_default_player: true,
        }
    }
}

impl Plugin for WorldSimulationPlugin {
    fn build(&self, app: &mut App) {
        let mut world = WorldState::new(self.config.clone());
        if self.spawn_default_player {
            world
                .spawn_entity(DEFAULT_PLAYER_ID, Vec3i::ZERO)
                .expect("default player should spawn in bounds");
        }

        let mut bus = InProcessWorldBus::default();
        bus.publish(WorldUpdate::Snapshot(world.snapshot()));
        app.insert_resource(SimulationRuntime { world, bus });
        app.add_systems(Update, run_simulation_tick);
    }
}

fn run_simulation_tick(mut runtime: ResMut<SimulationRuntime>) {
    let commands = runtime.bus.drain_commands();
    for command in commands {
        if let Some(delta) = runtime.world.apply_command(command) {
            runtime.bus.publish(WorldUpdate::Delta(delta));
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
        let runtime = self.app.world_mut().resource::<SimulationRuntime>();
        runtime.bus.send_command(command)
    }

    pub fn subscribe(&mut self) -> std::sync::mpsc::Receiver<WorldUpdate> {
        let mut runtime = self.app.world_mut().resource_mut::<SimulationRuntime>();
        runtime.bus.subscribe()
    }

    pub fn step_ticks(&mut self, count: u32) {
        let steps = count.max(1);
        for _ in 0..steps {
            self.app.update();
        }
    }

    #[must_use]
    pub fn snapshot(&mut self) -> WorldSnapshot {
        let runtime = self.app.world_mut().resource::<SimulationRuntime>();
        runtime.world.snapshot()
    }
}
