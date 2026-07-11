//! Replay helpers that need [`WorldSim`] (kept out of `od_core` to avoid cycles).

use od_core::replay::{
    world_state_hash, WorldReplay, WorldReplayEvent, WorldReplayRecorder,
};
use od_core::world::{WorldCommand, WorldCommandError, WorldSnapshot};

use crate::WorldSim;

/// Errors while replaying commands onto a fresh [`WorldSim`].
#[derive(Debug)]
pub enum ReplayApplyError {
    Command(WorldCommandError),
    TickMismatch {
        expected: u64,
        actual: u64,
        index: usize,
    },
}

impl std::fmt::Display for ReplayApplyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Command(err) => write!(f, "command failed during replay: {err}"),
            Self::TickMismatch {
                expected,
                actual,
                index,
            } => write!(
                f,
                "tick mismatch at event {index}: expected {expected}, got {actual}"
            ),
        }
    }
}

impl std::error::Error for ReplayApplyError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Command(err) => Some(err),
            Self::TickMismatch { .. } => None,
        }
    }
}

/// Re-apply `Command` events onto a fresh [`WorldSim`] built from metadata.
///
/// Checkpoint payloads are ignored (optional mid-run asserts belong in tests).
pub fn replay_commands_to_snapshot(replay: &WorldReplay) -> Result<WorldSnapshot, ReplayApplyError> {
    let mut sim = WorldSim::new(
        replay.metadata.world_config.clone(),
        replay.metadata.spawn_default_player,
    );
    for (index, event) in replay.events.iter().enumerate() {
        let WorldReplayEvent::Command {
            tick_before,
            command,
        } = event
        else {
            continue;
        };
        let actual = sim.snapshot().tick;
        if actual != *tick_before {
            return Err(ReplayApplyError::TickMismatch {
                expected: *tick_before,
                actual,
                index,
            });
        }
        sim.send_command(command.clone())
            .map_err(ReplayApplyError::Command)?;
    }
    Ok(sim.snapshot())
}

/// Apply a command while recording it (only on success).
///
/// `tick_before` is sampled before mutate so the log stays an honest server
/// transcript of applied commands.
pub fn send_command_recorded(
    sim: &mut WorldSim,
    recorder: &mut WorldReplayRecorder,
    command: WorldCommand,
) -> Result<(), WorldCommandError> {
    let tick_before = sim.snapshot().tick;
    let result = sim.send_command(command.clone());
    if result.is_ok() {
        recorder.record_command(tick_before, command);
        recorder.maybe_checkpoint(&sim.snapshot());
    }
    result
}

/// Advance `n` ticks, recording a single folded [`WorldCommand::AdvanceTicks`].
pub fn step_ticks_recorded(
    sim: &mut WorldSim,
    recorder: &mut WorldReplayRecorder,
    n: u32,
) -> Result<(), WorldCommandError> {
    if n == 0 {
        return Ok(());
    }
    send_command_recorded(sim, recorder, WorldCommand::AdvanceTicks { count: n })
}

/// Like [`crate::test_util::step_until_idle`], but records each tick as
/// `AdvanceTicks { count: 1 }` so the server log stays honest.
pub fn step_until_idle_recorded(
    sim: &mut WorldSim,
    recorder: &mut WorldReplayRecorder,
    entity_id: u64,
    max_ticks: u32,
) -> Result<u32, WorldCommandError> {
    let mut advanced = 0_u32;
    for _ in 0..max_ticks {
        if !sim.state().entity_is_moving(entity_id) {
            return Ok(advanced);
        }
        step_ticks_recorded(sim, recorder, 1)?;
        advanced = advanced.saturating_add(1);
    }
    Ok(advanced)
}

/// Finish a recording and verify replay reproduces `final_state_hash`.
pub fn finish_and_verify_replay(
    sim: &WorldSim,
    recorder: WorldReplayRecorder,
) -> Result<WorldReplay, String> {
    let final_snapshot = sim.snapshot();
    let replay = recorder.finish(final_snapshot);
    let replayed = replay_commands_to_snapshot(&replay).map_err(|err| err.to_string())?;
    let replayed_hash = world_state_hash(&replayed);
    if replayed_hash != replay.final_state_hash {
        return Err(format!(
            "replay hash mismatch: recorded {} vs replayed {replayed_hash}",
            replay.final_state_hash
        ));
    }
    Ok(replay)
}
