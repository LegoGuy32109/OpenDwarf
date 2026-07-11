//! `WorldReplayRecorder` — append commands and periodic checkpoints.

use crate::replay::{
    WorldReplay, WorldReplayEvent, WorldReplayMetadata, WORLD_REPLAY_FORMAT_VERSION,
};
use crate::replay::world_state_hash;
use crate::world::{WorldCommand, WorldConfig, WorldSnapshot};

/// Options for [`WorldReplayRecorder`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorldReplayRecorderOptions {
    /// Default: 128 ticks (legacy default).
    pub checkpoint_interval_ticks: u64,
}

impl Default for WorldReplayRecorderOptions {
    fn default() -> Self {
        Self {
            checkpoint_interval_ticks: 128,
        }
    }
}

/// Records an authoritative sim command log while a `WorldSim` runs.
pub struct WorldReplayRecorder {
    metadata: WorldReplayMetadata,
    options: WorldReplayRecorderOptions,
    next_checkpoint_tick: u64,
    events: Vec<WorldReplayEvent>,
}

impl WorldReplayRecorder {
    /// Start recording; emits an initial boot checkpoint from `initial_snapshot`.
    #[must_use]
    pub fn new(
        name: impl Into<String>,
        world_config: WorldConfig,
        spawn_default_player: bool,
        options: WorldReplayRecorderOptions,
        initial_snapshot: WorldSnapshot,
    ) -> Self {
        let metadata = WorldReplayMetadata {
            format_version: WORLD_REPLAY_FORMAT_VERSION,
            name: name.into(),
            world_config,
            spawn_default_player,
        };
        let interval = options.checkpoint_interval_ticks.max(1);
        let mut events = Vec::new();
        let hash = world_state_hash(&initial_snapshot);
        events.push(WorldReplayEvent::Checkpoint {
            snapshot: initial_snapshot,
            state_hash: hash,
        });
        Self {
            metadata,
            options,
            next_checkpoint_tick: interval,
            events,
        }
    }

    /// Record a command with the sim tick **before** it is applied.
    pub fn record_command(&mut self, tick_before: u64, command: WorldCommand) {
        self.events.push(WorldReplayEvent::Command {
            tick_before,
            command,
        });
    }

    /// Emit a checkpoint when `snapshot.tick >= next_checkpoint_tick`.
    pub fn maybe_checkpoint(&mut self, snapshot: &WorldSnapshot) {
        if snapshot.tick < self.next_checkpoint_tick {
            return;
        }
        let hash = world_state_hash(snapshot);
        self.events.push(WorldReplayEvent::Checkpoint {
            snapshot: snapshot.clone(),
            state_hash: hash,
        });
        let interval = self.options.checkpoint_interval_ticks.max(1);
        self.next_checkpoint_tick = snapshot.tick.saturating_add(interval);
    }

    /// Finish the recording with the final snapshot.
    #[must_use]
    pub fn finish(self, final_snapshot: WorldSnapshot) -> WorldReplay {
        let final_state_hash = world_state_hash(&final_snapshot);
        WorldReplay {
            metadata: self.metadata,
            events: self.events,
            final_snapshot,
            final_state_hash,
        }
    }
}
