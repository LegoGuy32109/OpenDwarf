use std::fmt::{Display, Formatter};
use std::fs;
use std::path::Path;

use bincode::config::standard;
use bincode::serde::{decode_from_slice, encode_to_vec};
use serde::{Deserialize, Serialize};

use crate::bevy_app::{WorldSimApp, WorldSimSettings, WorldSimulationPlugin};
use crate::world_api::{WorldCommand, WorldSnapshot, WorldUpdate};
use crate::world_core::WorldConfig;

pub const REPLAY_FORMAT_VERSION: u32 = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayMetadata {
    pub format_version: u32,
    pub scenario_name: String,
    pub world_config: WorldConfig,
    pub spawn_default_player: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ReplayEvent {
    Command {
        tick_before: u64,
        command: WorldCommand,
    },
    Update(WorldUpdate),
    Checkpoint(WorldSnapshot),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayFile {
    pub metadata: ReplayMetadata,
    pub events: Vec<ReplayEvent>,
    pub final_snapshot: WorldSnapshot,
}

#[derive(Debug, Clone)]
pub struct ReplayRecorderOptions {
    pub checkpoint_interval_ticks: u64,
    pub include_updates: bool,
}

impl Default for ReplayRecorderOptions {
    fn default() -> Self {
        Self {
            checkpoint_interval_ticks: 128,
            include_updates: true,
        }
    }
}

pub struct ReplayRecorder {
    metadata: ReplayMetadata,
    options: ReplayRecorderOptions,
    next_checkpoint_tick: u64,
    events: Vec<ReplayEvent>,
}

impl ReplayRecorder {
    #[must_use]
    pub fn new(
        scenario_name: String,
        world_config: WorldConfig,
        spawn_default_player: bool,
        options: ReplayRecorderOptions,
        initial_snapshot: WorldSnapshot,
        initial_updates: Vec<WorldUpdate>,
    ) -> Self {
        let metadata = ReplayMetadata {
            format_version: REPLAY_FORMAT_VERSION,
            scenario_name,
            world_config,
            spawn_default_player,
        };
        let next_checkpoint_tick = options.checkpoint_interval_ticks.max(1);
        Self {
            metadata,
            options,
            next_checkpoint_tick,
            events: {
                let mut events = vec![ReplayEvent::Checkpoint(initial_snapshot)];
                events.extend(initial_updates.into_iter().map(ReplayEvent::Update));
                events
            },
        }
    }

    pub fn record_command(&mut self, tick_before: u64, command: WorldCommand) {
        self.events.push(ReplayEvent::Command {
            tick_before,
            command,
        });
    }

    pub fn record_updates(&mut self, updates: Vec<WorldUpdate>) {
        if !self.options.include_updates {
            return;
        }
        self.events
            .extend(updates.into_iter().map(ReplayEvent::Update));
    }

    pub fn maybe_checkpoint(&mut self, snapshot: &WorldSnapshot) {
        if snapshot.tick < self.next_checkpoint_tick {
            return;
        }
        self.events.push(ReplayEvent::Checkpoint(snapshot.clone()));
        let interval = self.options.checkpoint_interval_ticks.max(1);
        self.next_checkpoint_tick = snapshot.tick.saturating_add(interval);
    }

    #[must_use]
    pub fn finish(self, final_snapshot: WorldSnapshot) -> ReplayFile {
        ReplayFile {
            metadata: self.metadata,
            events: self.events,
            final_snapshot,
        }
    }
}

#[derive(Debug)]
pub enum ReplayIoError {
    Encode(String),
    Decode(String),
    Read(String),
    Write(String),
}

impl Display for ReplayIoError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Encode(err) => write!(f, "Failed to encode replay: {err}"),
            Self::Decode(err) => write!(f, "Failed to decode replay: {err}"),
            Self::Read(err) => write!(f, "Failed to read replay file: {err}"),
            Self::Write(err) => write!(f, "Failed to write replay file: {err}"),
        }
    }
}

impl std::error::Error for ReplayIoError {}

pub fn save_replay(path: &Path, replay: &ReplayFile) -> Result<(), ReplayIoError> {
    let encoded = encode_to_vec(replay, standard())
        .map_err(|err| ReplayIoError::Encode(err.to_string()))?;
    fs::write(path, encoded).map_err(|err| ReplayIoError::Write(err.to_string()))?;
    Ok(())
}

pub fn load_replay(path: &Path) -> Result<ReplayFile, ReplayIoError> {
    let encoded = fs::read(path).map_err(|err| ReplayIoError::Read(err.to_string()))?;
    let (replay, _bytes_read): (ReplayFile, usize) = decode_from_slice(&encoded, standard())
        .map_err(|err| ReplayIoError::Decode(err.to_string()))?;
    Ok(replay)
}

#[must_use]
pub fn replay_view_updates(replay: &ReplayFile) -> Vec<WorldUpdate> {
    replay
        .events
        .iter()
        .filter_map(|event| match event {
            ReplayEvent::Update(update) => Some(update.clone()),
            ReplayEvent::Command { .. } | ReplayEvent::Checkpoint(_) => None,
        })
        .collect()
}

pub fn replay_commands_to_snapshot(replay: &ReplayFile) -> Result<WorldSnapshot, String> {
    if replay.metadata.format_version != REPLAY_FORMAT_VERSION {
        return Err(format!(
            "Unsupported replay format {}, expected {}",
            replay.metadata.format_version, REPLAY_FORMAT_VERSION
        ));
    }

    let mut app = WorldSimApp::new(WorldSimulationPlugin {
        settings: WorldSimSettings {
            config: replay.metadata.world_config.clone(),
            spawn_default_player: replay.metadata.spawn_default_player,
        },
    });

    for event in &replay.events {
        if let ReplayEvent::Command {
            tick_before: _,
            command,
        } = event
        {
            match command {
                WorldCommand::MoveEntity { id, direction } => {
                    app.send_command(WorldCommand::MoveEntity {
                        id: *id,
                        direction: *direction,
                    })?;
                    app.step_ticks(1);
                    wait_for_entity_movement_to_finish(&mut app, *id);
                }
                WorldCommand::AdvanceTicks { count } => {
                    app.step_ticks(*count);
                }
                WorldCommand::SetChunkLoaded { chunk, loaded } => {
                    app.send_command(WorldCommand::SetChunkLoaded {
                        chunk: *chunk,
                        loaded: *loaded,
                    })?;
                    app.step_ticks(1);
                }
            }
        }
    }

    Ok(app.snapshot())
}

fn wait_for_entity_movement_to_finish(app: &mut WorldSimApp, id: u64) {
    for _ in 0..256 {
        let is_moving = app
            .snapshot()
            .entities
            .iter()
            .find(|entity| entity.id == id)
            .and_then(|entity| entity.movement.as_ref())
            .is_some();
        if !is_moving {
            return;
        }
        app.step_ticks(1);
    }
}
