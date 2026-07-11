//! Canonical `world_state_hash` encoding (not serde/bincode).
//!
//! Layout is normative in `docs/design/sim-replay.md` §5.
//!
//! Terrain generation still uses f64 noise in `od_world`; native↔wasm hash
//! parity for terrain is an accepted Increment 2 risk — prefer a dedicated
//! noise crate later if cross-target equality is required.

use std::hash::Hasher;

use crate::canonicalize_f32;
use crate::format_state_hash;
use crate::FnvHasher;
use crate::StateHash;
use crate::world::{BlockType, WorldSnapshot};

/// Version byte prefix for the canonical snapshot encoding.
pub const WORLD_SNAPSHOT_ENCODING_VERSION: u32 = 1;

fn write_u8(out: &mut Vec<u8>, value: u8) {
    out.push(value);
}

fn write_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn write_u64(out: &mut Vec<u8>, value: u64) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn write_i32(out: &mut Vec<u8>, value: i32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn write_f32(out: &mut Vec<u8>, value: f32) {
    let bits = canonicalize_f32(value).to_bits();
    out.extend_from_slice(&bits.to_le_bytes());
}

fn write_bool_u8(out: &mut Vec<u8>, value: bool) {
    write_u8(out, u8::from(value));
}

fn block_type_byte(block: BlockType) -> u8 {
    match block {
        BlockType::Air => 0,
        BlockType::SolidStone => 1,
    }
}

/// Encode a v1 snapshot to the canonical little-endian byte layout.
#[must_use]
pub fn encode_world_snapshot_canonical(snapshot: &WorldSnapshot) -> Vec<u8> {
    let mut out = Vec::new();
    write_u32(&mut out, WORLD_SNAPSHOT_ENCODING_VERSION);
    write_u64(&mut out, snapshot.tick);
    write_u32(&mut out, snapshot.chunk_edge);
    write_u32(&mut out, snapshot.world_chunks.x);
    write_u32(&mut out, snapshot.world_chunks.y);
    write_u32(&mut out, snapshot.world_chunks.z);

    write_u32(
        &mut out,
        u32::try_from(snapshot.loaded_chunks.len()).expect("loaded_chunks len fits u32"),
    );
    for chunk in &snapshot.loaded_chunks {
        write_i32(&mut out, chunk.x);
        write_i32(&mut out, chunk.y);
        write_i32(&mut out, chunk.z);
    }

    write_u32(
        &mut out,
        u32::try_from(snapshot.terrain_blocks.len()).expect("terrain len fits u32"),
    );
    for (pos, block) in &snapshot.terrain_blocks {
        write_i32(&mut out, pos.x);
        write_i32(&mut out, pos.y);
        write_i32(&mut out, pos.z);
        write_u8(&mut out, block_type_byte(*block));
    }

    write_u32(
        &mut out,
        u32::try_from(snapshot.entities.len()).expect("entity len fits u32"),
    );
    for entity in &snapshot.entities {
        write_u64(&mut out, entity.id);
        write_i32(&mut out, entity.position.x);
        write_i32(&mut out, entity.position.y);
        write_i32(&mut out, entity.position.z);
        write_bool_u8(&mut out, entity.facing_left);
        write_bool_u8(&mut out, entity.is_prone);
        write_bool_u8(&mut out, entity.movement.is_some());
        if let Some(movement) = &entity.movement {
            write_i32(&mut out, movement.origin.x);
            write_i32(&mut out, movement.origin.y);
            write_i32(&mut out, movement.origin.z);
            write_i32(&mut out, movement.target.x);
            write_i32(&mut out, movement.target.y);
            write_i32(&mut out, movement.target.z);
            write_f32(&mut out, movement.start_position[0]);
            write_f32(&mut out, movement.start_position[1]);
            write_f32(&mut out, movement.start_position[2]);
            write_u8(&mut out, movement.progress_percent);
            write_bool_u8(&mut out, movement.occupies_origin);
            write_bool_u8(&mut out, movement.occupies_target);
        }
    }

    out
}

/// FNV-1a `StateHash` over the canonical snapshot encoding.
#[must_use]
pub fn world_state_hash(snapshot: &WorldSnapshot) -> StateHash {
    let bytes = encode_world_snapshot_canonical(snapshot);
    let mut hasher = FnvHasher::new();
    hasher.write(&bytes);
    format_state_hash(hasher.finish())
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use super::*;
    use crate::world::{EntitySnapshot, Vec3i, Vec3u};

    fn empty_snapshot() -> WorldSnapshot {
        WorldSnapshot {
            tick: 0,
            chunk_edge: 16,
            world_chunks: Vec3u::new(1, 1, 1),
            terrain_blocks: BTreeMap::new(),
            loaded_chunks: BTreeSet::new(),
            entities: Vec::new(),
        }
    }

    #[test]
    fn empty_hash_is_stable() {
        let a = world_state_hash(&empty_snapshot());
        let b = world_state_hash(&empty_snapshot());
        assert_eq!(a, b);
        assert!(a.starts_with("fnv1a64:"));
    }

    #[test]
    fn tick_changes_hash() {
        let mut snap = empty_snapshot();
        let h0 = world_state_hash(&snap);
        snap.tick = 1;
        assert_ne!(h0, world_state_hash(&snap));
    }

    #[test]
    fn entity_order_normalized_by_id_sort_in_snapshot() {
        // Snapshot builder is expected to sort; encoder iterates as given.
        let mut snap = empty_snapshot();
        snap.entities = vec![
            EntitySnapshot {
                id: 2,
                position: Vec3i::ZERO,
                facing_left: false,
                is_prone: false,
                movement: None,
            },
            EntitySnapshot {
                id: 1,
                position: Vec3i::new(1, 0, 0),
                facing_left: true,
                is_prone: false,
                movement: None,
            },
        ];
        let unsorted = world_state_hash(&snap);
        snap.entities.sort_by_key(|e| e.id);
        let sorted = world_state_hash(&snap);
        assert_ne!(
            unsorted, sorted,
            "encoder is order-sensitive; callers must sort entities"
        );
    }

    #[test]
    fn signed_zero_start_position_canonicalizes() {
        use crate::world::EntityMovementSnapshot;
        let mut a = empty_snapshot();
        a.entities.push(EntitySnapshot {
            id: 1,
            position: Vec3i::ZERO,
            facing_left: false,
            is_prone: false,
            movement: Some(EntityMovementSnapshot {
                origin: Vec3i::ZERO,
                target: Vec3i::new(1, 0, 0),
                start_position: [0.0, 0.0, 0.0],
                progress_percent: 0,
                occupies_origin: true,
                occupies_target: false,
            }),
        });
        let mut b = a.clone();
        b.entities[0].movement.as_mut().unwrap().start_position[0] = -0.0;
        assert_eq!(world_state_hash(&a), world_state_hash(&b));
    }
}
