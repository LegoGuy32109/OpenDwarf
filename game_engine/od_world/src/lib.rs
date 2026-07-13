//! Bevy-free world simulation (`WorldSim`).
//!
//! See `docs/design/od-world.md`. Wire types live in [`od_core::world`].
//! Replay helpers that need [`WorldSim`] live in [`replay_util`].

#![warn(clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]

pub mod render;
mod replay_util;
mod sim;
mod state;
mod terrain;

pub use replay_util::{
    ReplayApplyError, finish_and_verify_replay, replay_commands_to_snapshot, send_command_recorded,
    step_ticks_recorded, step_until_idle_recorded,
};
pub use sim::WorldSim;
pub use state::WorldState;

#[cfg(test)]
pub mod test_util;

#[cfg(test)]
mod tests {
    use od_core::world::{
        MoveEntityError, Vec3i, Vec3u, WorldCommand, WorldCommandError, WorldConfig,
    };

    use super::{WorldSim, test_util};

    #[test]
    fn new_with_default_player_spawns_entity_one() {
        let sim = WorldSim::new(WorldConfig::default(), true);
        assert_eq!(sim.primary_entity_id(), Some(1));
        let snap = sim.snapshot();
        assert_eq!(snap.tick, 0);
        assert_eq!(snap.entities.len(), 1);
        assert_eq!(snap.entities[0].id, 1);
        assert!(snap.entities[0].movement.is_none());
        assert!(!snap.loaded_chunks.is_empty());
        assert!(!snap.terrain_blocks.is_empty());
    }

    #[test]
    fn new_without_player_has_no_entities() {
        let sim = WorldSim::new(WorldConfig::default(), false);
        assert_eq!(sim.primary_entity_id(), None);
        assert!(sim.snapshot().entities.is_empty());
    }

    #[test]
    fn advance_ticks_updates_counter() {
        let mut sim = WorldSim::new(WorldConfig::default(), false);
        sim.send_command(WorldCommand::AdvanceTicks { count: 4 })
            .expect("advance should succeed");
        assert_eq!(sim.snapshot().tick, 4);
        sim.step_ticks(3);
        assert_eq!(sim.snapshot().tick, 7);
    }

    #[test]
    fn narrow_accessors_exactly_match_snapshot_and_bounds() {
        let mut sim = WorldSim::new(WorldConfig::default(), true);
        assert_eq!(sim.tick_count(), 0);
        assert_eq!(sim.entity_position(999), None);
        assert_eq!(sim.entity_snapshot(999), None);

        let id = sim.primary_entity_id().expect("player");
        let idle_snapshot = sim.snapshot();
        let idle_entity = idle_snapshot
            .entities
            .iter()
            .find(|entity| entity.id == id)
            .expect("idle entity");
        assert_eq!(sim.entity_position(id), Some(idle_entity.position));
        assert_eq!(sim.entity_snapshot(id).as_ref(), Some(idle_entity));
        let loaded = sim.loaded_chunk_coords();
        assert!(loaded.windows(2).all(|pair| pair[0] < pair[1]));
        assert_eq!(
            loaded
                .iter()
                .copied()
                .collect::<std::collections::BTreeSet<_>>(),
            idle_snapshot.loaded_chunks
        );
        assert_eq!(sim.world_chunks(), idle_snapshot.world_chunks);
        assert_eq!(sim.chunk_edge(), idle_snapshot.chunk_edge);
        assert_eq!(sim.world_bounds(), sim.state().centered_bounds());
        let direction = [
            Vec3i::new(1, 0, 0),
            Vec3i::new(-1, 0, 0),
            Vec3i::new(0, 1, 0),
            Vec3i::new(0, -1, 0),
        ]
        .into_iter()
        .find(|direction| {
            sim.send_command(WorldCommand::MoveEntity {
                id,
                direction: *direction,
            })
            .is_ok()
        })
        .expect("open move");
        let moving_snapshot = sim.snapshot();
        let moving_entity = moving_snapshot
            .entities
            .iter()
            .find(|entity| entity.id == id)
            .expect("moving entity");
        assert_eq!(
            sim.entity_snapshot(id).as_ref(),
            Some(moving_entity),
            "movement accessor mismatch for {direction:?}"
        );
        assert_eq!(sim.entity_position(id), Some(moving_entity.position));
        assert!(moving_entity.movement.is_some());

        let even = WorldSim::new(
            WorldConfig {
                chunk_edge: 16,
                world_chunks: Vec3u::new(2, 2, 2),
                ..WorldConfig::default()
            },
            false,
        );
        assert_eq!(
            even.world_bounds(),
            (Vec3i::new(-16, -16, -16), Vec3i::new(15, 15, 15))
        );
        let odd = WorldSim::new(
            WorldConfig {
                chunk_edge: 16,
                world_chunks: Vec3u::new(3, 1, 1),
                ..WorldConfig::default()
            },
            false,
        );
        assert_eq!(
            odd.world_bounds(),
            (Vec3i::new(-24, -8, -8), Vec3i::new(23, 7, 7))
        );
    }

