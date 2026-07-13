//! Bevy-free world simulation (`WorldSim`).
//!
//! See `docs/design/od-world.md`. Wire types live in [`od_core::world`].
//! Replay helpers that need [`WorldSim`] live in [`replay_util`].

#![warn(clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]

pub mod project;
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
        BlockType, MoveEntityError, Vec3i, Vec3u, WorldCommand, WorldCommandError, WorldConfig,
        WorldConfigError,
    };

    use super::{ReplayApplyError, WorldSim, replay_commands_to_snapshot, test_util};

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
    fn try_new_rejects_non_16_chunk_edge_with_typed_error() {
        for actual in [0_u32, 8, 15, 17, 32] {
            let result = WorldSim::try_new(
                WorldConfig {
                    chunk_edge: actual,
                    ..WorldConfig::default()
                },
                true,
            );
            assert!(
                matches!(
                    result.as_ref().err(),
                    Some(&WorldConfigError::UnsupportedChunkEdge {
                        actual: got,
                        supported: 16,
                    }) if got == actual
                ),
                "chunk_edge {actual} must be rejected, got a different result"
            );
        }
        assert!(WorldSim::try_new(WorldConfig::default(), true).is_ok());
    }

    #[test]
    fn replay_import_rejects_non_16_chunk_edge_with_typed_error() {
        use od_core::replay::{WorldReplay, WorldReplayMetadata};

        let good = WorldSim::new(WorldConfig::default(), true);
        let replay = WorldReplay {
            metadata: WorldReplayMetadata {
                format_version: od_core::WORLD_REPLAY_FORMAT_VERSION,
                name: "bad_chunk_edge".to_owned(),
                world_config: WorldConfig {
                    chunk_edge: 32,
                    ..WorldConfig::default()
                },
                spawn_default_player: true,
            },
            events: Vec::new(),
            final_snapshot: good.snapshot(),
            final_state_hash: od_core::world_state_hash(&good.snapshot()),
        };

        let err = replay_commands_to_snapshot(&replay).expect_err("non-16 edge must be rejected");
        assert!(
            matches!(
                err,
                ReplayApplyError::Config(WorldConfigError::UnsupportedChunkEdge {
                    actual: 32,
                    supported: 16,
                })
            ),
            "expected typed config error, got {err:?}"
        );
    }

    #[test]
    fn out_of_bounds_set_chunk_loaded_is_typed_error_without_state_change() {
        let mut sim = WorldSim::new(WorldConfig::default(), true);
        let before = sim.snapshot();
        let chunk = Vec3i::new(7, 0, 0);
        let err = sim
            .send_command(WorldCommand::SetChunkLoaded {
                chunk,
                loaded: true,
            })
            .expect_err("out-of-bounds chunk must be rejected");
        assert_eq!(err, WorldCommandError::ChunkOutOfBounds { chunk });
        assert_eq!(sim.snapshot(), before);
        assert_eq!(sim.loaded_chunk_coords().len(), 1);
    }

    #[test]
    fn unloaded_chunk_blocks_movement_and_leaves_snapshot_until_reloaded() {
        // 2x1x1 world: the forced starter room spans the chunk boundary at
        // x == 0 (chunk -1 covers x < 0, chunk 0 covers x >= 0).
        let config = WorldConfig {
            world_chunks: Vec3u::new(2, 1, 1),
            ..WorldConfig::default()
        };
        let mut sim = WorldSim::new(config, false);
        let id = 9;
        // Stand on the starter-room floor just west of the boundary.
        sim.state_mut()
            .spawn_entity(id, Vec3i::new(-1, 0, -1))
            .expect("spawn in starter room");
        let east_chunk = Vec3i::new(0, 0, 0);

        sim.send_command(WorldCommand::SetChunkLoaded {
            chunk: east_chunk,
            loaded: false,
        })
        .expect("unload east chunk");

        // Snapshot excludes the unloaded chunk's terrain and residency.
        let unloaded = sim.snapshot();
        assert!(!unloaded.loaded_chunks.contains(&east_chunk));
        assert!(
            unloaded.terrain_blocks.keys().all(|pos| pos.x < 0),
            "terrain from the unloaded chunk must leave the snapshot"
        );

        // Movement into the unloaded chunk fails closed.
        let err = sim
            .send_command(WorldCommand::MoveEntity {
                id,
                direction: Vec3i::new(1, 0, 0),
            })
            .expect_err("move into unloaded chunk must fail");
        assert!(matches!(
            err,
            WorldCommandError::MoveEntity(MoveEntityError::ChunkNotLoaded { .. })
        ));
        assert_eq!(sim.entity_position(id), Some(Vec3i::new(-1, 0, -1)));

        // Reloading restores snapshot membership and movement.
        sim.send_command(WorldCommand::SetChunkLoaded {
            chunk: east_chunk,
            loaded: true,
        })
        .expect("reload east chunk");
        let reloaded = sim.snapshot();
        assert!(reloaded.loaded_chunks.contains(&east_chunk));
        assert!(reloaded.terrain_blocks.keys().any(|pos| pos.x >= 0));
        sim.send_command(WorldCommand::MoveEntity {
            id,
            direction: Vec3i::new(1, 0, 0),
        })
        .expect("move succeeds after reload");
        test_util::step_until_idle(&mut sim, id, 256);
        assert_eq!(sim.entity_position(id), Some(Vec3i::new(0, 0, -1)));
    }

    #[test]
    fn copy_chunk_blocks_passthrough_matches_snapshot_terrain() {
        let sim = WorldSim::new(WorldConfig::default(), false);
        let mut blocks = Box::new([BlockType::Air; od_core::CHUNK_VOLUME]);
        assert!(sim.copy_chunk_blocks(Vec3i::ZERO, &mut blocks));
        assert_eq!(sim.chunk_terrain_revision(Vec3i::ZERO), Some(0));
        assert_eq!(sim.chunk_terrain_revision(Vec3i::new(1, 0, 0)), None);
        let snapshot = sim.snapshot();
        let solid_count = blocks
            .iter()
            .filter(|block| **block == BlockType::SolidStone)
            .count();
        assert_eq!(solid_count, snapshot.terrain_blocks.len());
    }

    #[test]
    fn test_block_mutation_changes_snapshot_and_one_revision() {
        let mut sim = WorldSim::new(
            WorldConfig {
                world_chunks: Vec3u::new(2, 2, 2),
                ..WorldConfig::default()
            },
            false,
        );
        let position = Vec3i::new(0, 0, 0); // starter room => Air
        let target_chunk = sim
            .state()
            .world_position_to_chunk_coord(position)
            .expect("target chunk");
        let before = sim.snapshot();

        assert!(test_util::set_block(&mut sim, position, BlockType::SolidStone));

        let after = sim.snapshot();
        assert_ne!(after, before, "snapshot output must change");
        assert_eq!(
            after.terrain_blocks.get(&position),
            Some(&BlockType::SolidStone)
        );
        for chunk in sim.loaded_chunk_coords() {
            let expected = u64::from(chunk == target_chunk);
            assert_eq!(
                sim.chunk_terrain_revision(chunk),
                Some(expected),
                "revision for {chunk:?}"
            );
        }

        // Same-value write: no revision increment, no snapshot change.
        assert!(test_util::set_block(&mut sim, position, BlockType::SolidStone));
        assert_eq!(sim.chunk_terrain_revision(target_chunk), Some(1));
        assert_eq!(sim.snapshot(), after);
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
