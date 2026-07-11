//! Native Stage A Scenario runner → record [`WorldReplay`].

use od_core::replay::{
    world_state_hash, WorldReplay, WorldReplayRecorder, WorldReplayRecorderOptions,
};
use od_core::world::{WorldCommand, WorldIntent};
use od_core::StateHash;
use od_world::{
    finish_and_verify_replay, send_command_recorded, step_ticks_recorded,
    step_until_idle_recorded, WorldSim,
};

use crate::document::{
    AssertStep, EngineAction, SCENARIO_FORMAT_VERSION, Scenario, ScenarioStep,
};
use crate::error::ScenarioRunError;
use crate::keymap::keymap_profile;

/// Result of a successful native Scenario run.
#[derive(Debug, Clone)]
pub struct ScenarioRunResult {
    pub replay: WorldReplay,
    pub checkpoints: Vec<(String, StateHash)>,
}

/// Run a Scenario on a fresh [`WorldSim`], recording a [`WorldReplay`].
///
/// Stage A executes World / Engine / Assert / `RecordCheckpoint` / movement
/// sugar. Session / Shell / Input are **rejected** (fail-closed).
///
/// # Errors
///
/// Returns [`ScenarioRunError`] when the format/profile is invalid, a Stage A
/// unsupported step appears, a command/assert fails, or replay verification
/// mismatches.
pub fn run_scenario_native(scenario: &Scenario) -> Result<ScenarioRunResult, ScenarioRunError> {
    if scenario.format_version != SCENARIO_FORMAT_VERSION {
        return Err(ScenarioRunError::UnsupportedFormatVersion {
            version: scenario.format_version,
        });
    }
    if keymap_profile(&scenario.keymap_profile).is_none() {
        return Err(ScenarioRunError::UnknownKeymapProfile {
            profile: scenario.keymap_profile.clone(),
        });
    }

    let mut sim = WorldSim::new(
        scenario.world_config.clone(),
        scenario.spawn_default_player,
    );
    let mut recorder = WorldReplayRecorder::new(
        &scenario.name,
        scenario.world_config.clone(),
        scenario.spawn_default_player,
        WorldReplayRecorderOptions::default(),
        sim.snapshot(),
    );
    let mut checkpoints = Vec::new();

    for (step_index, step) in scenario.steps.iter().enumerate() {
        match step {
            ScenarioStep::Session { .. }
            | ScenarioStep::Shell { .. }
            | ScenarioStep::Input { .. } => {
                return Err(ScenarioRunError::UnsupportedInStageA {
                    step_index,
                    step: step.clone(),
                });
            }
            ScenarioStep::World { intent } => {
                apply_world_intent(&mut sim, &mut recorder, step_index, intent)?;
            }
            ScenarioStep::MovePlayerExact {
                direction,
                max_ticks,
            } => {
                apply_world_intent(
                    &mut sim,
                    &mut recorder,
                    step_index,
                    &WorldIntent::MovePlayer {
                        direction: *direction,
                    },
                )?;
                wait_until_idle(&mut sim, &mut recorder, step_index, *max_ticks)?;
            }
            ScenarioStep::WaitUntilIdle { max_ticks } => {
                wait_until_idle(&mut sim, &mut recorder, step_index, *max_ticks)?;
            }
            ScenarioStep::Engine { action } => {
                apply_engine(&mut sim, &mut recorder, step_index, action)?;
            }
            ScenarioStep::Assert { assertion } => {
                apply_assert(&sim, step_index, assertion)?;
            }
            ScenarioStep::RecordCheckpoint { name } => {
                let snap = sim.snapshot();
                let hash = world_state_hash(&snap);
                recorder.record_checkpoint(snap);
                checkpoints.push((name.clone(), hash));
            }
        }
    }

    let replay = finish_and_verify_replay(&sim, recorder)
        .map_err(ScenarioRunError::ReplayVerify)?;
    Ok(ScenarioRunResult {
        replay,
        checkpoints,
    })
}

fn apply_world_intent(
    sim: &mut WorldSim,
    recorder: &mut WorldReplayRecorder,
    step_index: usize,
    intent: &WorldIntent,
) -> Result<(), ScenarioRunError> {
    match intent {
        WorldIntent::MovePlayer { direction } => {
            let id = sim
                .primary_entity_id()
                .ok_or(ScenarioRunError::NoPrimaryEntity { step_index })?;
            let command = WorldCommand::MoveEntity {
                id,
                direction: direction.to_vec3i(),
            };
            send_command_recorded(sim, recorder, command)
                .map_err(|source| ScenarioRunError::Command { step_index, source })?;
        }
        WorldIntent::WaitTicks { ticks } => {
            step_ticks_recorded(sim, recorder, *ticks)
                .map_err(|source| ScenarioRunError::Command { step_index, source })?;
        }
    }
    Ok(())
}

fn apply_engine(
    sim: &mut WorldSim,
    recorder: &mut WorldReplayRecorder,
    step_index: usize,
    action: &EngineAction,
) -> Result<(), ScenarioRunError> {
    match action {
        EngineAction::SetChunkLoaded { chunk, loaded } => {
            send_command_recorded(
                sim,
                recorder,
                WorldCommand::SetChunkLoaded {
                    chunk: *chunk,
                    loaded: *loaded,
                },
            )
            .map_err(|source| ScenarioRunError::Command { step_index, source })?;
        }
    }
    Ok(())
}

fn apply_assert(
    sim: &WorldSim,
    step_index: usize,
    assertion: &AssertStep,
) -> Result<(), ScenarioRunError> {
    match assertion {
        AssertStep::WorldStateHashEq { expected } => {
            let actual = world_state_hash(&sim.snapshot());
            if &actual != expected {
                return Err(ScenarioRunError::AssertWorldStateHash {
                    step_index,
                    expected: expected.clone(),
                    actual,
                });
            }
        }
        AssertStep::EntityPosition { id, position } => {
            let actual = sim
                .snapshot()
                .entities
                .iter()
                .find(|e| e.id == *id)
                .map(|e| e.position);
            if actual.as_ref() != Some(position) {
                return Err(ScenarioRunError::AssertEntityPosition {
                    step_index,
                    id: *id,
                    expected: *position,
                    actual,
                });
            }
        }
    }
    Ok(())
}

fn wait_until_idle(
    sim: &mut WorldSim,
    recorder: &mut WorldReplayRecorder,
    step_index: usize,
    max_ticks: u32,
) -> Result<(), ScenarioRunError> {
    let entity_id = sim
        .primary_entity_id()
        .ok_or(ScenarioRunError::NoPrimaryEntity { step_index })?;
    let advanced = step_until_idle_recorded(sim, recorder, entity_id, max_ticks)
        .map_err(|source| ScenarioRunError::Command { step_index, source })?;
    if sim.state().entity_is_moving(entity_id) {
        return Err(ScenarioRunError::WaitUntilIdleTimeout {
            step_index,
            entity_id,
            max_ticks,
        });
    }
    let _ = advanced;
    Ok(())
}
