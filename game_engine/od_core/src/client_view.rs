//! Locally projected, read-optimized client view of the world (Stage 3).
//!
//! `ClientView` holds game data projected from the authoritative
//! `WorldState` after fixed ticks (or lifecycle rebuilds). It is a local
//! lookup structure, **not** the future network wire format. Render-side
//! caches (topmost, emission) intentionally live elsewhere.
//!
//! Lookup is fail-closed: a missing chunk returns [`None`] and callers must
//! treat the data as absent (render skips, LOS treats it as opaque).

use std::collections::HashMap;

use crate::world::chunk::{CHUNK_VOLUME, VISIBILITY_WORDS, position_to_chunk_voxel_unbounded};
use crate::world::{BlockType, Vec3i, Vec3u, world_position_to_chunk_voxel};

/// One projected fixed-edge chunk: typed block copy plus the authoritative
/// terrain revision it was copied from.
#[derive(Debug, Clone)]
pub struct ChunkView {
    pub blocks: Box<[BlockType; CHUNK_VOLUME]>,
    pub terrain_revision: u64,
}

/// One projected entity with client-owned interpolation history.
///
/// `prev_xy`/`curr_xy` are render positions captured at fixed-tick
/// boundaries; the authoritative state never stores render history.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EntityView {
    pub id: u64,
    pub prev_xy: [f32; 2],
    pub curr_xy: [f32; 2],
    pub position: Vec3i,
    pub facing_left: bool,
}

/// Locally projected world data consumed by the (future) client renderer.
///
/// `chunks` uses `HashMap` for local lookup only; deterministic iteration
/// follows the `BTreeSet`-ordered projection window, never map order.
#[derive(Debug, Clone, Default)]
pub struct ClientView {
    pub tick: u64,
    pub world_chunks: Vec3u,
    pub chunks: HashMap<Vec3i, ChunkView>,
    pub entities: Vec<EntityView>,
    pub primary_entity_id: Option<u64>,
}

impl ClientView {
    /// Block lookup that fails closed: [`None`] when the position is outside
    /// the world or its chunk is not projected.
    #[must_use]
    pub fn block_at(&self, position: Vec3i) -> Option<BlockType> {
        let (chunk, voxel) = world_position_to_chunk_voxel(position, self.world_chunks)?;
        self.chunks.get(&chunk).map(|view| view.blocks[voxel])
    }

    /// Projected entity by id (entities are kept sorted by id).
    #[must_use]
    pub fn entity(&self, id: u64) -> Option<&EntityView> {
        self.entities
            .binary_search_by_key(&id, |entity| entity.id)
            .ok()
            .map(|index| &self.entities[index])
    }
}

/// Per-entity visibility/memory state (Stage 5 bitmap form).
///
/// `visible` holds one bit per voxel for every chunk with at least one
/// currently visible tile; `memory` persists per-chunk remembered blocks
/// (`0` = unknown, else `BlockType as u8 + 1`). Both maps are keyed by the
/// **unbounded** chunk grid (`position_to_chunk_voxel_unbounded`) because
/// the FOV sphere legitimately reaches out-of-world air.
///
/// Recomputation happens at tick exit / lifecycle / explicit view-mode
/// changes only; render receives the perspective immutably. Memory chunks
/// are independent of `ClientView` residency, so projection stream-out/in
/// never erases them.
#[derive(Debug, Clone)]
pub struct EntityPerspective {
    pub visible: HashMap<Vec3i, [u64; VISIBILITY_WORDS]>,
    pub memory: HashMap<Vec3i, Box<[u8; CHUNK_VOLUME]>>,
    /// Bumped only for XY chunk columns whose paint result (visible bits or
    /// memory bytes) changed during a recompute/clear.
    pub visibility_revision_by_column: HashMap<(i32, i32), u64>,
    /// Observability only; never used as a broad cache key.
    pub fov_revision: u64,
    pub fov_dirty: bool,
    pub fov_recompute_count: u64,
}

/// Perspective memory byte for a known block (`0` is reserved for unknown).
#[must_use]
pub const fn encode_memory_block(block: BlockType) -> u8 {
    block as u8 + 1
}

/// Inverse of [`encode_memory_block`]; `0`/invalid bytes decode to [`None`].
#[must_use]
pub const fn decode_memory_block(byte: u8) -> Option<BlockType> {
    match byte {
        1 => Some(BlockType::Air),
        2 => Some(BlockType::SolidStone),
        _ => None,
    }
}

