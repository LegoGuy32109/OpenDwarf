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

use crate::world::chunk::{CHUNK_VOLUME, VISIBILITY_WORDS};
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

/// Per-entity visibility/memory state (bitmap form lands in Stage 5).
///
/// Introduced in Stage 3 so projection can mark it dirty at tick exit;
/// full bitmap FOV recomputation is Stage 5 work. Perspective memory
/// reserves `0` for unknown and stores `BlockType as u8 + 1`.
#[derive(Debug, Clone)]
pub struct EntityPerspective {
    pub visible: HashMap<Vec3i, [u64; VISIBILITY_WORDS]>,
    pub memory: HashMap<Vec3i, Box<[u8; CHUNK_VOLUME]>>,
    pub visibility_revision_by_column: HashMap<(i32, i32), u64>,
    /// Observability only; never used as a broad cache key.
    pub fov_revision: u64,
    pub fov_dirty: bool,
    pub fov_recompute_count: u64,
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
