//! Increment 2 native golden suite — command-driven WorldReplay determinism.
//!
//! See `docs/design/sim-replay.md` §8.

use std::env::temp_dir;

use od_core::replay::{
    load_world_replay, save_world_replay, world_state_hash, WorldReplayRecorder,
    WorldReplayRecorderOptions,
};
use od_core::world::{Vec3i, Vec3u, WorldCommand, WorldConfig};

use od_world::{
    finish_and_verify_replay, replay_commands_to_snapshot, send_command_recorded,
    step_until_idle_recorded, WorldSim,
};

#[test]
fn boot_hash_is_stable_across_runs() {
    let a = WorldSim::new(WorldConfig::default(), true).snapshot();
    let b = WorldSim::new(WorldConfig::default(), true).snapshot();
    assert_eq!(world_state_hash(&a), world_state_hash(&b));
    assert_eq!(a.tick, 0);
    assert_eq!(a.entities.len(), 1);
}

#[test]
fn record_replay_round_trip_matches_final_hash() {
    let config = WorldConfig::default();
    let mut sim = WorldSim::new(config.clone(), true);
    let mut recorder = WorldReplayRecorder::new(
        "record_replay_round_trip",
        config,
        true,
        WorldReplayRecorderOptions {
            checkpoint_interval_ticks: 4,
        },
        sim.snapshot(),
    );

    let id = 1;
    let dirs = [
        Vec3i::new(1, 0, 0),
        Vec3i::new(-1, 0, 0),
        Vec3i::new(0, 1, 0),
        Vec3i::new(0, -1, 0),
    ];
    let mut moved = false;
    for direction in dirs {
        if send_command_recorded(
            &mut sim,
            &mut recorder,
            WorldCommand::MoveEntity { id, direction },
        )
        .is_ok()
        {
            moved = true;
            break;
        }
    }
    assert!(moved);
    step_until_idle_recorded(&mut sim, &mut recorder, id, 256).expect("idle");

    let replay = finish_and_verify_replay(&sim, recorder).expect("replay verify");
    let path = temp_dir().join("opendwarf_world_replay_round_trip.bin");
    save_world_replay(&path, &replay).expect("save");
    let loaded = load_world_replay(&path).expect("load");
    assert_eq!(loaded.final_state_hash, replay.final_state_hash);
    let again = replay_commands_to_snapshot(&loaded).expect("replay again");
    assert_eq!(world_state_hash(&again), replay.final_state_hash);
}

#[test]
fn chunk_load_gate_rejects_then_allows_move() {
    let config = WorldConfig {
        chunk_edge: 16,
        world_chunks: Vec3u::new(2, 1, 1),
        ..WorldConfig::default()
    };
    let mut sim = WorldSim::new(config.clone(), true);
    let id = 1;

    // Find which chunk the player is in; unload the adjacent chunk they'd enter.
    let start = sim.snapshot().entities[0].position;
    let mut recorder = WorldReplayRecorder::new(
        "chunk_gate",
        config,
        true,
        WorldReplayRecorderOptions::default(),
        sim.snapshot(),
    );

    // Unload all chunks except the spawn chunk — any exit should fail.
    let spawn_chunk = sim
        .state()
        .world_position_to_chunk_coord(start)
        .expect("spawn chunk");
    let all_chunks: Vec<_> = sim.snapshot().loaded_chunks.iter().copied().collect();
    for chunk in all_chunks {
        if chunk != spawn_chunk {
            send_command_recorded(
                &mut sim,
                &mut recorder,
                WorldCommand::SetChunkLoaded {
                    chunk,
                    loaded: false,
                },
            )
            .expect("unload neighbor");
        }
    }

    // Also unload spawn chunk itself → even in-chunk moves that leave fail if
    // target chunk unloaded; try a move and expect failure after unloading all.
    send_command_recorded(
        &mut sim,
        &mut recorder,
        WorldCommand::SetChunkLoaded {
            chunk: spawn_chunk,
            loaded: false,
        },
    )
    .expect("unload spawn chunk");

    let fail = send_command_recorded(
        &mut sim,
        &mut recorder,
        WorldCommand::MoveEntity {
            id,
            direction: Vec3i::new(1, 0, 0),
        },
    );
    assert!(fail.is_err(), "move with no loaded chunks must fail");
    let hash_blocked = world_state_hash(&sim.snapshot());

    // Reload spawn + neighbors and succeed.
    for chunk in [spawn_chunk, Vec3i::new(spawn_chunk.x + 1, spawn_chunk.y, spawn_chunk.z)] {
        send_command_recorded(
            &mut sim,
            &mut recorder,
            WorldCommand::SetChunkLoaded {
                chunk,
                loaded: true,
            },
        )
        .expect("reload");
    }

    let mut ok = false;
    for direction in [
        Vec3i::new(1, 0, 0),
        Vec3i::new(-1, 0, 0),
        Vec3i::new(0, 1, 0),
        Vec3i::new(0, -1, 0),
    ] {
        if send_command_recorded(
            &mut sim,
            &mut recorder,
            WorldCommand::MoveEntity { id, direction },
        )
        .is_ok()
        {
            ok = true;
            break;
        }
    }
    assert!(ok, "move should succeed after reload");
    step_until_idle_recorded(&mut sim, &mut recorder, id, 256).expect("idle");
    assert_ne!(world_state_hash(&sim.snapshot()), hash_blocked);

    finish_and_verify_replay(&sim, recorder).expect("chunk gate replay");
}

#[test]
fn multi_chunk_stream_record_replay() {
    let config = WorldConfig {
        chunk_edge: 16,
        world_chunks: Vec3u::new(2, 2, 1),
        ..WorldConfig::default()
    };
    let mut sim = WorldSim::new(config.clone(), true);
    let mut recorder = WorldReplayRecorder::new(
        "multi_chunk_stream",
        config,
        true,
        WorldReplayRecorderOptions {
            checkpoint_interval_ticks: 8,
        },
        sim.snapshot(),
    );

    let id = 1;
    // Ensure neighboring chunks stay loaded (default 2x2 should load all).
    assert!(sim.snapshot().loaded_chunks.len() >= 2);

    for _ in 0..3 {
        let dirs = [
            Vec3i::new(1, 0, 0),
            Vec3i::new(0, 1, 0),
            Vec3i::new(-1, 0, 0),
            Vec3i::new(0, -1, 0),
        ];
        let mut stepped = false;
        for direction in dirs {
            if send_command_recorded(
                &mut sim,
                &mut recorder,
                WorldCommand::MoveEntity { id, direction },
            )
            .is_ok()
            {
                step_until_idle_recorded(&mut sim, &mut recorder, id, 256).expect("idle");
                stepped = true;
                break;
            }
        }
        assert!(stepped, "expected a successful move in streaming world");
    }

    finish_and_verify_replay(&sim, recorder).expect("multi-chunk replay");
}

#[test]
fn boot_hash_fixture_smoke() {
    // Ensures encoding path runs on a real populated snapshot.
    let snap = WorldSim::new(WorldConfig::default(), true).snapshot();
    let hash = world_state_hash(&snap);
    assert_eq!(hash.len(), "fnv1a64:".len() + 16);
}