impl Default for EntityPerspective {
    fn default() -> Self {
        Self {
            visible: HashMap::new(),
            memory: HashMap::new(),
            visibility_revision_by_column: HashMap::new(),
            fov_revision: 0,
            // A fresh perspective has never been computed.
            fov_dirty: true,
            fov_recompute_count: 0,
        }
    }
}

impl EntityPerspective {
    /// Lifecycle reset: forget visibility/memory and require a recompute.
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    /// Whether `position` is currently visible (unbounded-grid lookup).
    #[must_use]
    pub fn is_visible(&self, position: Vec3i, dims: Vec3u) -> bool {
        let Some((chunk, voxel)) = position_to_chunk_voxel_unbounded(position, dims) else {
            return false;
        };
        self.visible
            .get(&chunk)
            .is_some_and(|bits| bits[voxel / 64] & (1 << (voxel % 64)) != 0)
    }

    /// Remembered block at `position`, or [`None`] when unknown.
    #[must_use]
    pub fn remembered_block(&self, position: Vec3i, dims: Vec3u) -> Option<BlockType> {
        let (chunk, voxel) = position_to_chunk_voxel_unbounded(position, dims)?;
        decode_memory_block(self.memory.get(&chunk)?[voxel])
    }

    /// Total currently visible tiles (sum of bitmap popcounts).
    #[must_use]
    pub fn visible_tile_count(&self) -> usize {
        self.visible
            .values()
            .map(|bits| {
                bits.iter()
                    .map(|word| word.count_ones() as usize)
                    .sum::<usize>()
            })
            .sum()
    }

    /// Total remembered tiles (nonzero memory bytes).
    #[must_use]
    pub fn remembered_tile_count(&self) -> usize {
        self.memory
            .values()
            .map(|blob| blob.iter().filter(|byte| **byte != 0).count())
            .sum()
    }

