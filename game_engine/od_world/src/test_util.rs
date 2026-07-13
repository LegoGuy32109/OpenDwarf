//! Test helpers for driving [`crate::WorldSim`].

use od_core::world::{BlockType, Vec3i};

use crate::WorldSim;

/// Test-only terrain mutation: set one block and bump only that chunk's
/// terrain revision (a same-value write does not increment). Returns `false`
/// for out-of-bounds positions.
///
/// Exists solely to exercise projection/cache invalidation until a replayable
/// terrain-edit command is designed.
pub fn set_block(sim: &mut WorldSim, position: Vec3i, block: BlockType) -> bool {
    sim.state_mut().set_block_for_test(position, block)
}

/// Advance one tick at a time until `entity_id` has no in-progress movement,
/// or until `max_ticks` is reached.
///
/// Returns the number of ticks advanced. Legacy scenario runners used a 256-tick
/// safety bound.
pub fn step_until_idle(sim: &mut WorldSim, entity_id: u64, max_ticks: u32) -> u32 {
    let mut advanced = 0_u32;
    for _ in 0..max_ticks {
        if !sim.state().entity_is_moving(entity_id) {
            return advanced;
        }
        sim.step_ticks(1);
        advanced = advanced.saturating_add(1);
    }
    advanced
}