    #[test]
    fn move_into_unloaded_chunk_fails_closed() {
        let config = WorldConfig {
            chunk_edge: 16,
            world_chunks: Vec3u::new(2, 1, 1),
            ..WorldConfig::default()
        };
        let mut sim = WorldSim::new(config, true);
        let id = sim.primary_entity_id().expect("player");
        let spawn = sim.snapshot().entities[0].position;

        // Unload every chunk so any adjacent move that leaves the cell fails.
        let chunks: Vec<_> = sim.snapshot().loaded_chunks.iter().copied().collect();
        for chunk in chunks {
            sim.send_command(WorldCommand::SetChunkLoaded {
                chunk,
                loaded: false,
            })
            .expect("unload");
        }

        let err = sim
            .send_command(WorldCommand::MoveEntity {
                id,
                direction: Vec3i::new(1, 0, 0),
            })
            .expect_err("move into unloaded world should fail");

        assert!(matches!(
            err,
            WorldCommandError::MoveEntity(MoveEntityError::ChunkNotLoaded { .. })
                | WorldCommandError::MoveEntity(MoveEntityError::Blocked)
                | WorldCommandError::MoveEntity(MoveEntityError::OutOfBounds { .. })
        ));
        // Fail-closed: still idle at spawn.
        let after = sim.snapshot().entities[0].clone();
        assert_eq!(after.position, spawn);
        assert!(after.movement.is_none());
    }

    #[test]
    fn move_and_step_until_idle_completes_movement() {
        let mut sim = WorldSim::new(WorldConfig::default(), true);
        let id = 1;
        let start = sim.snapshot().entities[0].position;

        // Try cardinal directions until one is accepted (starter room is open).
        let dirs = [
            Vec3i::new(1, 0, 0),
            Vec3i::new(-1, 0, 0),
            Vec3i::new(0, 1, 0),
            Vec3i::new(0, -1, 0),
        ];
        let mut started = false;
        for direction in dirs {
            if sim
                .send_command(WorldCommand::MoveEntity { id, direction })
                .is_ok()
            {
                started = true;
                break;
            }
        }
        assert!(started, "expected at least one valid move from spawn");
        assert!(sim.snapshot().entities[0].movement.is_some());

        let advanced = test_util::step_until_idle(&mut sim, id, 256);
        assert!(advanced > 0);
        let after = &sim.snapshot().entities[0];
        assert!(after.movement.is_none());
        assert_ne!(after.position, start);
    }

    #[test]
    fn diagonal_move_starts_with_both_xy_axes() {
        let id = 1;
        let diagonals = [
            Vec3i::new(1, -1, 0),
            Vec3i::new(1, 1, 0),
            Vec3i::new(-1, 1, 0),
            Vec3i::new(-1, -1, 0),
        ];

        for direction in diagonals {
            let mut sim = WorldSim::new(WorldConfig::default(), true);
            if sim
                .send_command(WorldCommand::MoveEntity { id, direction })
                .is_err()
            {
                continue;
            }
            let snapshot = sim.snapshot();
            let movement = snapshot.entities[0]
                .movement
                .as_ref()
                .expect("diagonal movement");
            assert_eq!(
                (movement.target.x - movement.origin.x).signum(),
                direction.x
            );
            assert_eq!(
                (movement.target.y - movement.origin.y).signum(),
                direction.y
            );
            return;
        }

        panic!("expected at least one valid diagonal move from spawn");
    }
}