    /// Master-mode maintenance: clear all visible bits while preserving
    /// memory, bumping paint revisions only for columns that actually had
    /// visible tiles. Consumes the dirty flag; not counted as a recompute.
    pub fn clear_visible_preserve_memory(&mut self) {
        let mut columns: Vec<(i32, i32)> = self
            .visible
            .iter()
            .filter(|(_, bits)| bits.iter().any(|word| *word != 0))
            .map(|(chunk, _)| (chunk.x, chunk.y))
            .collect();
        columns.sort_unstable();
        columns.dedup();
        for column in columns {
            let revision = self
                .visibility_revision_by_column
                .entry(column)
                .or_insert(0);
            *revision = revision.saturating_add(1);
        }
        self.visible.clear();
        self.fov_dirty = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn block_at_fails_closed_for_missing_chunks_and_out_of_bounds() {
        let mut view = ClientView {
            world_chunks: Vec3u::new(1, 1, 1),
            ..ClientView::default()
        };
        // No chunks projected: in-bounds lookup fails closed.
        assert_eq!(view.block_at(Vec3i::ZERO), None);

        let mut blocks = Box::new([BlockType::Air; CHUNK_VOLUME]);
        blocks[0] = BlockType::SolidStone; // voxel 0 == world (-8, -8, -8)
        view.chunks.insert(
            Vec3i::ZERO,
            ChunkView {
                blocks,
                terrain_revision: 0,
            },
        );
        assert_eq!(
            view.block_at(Vec3i::new(-8, -8, -8)),
            Some(BlockType::SolidStone)
        );
        assert_eq!(view.block_at(Vec3i::ZERO), Some(BlockType::Air));
        // Outside the world: None even though a chunk is present.
        assert_eq!(view.block_at(Vec3i::new(8, 0, 0)), None);
    }

    #[test]
    fn default_client_view_is_empty_and_fails_closed() {
        let view = ClientView::default();
        assert_eq!(view.tick, 0);
        assert!(view.chunks.is_empty());
        assert!(view.entities.is_empty());
        assert_eq!(view.primary_entity_id, None);
        assert_eq!(view.block_at(Vec3i::ZERO), None);
        assert_eq!(view.entity(1), None);
    }

    #[test]
    fn entity_lookup_uses_sorted_ids() {
        let entity = |id: u64| EntityView {
            id,
            prev_xy: [0.0, 0.0],
            curr_xy: [0.0, 0.0],
            position: Vec3i::ZERO,
            facing_left: false,
        };
        let view = ClientView {
            entities: vec![entity(1), entity(3), entity(7)],
            ..ClientView::default()
        };
        assert_eq!(view.entity(3).map(|e| e.id), Some(3));
        assert_eq!(view.entity(2), None);
    }

    #[test]
    fn perspective_bitmap_and_memory_lookups_round_trip() {
        let dims = Vec3u::new(1, 1, 1);
        let mut perspective = EntityPerspective::default();
        let inside = Vec3i::new(3, -2, 0);
        let outside = Vec3i::new(20, 0, 0); // beyond the 16^3 world
        for position in [inside, outside] {
            let (chunk, voxel) = position_to_chunk_voxel_unbounded(position, dims).expect("mapped");
            let bits = perspective
                .visible
                .entry(chunk)
                .or_insert([0; VISIBILITY_WORDS]);
            bits[voxel / 64] |= 1 << (voxel % 64);
        }
        assert!(perspective.is_visible(inside, dims));
        assert!(perspective.is_visible(outside, dims));
        assert!(!perspective.is_visible(Vec3i::new(4, -2, 0), dims));
        assert_eq!(perspective.visible_tile_count(), 2);

        let remembered = Vec3i::new(-5, 5, 1);
        let (chunk, voxel) = position_to_chunk_voxel_unbounded(remembered, dims).expect("mapped");
        let blob = perspective
            .memory
            .entry(chunk)
            .or_insert_with(|| Box::new([0; CHUNK_VOLUME]));
        blob[voxel] = encode_memory_block(BlockType::SolidStone);
        assert_eq!(
            perspective.remembered_block(remembered, dims),
            Some(BlockType::SolidStone)
        );
        assert_eq!(perspective.remembered_block(inside, dims), None);
        assert_eq!(perspective.remembered_tile_count(), 1);
        assert_eq!(
            decode_memory_block(encode_memory_block(BlockType::Air)),
            Some(BlockType::Air)
        );
        assert_eq!(decode_memory_block(0), None);
    }

    #[test]
    fn clear_visible_preserves_memory_and_bumps_only_touched_columns() {
        let dims = Vec3u::new(9, 9, 1);
        let mut perspective = EntityPerspective::default();
        let seen = Vec3i::new(0, 0, 0); // chunk (0, 0, 0)
        let (chunk, voxel) = position_to_chunk_voxel_unbounded(seen, dims).expect("mapped");
        perspective
            .visible
            .entry(chunk)
            .or_insert([0; VISIBILITY_WORDS])[voxel / 64] |= 1 << (voxel % 64);
        let remembered = Vec3i::new(40, 40, 0); // chunk (3, 3, 0)
        let (chunk, voxel) = position_to_chunk_voxel_unbounded(remembered, dims).expect("mapped");
        perspective
            .memory
            .entry(chunk)
            .or_insert_with(|| Box::new([0; CHUNK_VOLUME]))[voxel] =
            encode_memory_block(BlockType::Air);
        perspective.fov_dirty = true;

        perspective.clear_visible_preserve_memory();

        assert_eq!(perspective.visible_tile_count(), 0);
        assert_eq!(perspective.remembered_tile_count(), 1);
        assert!(!perspective.fov_dirty);
        assert_eq!(
            perspective.visibility_revision_by_column.get(&(0, 0)),
            Some(&1),
            "the cleared column's paint changed"
        );
        assert_eq!(
            perspective.visibility_revision_by_column.get(&(3, 3)),
            None,
            "memory-only columns did not change paint"
        );

        // Clearing an already-clear perspective bumps nothing.
        perspective.clear_visible_preserve_memory();
        assert_eq!(
            perspective.visibility_revision_by_column.get(&(0, 0)),
            Some(&1)
        );
    }

    #[test]
    fn fresh_perspective_is_dirty_with_zero_counters() {
        let perspective = EntityPerspective::default();
        assert!(perspective.fov_dirty);
        assert_eq!(perspective.fov_revision, 0);
        assert_eq!(perspective.fov_recompute_count, 0);
        assert!(perspective.visible.is_empty());
        assert!(perspective.memory.is_empty());
        assert!(perspective.visibility_revision_by_column.is_empty());
    }
}
