//! Test helpers for driving [`crate::WorldSim`].

use crate::WorldSim;

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
