//! ClientView projection and tick-time entity perspective (Stages 3 + 5).
//!
//! Computes the local projection window from `LocalWorldView`, synchronizes
//! projected chunk copies against authoritative `WorldState`, projects
//! entities with client-owned interpolation history, and (Stage 5) owns the
//! tick-exit FOV recomputation that fills the [`EntityPerspective`] bitmaps
//! and persistent memory consumed immutably by `crate::render`.
//!
//! Cameras never mutate authoritative residency here: a desired chunk that is
//! not simulation-resident is counted as `authority_missing` and removed from
//! the ClientView so stale data never remains renderable (fail closed).

use std::collections::{BTreeSet, HashMap};

use od_core::client_view::{
    ChunkView, ClientView, EntityPerspective, EntityView, encode_memory_block,
};
use od_core::world::chunk::{
    CHUNK_VOLUME, SUPPORTED_CHUNK_EDGE, VISIBILITY_WORDS, chunk_coord_to_index,
    chunk_min_world_position, chunk_min_world_position_unbounded,
    position_to_chunk_voxel_unbounded, world_position_to_chunk_voxel,
};
use od_core::{BlockType, LocalWorldView, Vec3i, Vec3u, WorldViewMode};

use crate::WorldState;
use crate::render::{entity_render_position_xy, primary_entity, projected_block_at};

/// Must match the renderer's world-space tile size (`od_world::render`).
const TILE_SIZE_PX: f32 = 64.0;
/// Must match the renderer's topmost scan depth (`od_world::render`).
const Z_LEVELS_BELOW: i32 = 5;
/// Must match the renderer's FOV radius (`od_world::render`); radius 20 can
/// intersect up to 4 chunks per axis with the fixed 16 edge.
const FOV_RADIUS: i32 = 20;
/// Extra chunk ring kept projection-resident around the visible window.
const RENDER_PADDING_CHUNKS: i32 = 1;

/// Local projection window: what may emit this frame and what must stay
/// projected (visible + padding ring + entity-mode FOV support).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProjectionWindow {
    pub visible: BTreeSet<Vec3i>,
    pub resident: BTreeSet<Vec3i>,
}

/// Why chunk synchronization performed work (test/debug observability).
#[derive(Default, Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProjectionSyncStats {
    pub inserted: u32,
    pub recopied: u32,
    pub removed: u32,
    pub unchanged: u32,
    pub authority_missing: u32,
}

/// Compute the visible and projection-resident chunk windows for `view`.
///
/// - `visible`: chunks whose columns may emit this frame — the camera XY
///   rectangle at every z-chunk layer intersecting the scanned slice
///   `[view_z - Z_LEVELS_BELOW, view_z]`.
/// - `resident`: `visible` plus one render padding ring (XY) plus, in entity
///   mode only, every chunk intersecting the primary entity's 3D FOV sphere.
///   Master mode retains no player-FOV ring.
///
/// Both sets are clipped to the world chunk grid.
#[must_use]
pub fn compute_projection_window(
    view: &LocalWorldView,
    world_chunks: Vec3u,
    primary_position: Option<Vec3i>,
    framebuffer: (u32, u32),
) -> ProjectionWindow {
    let visible = camera_chunk_window(view, world_chunks, framebuffer, 0);
    let mut resident = camera_chunk_window(view, world_chunks, framebuffer, RENDER_PADDING_CHUNKS);
    if view.view_mode == WorldViewMode::Entity
        && let Some(position) = primary_position
    {
        add_fov_support_chunks(&mut resident, world_chunks, position);
    }
    ProjectionWindow { visible, resident }
}

/// Synchronize projected chunk copies against the authoritative state.
///
/// Iterates `desired` in `BTreeSet` order for a fixed projection order.
/// Drops chunks that left the window or are no longer simulation-resident
/// (the latter also counts `authority_missing`), inserts missing chunks with
/// one typed copy, and recopies only when that chunk's terrain revision
/// changed. Only simulation-resident (`is_chunk_loaded`) chunks are copied.
pub fn sync_view_chunks(
    client: &mut ClientView,
    world: &WorldState,
    desired: &BTreeSet<Vec3i>,
) -> ProjectionSyncStats {
    let mut stats = ProjectionSyncStats::default();

    // Drop chunks that are no longer desired.
    let mut stale: Vec<Vec3i> = client
        .chunks
        .keys()
        .copied()
        .filter(|chunk| !desired.contains(chunk))
        .collect();
    stale.sort_unstable();
    for chunk in stale {
        client.chunks.remove(&chunk);
        stats.removed = stats.removed.saturating_add(1);
    }

    for &chunk in desired {
        if !world.is_chunk_loaded(chunk) {
            // Not simulation-resident (or out of grid): fail closed. Stale
            // authoritative data must never remain renderable.
            stats.authority_missing = stats.authority_missing.saturating_add(1);
            if client.chunks.remove(&chunk).is_some() {
                stats.removed = stats.removed.saturating_add(1);
            }
            continue;
        }
        let Some(revision) = world.chunk_terrain_revision(chunk) else {
            // Unreachable when loaded, but never index a phantom chunk.
            stats.authority_missing = stats.authority_missing.saturating_add(1);
            if client.chunks.remove(&chunk).is_some() {
                stats.removed = stats.removed.saturating_add(1);
            }
            continue;
        };
        if let Some(view) = client.chunks.get_mut(&chunk) {
            if view.terrain_revision == revision {
                stats.unchanged = stats.unchanged.saturating_add(1);
            } else if world.copy_chunk_blocks(chunk, &mut view.blocks) {
                view.terrain_revision = revision;
                stats.recopied = stats.recopied.saturating_add(1);
            }
        } else {
            let mut blocks = Box::new([BlockType::Air; CHUNK_VOLUME]);
            if world.copy_chunk_blocks(chunk, &mut blocks) {
                client.chunks.insert(
                    chunk,
                    ChunkView {
                        blocks,
                        terrain_revision: revision,
                    },
                );
                stats.inserted = stats.inserted.saturating_add(1);
            }
        }
    }
    stats
}

/// Project entities into the ClientView, preserving interpolation history.
///
/// For every live entity the previous ClientView `curr_xy` is shifted into
/// `prev_xy` and the new render position becomes `curr_xy`; an entity seen
/// for the first time starts with `prev_xy == curr_xy`. Despawned entities
/// are dropped and the result is sorted by id.
pub fn project_entities(
    client: &mut ClientView,
    world: &WorldState,
    primary_entity_id: Option<u64>,
) {
    let previous: HashMap<u64, [f32; 2]> = client
        .entities
        .iter()
        .map(|entity| (entity.id, entity.curr_xy))
        .collect();
    let mut entities: Vec<EntityView> = world
        .entity_snapshots()
        .map(|snapshot| {
            let curr_xy = entity_render_position_xy(&snapshot);
            let prev_xy = previous.get(&snapshot.id).copied().unwrap_or(curr_xy);
            EntityView {
                id: snapshot.id,
                prev_xy,
                curr_xy,
                position: snapshot.position,
                facing_left: snapshot.facing_left,
            }
        })
        .collect();
    entities.sort_by_key(|entity| entity.id);
    client.entities = entities;
    client.primary_entity_id = primary_entity_id;
}

/// Chunks of the single z-chunk layer containing `view_z` covered by the
/// camera rectangle, with no padding: the visible-chunk window consumed by
/// floor emission (exactly one entry per emitted XY column).
///
/// This intentionally differs from [`ProjectionWindow::visible`], which also
/// spans the z-chunks of the scanned topmost slice for residency purposes;
/// emission iterates XY columns and must not receive z duplicates.
#[must_use]
pub fn visible_chunk_layer(
    view: &LocalWorldView,
    world_chunks: Vec3u,
    framebuffer: (u32, u32),
) -> BTreeSet<Vec3i> {
    let mut chunks = BTreeSet::new();
    let Some((world_min, world_max)) = centered_world_bounds(world_chunks) else {
        return chunks;
    };
    if view.view_z < world_min.z || view.view_z > world_max.z {
        return chunks;
    }
    let Some((min_x, max_x, min_y, max_y)) =
        camera_tile_rect(view, world_min, world_max, framebuffer)
    else {
        return chunks;
    };
    let Some((min_chunk, _)) =
        world_position_to_chunk_voxel(Vec3i::new(min_x, min_y, view.view_z), world_chunks)
    else {
        return chunks;
    };
    let Some((max_chunk, _)) =
        world_position_to_chunk_voxel(Vec3i::new(max_x, max_y, view.view_z), world_chunks)
    else {
        return chunks;
    };
    for cy in min_chunk.y..=max_chunk.y {
        for cx in min_chunk.x..=max_chunk.x {
            chunks.insert(Vec3i::new(cx, cy, min_chunk.z));
        }
    }
    chunks
}

/// World-clipped tile rectangle covered by the camera, or [`None`] when the
/// camera sees no in-world tiles.
fn camera_tile_rect(
    view: &LocalWorldView,
    world_min: Vec3i,
    world_max: Vec3i,
    framebuffer: (u32, u32),
) -> Option<(i32, i32, i32, i32)> {
    let zoom = view.camera.zoom.max(0.01);
    let framebuffer_w = framebuffer.0.max(1) as f32;
    let framebuffer_h = framebuffer.1.max(1) as f32;
    let half_w_tiles = framebuffer_w / (2.0 * zoom * TILE_SIZE_PX);
    let half_h_tiles = framebuffer_h / (2.0 * zoom * TILE_SIZE_PX);
    let center_x = view.camera.x / TILE_SIZE_PX;
    let center_y = view.camera.y / TILE_SIZE_PX;
    let min_x = ((center_x - half_w_tiles).floor() as i32).max(world_min.x);
    let max_x = ((center_x + half_w_tiles).floor() as i32).min(world_max.x);
    let min_y = ((center_y - half_h_tiles).floor() as i32).max(world_min.y);
    let max_y = ((center_y + half_h_tiles).floor() as i32).min(world_max.y);
    if min_x > max_x || min_y > max_y {
        return None;
    }
    Some((min_x, max_x, min_y, max_y))
}

/// Centered world voxel bounds for a chunk grid (see `od_core::world::chunk`).
fn centered_world_bounds(dims: Vec3u) -> Option<(Vec3i, Vec3i)> {
    let axis = |dim: u32| -> Option<(i32, i32)> {
        if dim == 0 {
            return None;
        }
        let size = i32::try_from(dim.checked_mul(SUPPORTED_CHUNK_EDGE)?).ok()?;
        let min = -(size / 2);
        Some((min, min + size - 1))
    };
    let (min_x, max_x) = axis(dims.x)?;
    let (min_y, max_y) = axis(dims.y)?;
    let (min_z, max_z) = axis(dims.z)?;
    Some((
        Vec3i::new(min_x, min_y, min_z),
        Vec3i::new(max_x, max_y, max_z),
    ))
}

/// Chunks covered by the camera rectangle (with `padding_chunks` XY padding)
/// across the scanned z slice, clipped to the world grid.
fn camera_chunk_window(
    view: &LocalWorldView,
    world_chunks: Vec3u,
    framebuffer: (u32, u32),
    padding_chunks: i32,
) -> BTreeSet<Vec3i> {
    let mut chunks = BTreeSet::new();
    let Some((world_min, world_max)) = centered_world_bounds(world_chunks) else {
        return chunks;
    };
    if view.view_z < world_min.z || view.view_z > world_max.z {
        return chunks;
    }

    let Some((min_x, max_x, min_y, max_y)) =
        camera_tile_rect(view, world_min, world_max, framebuffer)
    else {
        return chunks;
    };

    // Topmost emission scans [view_z - Z_LEVELS_BELOW, view_z]; that slice
    // spans at most two z-chunks with the fixed 16 edge.
    let z_lo = (view.view_z - Z_LEVELS_BELOW).max(world_min.z);
    let Some((min_chunk, _)) =
        world_position_to_chunk_voxel(Vec3i::new(min_x, min_y, z_lo), world_chunks)
    else {
        return chunks;
    };
    let Some((max_chunk, _)) =
        world_position_to_chunk_voxel(Vec3i::new(max_x, max_y, view.view_z), world_chunks)
    else {
        return chunks;
    };

    for cz in min_chunk.z..=max_chunk.z {
        for cy in (min_chunk.y - padding_chunks)..=(max_chunk.y + padding_chunks) {
            for cx in (min_chunk.x - padding_chunks)..=(max_chunk.x + padding_chunks) {
                let chunk = Vec3i::new(cx, cy, cz);
                if chunk_coord_to_index(chunk, world_chunks).is_some() {
                    chunks.insert(chunk);
                }
            }
        }
    }
    chunks
}

/// Union every in-bounds chunk whose voxel AABB intersects the primary
/// entity's FOV sphere into `resident`.
fn add_fov_support_chunks(resident: &mut BTreeSet<Vec3i>, dims: Vec3u, position: Vec3i) {
    let Some((world_min, _)) = centered_world_bounds(dims) else {
        return;
    };
    let edge = i32::try_from(SUPPORTED_CHUNK_EDGE).expect("chunk edge fits in i32");
    let radius_sq = FOV_RADIUS * FOV_RADIUS;
    // Candidate centered chunk coordinate range per axis, clipped to the grid.
    let axis_range = |lo: i32, hi: i32, min: i32, dim: u32| -> std::ops::RangeInclusive<i32> {
        let dim_i = i32::try_from(dim).unwrap_or(0);
        let center = dim_i / 2;
        let grid_lo = -center;
        let grid_hi = dim_i - 1 - center;
        let chunk_lo = (lo.saturating_sub(min)).div_euclid(edge) - center;
        let chunk_hi = (hi.saturating_sub(min)).div_euclid(edge) - center;
        chunk_lo.max(grid_lo)..=chunk_hi.min(grid_hi)
    };
    let range_x = axis_range(
        position.x - FOV_RADIUS,
        position.x + FOV_RADIUS,
        world_min.x,
        dims.x,
    );
    let range_y = axis_range(
        position.y - FOV_RADIUS,
        position.y + FOV_RADIUS,
        world_min.y,
        dims.y,
    );
    let range_z = axis_range(
        position.z - FOV_RADIUS,
        position.z + FOV_RADIUS,
        world_min.z,
        dims.z,
    );
    for cz in range_z {
        for cy in range_y.clone() {
            for cx in range_x.clone() {
                let chunk = Vec3i::new(cx, cy, cz);
                let Some(base) = chunk_min_world_position(chunk, dims) else {
                    continue;
                };
                // Closest voxel of the chunk AABB to the sphere center.
                let dx = position.x - position.x.clamp(base.x, base.x + edge - 1);
                let dy = position.y - position.y.clamp(base.y, base.y + edge - 1);
                let dz = position.z - position.z.clamp(base.z, base.z + edge - 1);
                if dx * dx + dy * dy + dz * dz <= radius_sq {
                    resident.insert(chunk);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Stage 5: tick-time FOV recomputation over per-chunk bitmaps.
// ---------------------------------------------------------------------------

/// One pre-resolved FOV chunk slot.
enum FovSlot<'a> {
    /// Entirely outside the world: known void (transparent air).
    OutOfWorld,
    /// In the world but missing from the projection: fail closed (opaque
    /// for LOS, unknown for memory).
    Missing,
    /// Projected chunk blocks resolved once before ray traversal.
    Loaded(&'a [BlockType; CHUNK_VOLUME]),
}

/// Pre-resolved chunk slots covering the FOV working box
/// `[origin - (FOV_RADIUS + 1), origin + (FOV_RADIUS + 1)]` (the `+ 1` also
/// covers wall-reveal neighbors and the lower-half `z - 1` extension).
///
/// With radius 20 and the fixed 16 edge the box spans at most 4 chunks per
/// axis, so at most 64 slots are resolved once; DDA rays then index into
/// slots with shifts/masks instead of one `HashMap` lookup per step.
struct FovSlots<'a> {
    /// World position of the slot grid's minimum voxel (chunk aligned).
    grid_min_world: Vec3i,
    /// Chunk coordinate (unbounded grid) of slot `(0, 0, 0)`.
    base_chunk: Vec3i,
    /// Slots per axis.
    slot_dims: [i32; 3],
    slots: Vec<FovSlot<'a>>,
}

impl<'a> FovSlots<'a> {
    fn resolve(client: &'a ClientView, origin: Vec3i) -> Option<Self> {
        let dims = client.world_chunks;
        let reach = FOV_RADIUS + 1;
        let lo = Vec3i::new(origin.x - reach, origin.y - reach, origin.z - reach);
        let hi = Vec3i::new(origin.x + reach, origin.y + reach, origin.z + reach);
        let (lo_chunk, _) = position_to_chunk_voxel_unbounded(lo, dims)?;
        let (hi_chunk, _) = position_to_chunk_voxel_unbounded(hi, dims)?;
        let grid_min_world = chunk_min_world_position_unbounded(lo_chunk, dims)?;
        let slot_dims = [
            hi_chunk.x - lo_chunk.x + 1,
            hi_chunk.y - lo_chunk.y + 1,
            hi_chunk.z - lo_chunk.z + 1,
        ];
        let capacity = usize::try_from(slot_dims[0] * slot_dims[1] * slot_dims[2]).ok()?;
        let mut slots = Vec::with_capacity(capacity);
        for cz in lo_chunk.z..=hi_chunk.z {
            for cy in lo_chunk.y..=hi_chunk.y {
                for cx in lo_chunk.x..=hi_chunk.x {
                    let chunk = Vec3i::new(cx, cy, cz);
                    let slot = if chunk_coord_to_index(chunk, dims).is_none() {
                        FovSlot::OutOfWorld
                    } else {
                        match client.chunks.get(&chunk) {
                            Some(view) => FovSlot::Loaded(&view.blocks),
                            None => FovSlot::Missing,
                        }
                    };
                    slots.push(slot);
                }
            }
        }
        Some(Self {
            grid_min_world,
            base_chunk: lo_chunk,
            slot_dims,
            slots,
        })
    }

    /// `(slot index, voxel index)` for an in-box position.
    fn slot_voxel(&self, pos: Vec3i) -> Option<(usize, usize)> {
        let rel_x = pos.x.checked_sub(self.grid_min_world.x)?;
        let rel_y = pos.y.checked_sub(self.grid_min_world.y)?;
        let rel_z = pos.z.checked_sub(self.grid_min_world.z)?;
        if rel_x < 0
            || rel_y < 0
            || rel_z < 0
            || rel_x >= self.slot_dims[0] * 16
            || rel_y >= self.slot_dims[1] * 16
            || rel_z >= self.slot_dims[2] * 16
        {
            return None;
        }
        let slot =
            ((rel_z >> 4) * self.slot_dims[1] + (rel_y >> 4)) * self.slot_dims[0] + (rel_x >> 4);
        let voxel = ((rel_z & 15) << 8) | ((rel_y & 15) << 4) | (rel_x & 15);
        Some((usize::try_from(slot).ok()?, usize::try_from(voxel).ok()?))
    }

    /// Chunk coordinate (unbounded grid) of a slot index.
    fn chunk_coord(&self, slot: usize) -> Vec3i {
        let slot = i32::try_from(slot).expect("slot index fits in i32");
        let per_layer = self.slot_dims[0] * self.slot_dims[1];
        Vec3i::new(
            self.base_chunk.x + (slot % per_layer) % self.slot_dims[0],
            self.base_chunk.y + (slot % per_layer) / self.slot_dims[0],
            self.base_chunk.z + slot / per_layer,
        )
    }

    /// Fail-closed block lookup, semantically identical to
    /// [`projected_block_at`] (which handles the rare out-of-box positions
    /// reached by the previous-visible memory diff).
    fn block_at(&self, client: &ClientView, pos: Vec3i) -> Option<BlockType> {
        match self.slot_voxel(pos) {
            Some((slot, voxel)) => match &self.slots[slot] {
                FovSlot::OutOfWorld => Some(BlockType::Air),
                FovSlot::Missing => None,
                FovSlot::Loaded(blocks) => Some(blocks[voxel]),
            },
            None => projected_block_at(client, pos),
        }
    }

    fn known_solid(&self, client: &ClientView, pos: Vec3i) -> bool {
        self.block_at(client, pos) == Some(BlockType::SolidStone)
    }

    /// LOS blocker: known solid or an unexpectedly missing required chunk
    /// (fail closed). Out-of-world void stays transparent (legacy parity).
    fn opaque_for_los(&self, client: &ClientView, pos: Vec3i) -> bool {
        !matches!(self.block_at(client, pos), Some(BlockType::Air))
    }
}

/// Voxel-grid DDA line of sight over pre-resolved slots. The float math is
/// byte-identical to the legacy set-based implementation.
fn has_los(slots: &FovSlots<'_>, client: &ClientView, from: Vec3i, to: Vec3i) -> bool {
    if from == to {
        return true;
    }
    let dir_x = to.x as f32 + 0.5 - (from.x as f32 + 0.5);
    let dir_y = to.y as f32 + 0.5 - (from.y as f32 + 0.5);
    let dir_z = to.z as f32 + 0.5 - (from.z as f32 + 0.5);
    let step_x = if dir_x >= 0.0 { 1 } else { -1 };
    let step_y = if dir_y >= 0.0 { 1 } else { -1 };
    let step_z = if dir_z >= 0.0 { 1 } else { -1 };
    let t_delta_x = if dir_x == 0.0 {
        f32::INFINITY
    } else {
        1.0 / dir_x.abs()
    };
    let t_delta_y = if dir_y == 0.0 {
        f32::INFINITY
    } else {
        1.0 / dir_y.abs()
    };
    let t_delta_z = if dir_z == 0.0 {
        f32::INFINITY
    } else {
        1.0 / dir_z.abs()
    };
    let mut t_max_x = if dir_x == 0.0 {
        f32::INFINITY
    } else {
        0.5 / dir_x.abs()
    };
    let mut t_max_y = if dir_y == 0.0 {
        f32::INFINITY
    } else {
        0.5 / dir_y.abs()
    };
    let mut t_max_z = if dir_z == 0.0 {
        f32::INFINITY
    } else {
        0.5 / dir_z.abs()
    };
    let mut cursor = from;
    let max_steps = (from.x - to.x).abs() + (from.y - to.y).abs() + (from.z - to.z).abs() + 1;

    for _ in 0..max_steps {
        if t_max_x <= t_max_y && t_max_x <= t_max_z {
            cursor.x += step_x;
            t_max_x += t_delta_x;
        } else if t_max_y <= t_max_z {
            cursor.y += step_y;
            t_max_y += t_delta_y;
        } else {
            cursor.z += step_z;
            t_max_z += t_delta_z;
        }
        if cursor == to {
            return true;
        }
        if slots.opaque_for_los(client, cursor) {
            return false;
        }
    }
    true
}

/// Invoke `f` with the voxel index of every set bit.
fn for_each_set_bit(bits: &[u64; VISIBILITY_WORDS], mut f: impl FnMut(usize)) {
    for (word_index, word) in bits.iter().enumerate() {
        let mut word = *word;
        while word != 0 {
            let bit = word.trailing_zeros() as usize;
            f(word_index * 64 + bit);
            word &= word - 1;
        }
    }
}

const fn voxel_offsets(voxel: usize) -> (i32, i32, i32) {
    (
        (voxel & 15) as i32,
        ((voxel >> 4) & 15) as i32,
        (voxel >> 8) as i32,
    )
}

fn bitmap_get(bits: &[[u64; VISIBILITY_WORDS]], slot: usize, voxel: usize) -> bool {
    bits[slot][voxel / 64] & (1 << (voxel % 64)) != 0
}

fn bitmap_set(bits: &mut [[u64; VISIBILITY_WORDS]], slot: usize, voxel: usize) {
    bits[slot][voxel / 64] |= 1 << (voxel % 64);
}

/// Tick-time FOV recomputation (Stage 5).
///
/// Rebuilds the per-chunk visible bitmaps from the primary entity's radius-20
/// sphere (LOS + wall reveal + lower-half extension — value-identical to the
/// legacy set-based algorithm), moves tiles that left visibility into
/// persistent memory (known blocks only, fail closed), forgets memory for
/// tiles that became visible again, and bumps `visibility_revision_by_column`
/// only for XY chunk columns whose visible bits or memory bytes changed.
///
/// Counted in `fov_recompute_count`; consumes `fov_dirty`.
pub fn recompute_entity_perspective(perspective: &mut EntityPerspective, client: &ClientView) {
    let dims = client.world_chunks;
    let previous_visible = std::mem::take(&mut perspective.visible);
    let mut next_visible: HashMap<Vec3i, [u64; VISIBILITY_WORDS]> = HashMap::new();

    let origin = primary_entity(client).map(|entity| entity.position);
    if let Some(position) = origin
        && let Some(slots) = FovSlots::resolve(client, position)
    {
        let mut bits = vec![[0_u64; VISIBILITY_WORDS]; slots.slots.len()];

        // 1. Radius sphere with DDA line of sight.
        let radius_sq = FOV_RADIUS * FOV_RADIUS;
        for dz in -FOV_RADIUS..=FOV_RADIUS {
            for dy in -FOV_RADIUS..=FOV_RADIUS {
                for dx in -FOV_RADIUS..=FOV_RADIUS {
                    if dx * dx + dy * dy + dz * dz > radius_sq {
                        continue;
                    }
                    let candidate = Vec3i::new(position.x + dx, position.y + dy, position.z + dz);
                    if has_los(&slots, client, position, candidate) {
                        let (slot, voxel) = slots
                            .slot_voxel(candidate)
                            .expect("sphere candidates are inside the working box");
                        bitmap_set(&mut bits, slot, voxel);
                    }
                }
            }
        }

        // 2. Wall reveal: visible non-solid tiles reveal adjacent known
        // solid walls (collected against the pre-reveal set).
        let mut reveal: Vec<Vec3i> = Vec::new();
        for slot in 0..bits.len() {
            let base_chunk = slots.chunk_coord(slot);
            let Some(base) = chunk_min_world_position_unbounded(base_chunk, dims) else {
                continue;
            };
            let bitmap = bits[slot];
            for_each_set_bit(&bitmap, |voxel| {
                let (vx, vy, vz) = voxel_offsets(voxel);
                let pos = Vec3i::new(base.x + vx, base.y + vy, base.z + vz);
                if slots.known_solid(client, pos) {
                    return;
                }
                for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                    let wall = Vec3i::new(pos.x + dx, pos.y + dy, pos.z);
                    let Some((wall_slot, wall_voxel)) = slots.slot_voxel(wall) else {
                        continue;
                    };
                    if !bitmap_get(&bits, wall_slot, wall_voxel) && slots.known_solid(client, wall)
                    {
                        reveal.push(wall);
                    }
                }
            });
        }
        for wall in reveal {
            let (slot, voxel) = slots
                .slot_voxel(wall)
                .expect("wall-reveal neighbors are inside the working box");
            bitmap_set(&mut bits, slot, voxel);
        }

        // 3. Lower-half extension: visible air at or below the origin also
        // reveals the tile one z below (collected before insertion).
        let mut lower: Vec<Vec3i> = Vec::new();
        for slot in 0..bits.len() {
            let base_chunk = slots.chunk_coord(slot);
            let Some(base) = chunk_min_world_position_unbounded(base_chunk, dims) else {
                continue;
            };
            let bitmap = bits[slot];
            for_each_set_bit(&bitmap, |voxel| {
                let (vx, vy, vz) = voxel_offsets(voxel);
                let pos = Vec3i::new(base.x + vx, base.y + vy, base.z + vz);
                if pos.z <= position.z && slots.block_at(client, pos) == Some(BlockType::Air) {
                    lower.push(Vec3i::new(pos.x, pos.y, pos.z - 1));
                }
            });
        }
        for pos in lower {
            let (slot, voxel) = slots
                .slot_voxel(pos)
                .expect("lower-half extension stays inside the working box");
            bitmap_set(&mut bits, slot, voxel);
        }

        // 4. Keep only chunks with at least one visible bit.
        for (slot, bitmap) in bits.iter().enumerate() {
            if bitmap.iter().any(|word| *word != 0) {
                next_visible.insert(slots.chunk_coord(slot), *bitmap);
            }
        }
    }

    // 5. Per-column paint diff + persistent memory update.
    let mut changed_columns: BTreeSet<(i32, i32)> = BTreeSet::new();
    for (chunk, bitmap) in &next_visible {
        if previous_visible.get(chunk) != Some(bitmap) {
            changed_columns.insert((chunk.x, chunk.y));
        }
    }
    for (chunk, bitmap) in &previous_visible {
        if !next_visible.contains_key(chunk) && bitmap.iter().any(|word| *word != 0) {
            changed_columns.insert((chunk.x, chunk.y));
        }
    }

    if origin.is_some() {
        // Tiles that left visibility are memorized when their block value is
        // known (fail closed); tiles that became visible again are forgotten.
        // Legacy parity: losing the primary entity clears visibility without
        // memorizing anything, hence the `origin` guard.
        for (chunk, old_bits) in &previous_visible {
            let Some(base) = chunk_min_world_position_unbounded(*chunk, dims) else {
                continue;
            };
            let now_visible = next_visible.get(chunk);
            for_each_set_bit(old_bits, |voxel| {
                if now_visible.is_some_and(|bits| bits[voxel / 64] & (1 << (voxel % 64)) != 0) {
                    return;
                }
                let (vx, vy, vz) = voxel_offsets(voxel);
                let pos = Vec3i::new(base.x + vx, base.y + vy, base.z + vz);
                if let Some(block) = projected_block_at(client, pos) {
                    let blob = perspective
                        .memory
                        .entry(*chunk)
                        .or_insert_with(|| Box::new([0; CHUNK_VOLUME]));
                    let byte = encode_memory_block(block);
                    if blob[voxel] != byte {
                        blob[voxel] = byte;
                        changed_columns.insert((chunk.x, chunk.y));
                    }
                }
            });
        }
        for (chunk, bitmap) in &next_visible {
            if let Some(blob) = perspective.memory.get_mut(chunk) {
                let mut column_changed = false;
                for_each_set_bit(bitmap, |voxel| {
                    if blob[voxel] != 0 {
                        blob[voxel] = 0;
                        column_changed = true;
                    }
                });
                if column_changed {
                    changed_columns.insert((chunk.x, chunk.y));
                }
            }
        }
    }

    for column in changed_columns {
        let revision = perspective
            .visibility_revision_by_column
            .entry(column)
            .or_insert(0);
        *revision = revision.saturating_add(1);
    }
    perspective.visible = next_visible;
    perspective.fov_revision = perspective.fov_revision.saturating_add(1);
    perspective.fov_recompute_count = perspective.fov_recompute_count.saturating_add(1);
    perspective.fov_dirty = false;
}

/// Test-only verbatim copy of the Stage 4 **set-based** FOV/memory
/// algorithm, kept solely as the parity oracle for the Stage 5 bitmap
/// implementation. Never used by production code.
#[cfg(test)]
mod legacy_fov_oracle {
    use std::collections::{HashMap, HashSet};

    use od_core::client_view::ClientView;
    use od_core::{BlockType, Vec3i};

    use crate::render::projected_block_at;

    const FOV_RADIUS: i32 = super::FOV_RADIUS;

    #[derive(Debug, Default, Clone)]
    pub struct LegacyVisibility {
        pub visible: HashSet<Vec3i>,
        pub memory: HashMap<Vec3i, BlockType>,
    }

    pub fn recompute_fov(
        client: &ClientView,
        origin: Option<Vec3i>,
        visibility: &mut LegacyVisibility,
    ) {
        let Some(position) = origin else {
            visibility.visible.clear();
            return;
        };
        let previous_visible = std::mem::take(&mut visibility.visible);
        let mut next_visible = HashSet::new();
        let radius_sq = FOV_RADIUS * FOV_RADIUS;

        for dz in -FOV_RADIUS..=FOV_RADIUS {
            for dy in -FOV_RADIUS..=FOV_RADIUS {
                for dx in -FOV_RADIUS..=FOV_RADIUS {
                    if dx * dx + dy * dy + dz * dz > radius_sq {
                        continue;
                    }
                    let candidate = Vec3i::new(position.x + dx, position.y + dy, position.z + dz);
                    if has_los(client, position, candidate) {
                        next_visible.insert(candidate);
                    }
                }
            }
        }

        let mut wall_reveal = Vec::new();
        for &pos in &next_visible {
            if known_solid(client, pos) {
                continue;
            }
            for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let wall = Vec3i::new(pos.x + dx, pos.y + dy, pos.z);
                if !next_visible.contains(&wall) && known_solid(client, wall) {
                    wall_reveal.push(wall);
                }
            }
        }
        next_visible.extend(wall_reveal);

        let lower_half: Vec<Vec3i> = next_visible
            .iter()
            .copied()
            .filter(|pos| {
                pos.z <= position.z && projected_block_at(client, *pos) == Some(BlockType::Air)
            })
            .collect();
        for pos in lower_half {
            next_visible.insert(Vec3i::new(pos.x, pos.y, pos.z - 1));
        }

        for pos in previous_visible {
            if !next_visible.contains(&pos) {
                // Fail closed: memorize only blocks whose value is known.
                if let Some(block) = projected_block_at(client, pos) {
                    visibility.memory.insert(pos, block);
                }
            }
        }
        for pos in &next_visible {
            visibility.memory.remove(pos);
        }
        visibility.visible = next_visible;
    }

    fn known_solid(client: &ClientView, pos: Vec3i) -> bool {
        projected_block_at(client, pos) == Some(BlockType::SolidStone)
    }

    fn opaque_for_los(client: &ClientView, pos: Vec3i) -> bool {
        !matches!(projected_block_at(client, pos), Some(BlockType::Air))
    }

    fn has_los(client: &ClientView, from: Vec3i, to: Vec3i) -> bool {
        if from == to {
            return true;
        }
        let dir_x = to.x as f32 + 0.5 - (from.x as f32 + 0.5);
        let dir_y = to.y as f32 + 0.5 - (from.y as f32 + 0.5);
        let dir_z = to.z as f32 + 0.5 - (from.z as f32 + 0.5);
        let step_x = if dir_x >= 0.0 { 1 } else { -1 };
        let step_y = if dir_y >= 0.0 { 1 } else { -1 };
        let step_z = if dir_z >= 0.0 { 1 } else { -1 };
        let t_delta_x = if dir_x == 0.0 {
            f32::INFINITY
        } else {
            1.0 / dir_x.abs()
        };
        let t_delta_y = if dir_y == 0.0 {
            f32::INFINITY
        } else {
            1.0 / dir_y.abs()
        };
        let t_delta_z = if dir_z == 0.0 {
            f32::INFINITY
        } else {
            1.0 / dir_z.abs()
        };
        let mut t_max_x = if dir_x == 0.0 {
            f32::INFINITY
        } else {
            0.5 / dir_x.abs()
        };
        let mut t_max_y = if dir_y == 0.0 {
            f32::INFINITY
        } else {
            0.5 / dir_y.abs()
        };
        let mut t_max_z = if dir_z == 0.0 {
            f32::INFINITY
        } else {
            0.5 / dir_z.abs()
        };
        let mut cursor = from;
        let max_steps = (from.x - to.x).abs() + (from.y - to.y).abs() + (from.z - to.z).abs() + 1;

        for _ in 0..max_steps {
            if t_max_x <= t_max_y && t_max_x <= t_max_z {
                cursor.x += step_x;
                t_max_x += t_delta_x;
            } else if t_max_y <= t_max_z {
                cursor.y += step_y;
                t_max_y += t_delta_y;
            } else {
                cursor.z += step_z;
                t_max_z += t_delta_z;
            }
            if cursor == to {
                return true;
            }
            if opaque_for_los(client, cursor) {
                return false;
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use od_core::world::chunk::chunk_index_to_coord;
    use od_core::{TerrainConfig, WorldCamera, WorldCommand, WorldConfig};

    use crate::{WorldSim, test_util};

    use super::legacy_fov_oracle::LegacyVisibility;
    use super::*;

    fn sim(world_chunks: Vec3u, spawn_player: bool) -> WorldSim {
        WorldSim::new(
            WorldConfig {
                chunk_edge: 16,
                world_chunks,
                movement_ticks_per_tile: 10,
                terrain: TerrainConfig::default(),
            },
            spawn_player,
        )
    }

    fn master_view(camera: WorldCamera, view_z: i32) -> LocalWorldView {
        LocalWorldView {
            view_mode: WorldViewMode::Master,
            view_z,
            camera,
            ..LocalWorldView::default()
        }
    }

    fn entity_view(camera: WorldCamera, view_z: i32) -> LocalWorldView {
        LocalWorldView {
            view_mode: WorldViewMode::Entity,
            view_z,
            camera,
            ..LocalWorldView::default()
        }
    }

    fn desired(chunks: &[Vec3i]) -> BTreeSet<Vec3i> {
        chunks.iter().copied().collect()
    }

    fn assert_chunk_parity(client: &ClientView, world: &WorldState, chunk: Vec3i) {
        let mut expected = Box::new([BlockType::Air; CHUNK_VOLUME]);
        assert!(world.copy_chunk_blocks(chunk, &mut expected), "{chunk:?}");
        let view = client.chunks.get(&chunk).expect("projected chunk");
        assert_eq!(view.blocks[..], expected[..], "byte parity for {chunk:?}");
        assert_eq!(
            Some(view.terrain_revision),
            world.chunk_terrain_revision(chunk),
            "revision parity for {chunk:?}"
        );
    }

    #[test]
    fn sync_counts_insert_unchanged_recopy_and_remove() {
        let mut sim = sim(Vec3u::new(2, 2, 2), false);
        let mut client = ClientView {
            world_chunks: sim.world_chunks(),
            ..ClientView::default()
        };
        let a = Vec3i::new(-1, -1, -1);
        let b = Vec3i::new(0, 0, 0);

        // Add.
        let stats = sync_view_chunks(&mut client, sim.state(), &desired(&[a, b]));
        assert_eq!(
            stats,
            ProjectionSyncStats {
                inserted: 2,
                ..ProjectionSyncStats::default()
            }
        );
        assert_chunk_parity(&client, sim.state(), a);
        assert_chunk_parity(&client, sim.state(), b);

        // Unchanged hit.
        let stats = sync_view_chunks(&mut client, sim.state(), &desired(&[a, b]));
        assert_eq!(
            stats,
            ProjectionSyncStats {
                unchanged: 2,
                ..ProjectionSyncStats::default()
            }
        );

        // Terrain revision recopy (test-only block mutation helper).
        let mutated = Vec3i::new(0, 0, 0); // starter room => Air, in chunk b
        assert!(test_util::set_block(
            &mut sim,
            mutated,
            BlockType::SolidStone
        ));
        let stats = sync_view_chunks(&mut client, sim.state(), &desired(&[a, b]));
        assert_eq!(
            stats,
            ProjectionSyncStats {
                recopied: 1,
                unchanged: 1,
                ..ProjectionSyncStats::default()
            }
        );
        assert_eq!(client.block_at(mutated), Some(BlockType::SolidStone));
        assert_chunk_parity(&client, sim.state(), b);

        // Remove when the window shrinks.
        let stats = sync_view_chunks(&mut client, sim.state(), &desired(&[b]));
        assert_eq!(
            stats,
            ProjectionSyncStats {
                removed: 1,
                unchanged: 1,
                ..ProjectionSyncStats::default()
            }
        );
        assert!(!client.chunks.contains_key(&a));
        assert_eq!(client.block_at(Vec3i::new(-9, -9, -9)), None);
    }

    #[test]
    fn sync_fails_closed_on_missing_authoritative_residency() {
        let mut sim = sim(Vec3u::new(2, 1, 1), false);
        let mut client = ClientView {
            world_chunks: sim.world_chunks(),
            ..ClientView::default()
        };
        let east = Vec3i::new(0, 0, 0);
        let west = Vec3i::new(-1, 0, 0);
        let stats = sync_view_chunks(&mut client, sim.state(), &desired(&[west, east]));
        assert_eq!(stats.inserted, 2);

        // Authority drops residency: the projected copy must be removed in the
        // same sync and counted as authority_missing + removed.
        sim.send_command(WorldCommand::SetChunkLoaded {
            chunk: east,
            loaded: false,
        })
        .expect("unload east chunk");
        let stats = sync_view_chunks(&mut client, sim.state(), &desired(&[west, east]));
        assert_eq!(
            stats,
            ProjectionSyncStats {
                authority_missing: 1,
                removed: 1,
                unchanged: 1,
                ..ProjectionSyncStats::default()
            }
        );
        assert!(!client.chunks.contains_key(&east));
        // Lookup in the missing chunk fails closed.
        assert_eq!(client.block_at(Vec3i::new(1, 0, 0)), None);

        // Still missing (already absent): authority_missing without removal.
        let stats = sync_view_chunks(&mut client, sim.state(), &desired(&[west, east]));
        assert_eq!(
            stats,
            ProjectionSyncStats {
                authority_missing: 1,
                unchanged: 1,
                ..ProjectionSyncStats::default()
            }
        );

        // Out-of-grid desired chunks are also authority_missing, never inserted.
        let bogus = Vec3i::new(5, 5, 5);
        let stats = sync_view_chunks(&mut client, sim.state(), &desired(&[west, bogus]));
        assert_eq!(stats.authority_missing, 1);
        assert!(!client.chunks.contains_key(&bogus));
    }

    #[test]
    fn projection_window_clips_to_world_bounds() {
        let dims = Vec3u::new(9, 9, 1);
        // Camera at the world's north-west corner: padding must clip.
        let corner_px = -72.0 * TILE_SIZE_PX;
        let view = master_view(
            WorldCamera {
                x: corner_px,
                y: corner_px,
                zoom: 1.0,
            },
            0,
        );
        let window = compute_projection_window(&view, dims, None, (640, 480));
        assert!(!window.visible.is_empty());
        for chunk in window.visible.iter().chain(window.resident.iter()) {
            assert!(
                chunk_coord_to_index(*chunk, dims).is_some(),
                "{chunk:?} must be inside the chunk grid"
            );
        }
        assert!(window.visible.contains(&Vec3i::new(-4, -4, 0)));
        assert!(window.visible.is_subset(&window.resident));

        // Off-map view z produces an empty camera window.
        let off_z = master_view(WorldCamera::default(), 1000);
        let window = compute_projection_window(&off_z, dims, None, (640, 480));
        assert!(window.visible.is_empty());
        assert!(window.resident.is_empty());
    }

    #[test]
    fn entity_mode_unions_fov_support_chunks_master_does_not() {
        let dims = Vec3u::new(9, 9, 1);
        // Tiny camera window centered on chunk (0,0,0).
        let camera = WorldCamera {
            x: 0.0,
            y: 0.0,
            zoom: 2.0,
        };
        let framebuffer = (64, 64);
        // Player at the east edge of chunk 0: the radius-20 sphere reaches
        // chunk (2, _, 0), two chunks away from the camera window.
        let position = Some(Vec3i::new(7, 0, 0));

        let entity =
            compute_projection_window(&entity_view(camera, 0), dims, position, framebuffer);
        assert_eq!(
            entity.visible.iter().copied().collect::<Vec<_>>(),
            vec![Vec3i::new(0, 0, 0)]
        );
        // Padding ring around the visible chunk.
        for dy in -1..=1 {
            for dx in -1..=1 {
                assert!(entity.resident.contains(&Vec3i::new(dx, dy, 0)));
            }
        }
        // FOV support beyond the padding ring (closest voxel distances:
        // (2,0): 17 <= 20; (2,1): sqrt(17^2+8^2) <= 20).
        assert!(entity.resident.contains(&Vec3i::new(2, 0, 0)));
        assert!(entity.resident.contains(&Vec3i::new(2, 1, 0)));
        assert!(entity.resident.contains(&Vec3i::new(2, -1, 0)));
        // Outside the sphere: (3,0) closest voxel is 33 away; (2,2) is
        // sqrt(17^2 + 24^2) > 20.
        assert!(!entity.resident.contains(&Vec3i::new(3, 0, 0)));
        assert!(!entity.resident.contains(&Vec3i::new(2, 2, 0)));

        // Master mode retains no player-FOV ring.
        let master =
            compute_projection_window(&master_view(camera, 0), dims, position, framebuffer);
        assert!(!master.resident.contains(&Vec3i::new(2, 0, 0)));
        assert!(!master.resident.contains(&Vec3i::new(2, 1, 0)));
        // Entity mode without a primary entity also retains no FOV ring.
        let no_entity = compute_projection_window(&entity_view(camera, 0), dims, None, framebuffer);
        assert_eq!(no_entity.resident, master.resident);
    }

    #[test]
    fn client_view_matches_authoritative_bytes_for_complete_window() {
        let sim = sim(Vec3u::new(9, 9, 1), true);
        let dims = sim.world_chunks();
        // Zoomed-out master camera covering the whole world.
        let view = master_view(
            WorldCamera {
                x: 0.0,
                y: 0.0,
                zoom: 0.05,
            },
            0,
        );
        let window = compute_projection_window(&view, dims, None, (1920, 1080));
        assert_eq!(window.resident.len(), 81, "whole world resident");

        let mut client = ClientView {
            world_chunks: dims,
            ..ClientView::default()
        };
        let stats = sync_view_chunks(&mut client, sim.state(), &window.resident);
        assert_eq!(stats.inserted, 81);
        assert_eq!(stats.authority_missing, 0);
        assert_eq!(client.chunks.len(), window.resident.len());

        // Byte + revision parity for every chunk of the desired window.
        for chunk in &window.resident {
            assert_chunk_parity(&client, sim.state(), *chunk);
        }

        // Fail-closed block lookup agrees with authoritative block_at across
        // a sample of world positions (all chunks are projected here).
        for pos in [
            Vec3i::new(0, 0, 0),
            Vec3i::new(-72, -72, -8),
            Vec3i::new(71, 71, 7),
            Vec3i::new(-1, 5, -2),
        ] {
            assert_eq!(
                client.block_at(pos),
                sim.state().block_at(pos),
                "block parity at {pos:?}"
            );
        }
    }

    #[test]
    fn project_entities_first_sample_tick_shift_and_despawn() {
        let mut sim = sim(Vec3u::new(9, 9, 1), true);
        let id = sim.primary_entity_id().expect("player");
        let mut client = ClientView::default();

        // First sample: prev == curr.
        project_entities(&mut client, sim.state(), Some(id));
        assert_eq!(client.primary_entity_id, Some(id));
        assert_eq!(client.entities.len(), 1);
        let first = client.entities[0];
        assert_eq!(first.id, id);
        assert_eq!(first.prev_xy, first.curr_xy);

        // Start a move and advance one tick: prev holds the old curr and
        // curr advances to the new render position.
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
        .expect("open move from spawn");
        sim.step_ticks(1);
        project_entities(&mut client, sim.state(), Some(id));
        let moving = client.entities[0];
        assert_eq!(moving.prev_xy, first.curr_xy, "prev <- previous curr");
        assert_ne!(moving.curr_xy, moving.prev_xy, "moved for {direction:?}");
        let expected_curr =
            entity_render_position_xy(&sim.entity_snapshot(id).expect("moving entity"));
        assert_eq!(moving.curr_xy, expected_curr);

        // Next tick shifts again.
        sim.step_ticks(1);
        project_entities(&mut client, sim.state(), Some(id));
        assert_eq!(client.entities[0].prev_xy, moving.curr_xy);

        // Despawned entities are dropped (project from a world without them).
        let empty_world = WorldSim::new(
            WorldConfig {
                world_chunks: Vec3u::new(9, 9, 1),
                ..WorldConfig::default()
            },
            false,
        );
        project_entities(&mut client, empty_world.state(), None);
        assert!(client.entities.is_empty());
        assert_eq!(client.primary_entity_id, None);
    }

    #[test]
    fn project_entities_sorts_by_id() {
        let mut sim = sim(Vec3u::new(9, 9, 1), true);
        sim.state_mut()
            .spawn_entity(7, Vec3i::new(0, 0, 0))
            .expect("spawn 7");
        sim.state_mut()
            .spawn_entity(3, Vec3i::new(1, 0, 0))
            .expect("spawn 3");
        let mut client = ClientView::default();
        project_entities(&mut client, sim.state(), Some(1));
        let ids: Vec<u64> = client.entities.iter().map(|entity| entity.id).collect();
        assert_eq!(ids, vec![1, 3, 7]);
    }

    // -----------------------------------------------------------------
    // Stage 5: bitmap FOV parity, memory persistence, column revisions.
    // -----------------------------------------------------------------

    /// Project every simulation-resident chunk plus entities.
    fn full_client(sim: &WorldSim) -> ClientView {
        let dims = sim.world_chunks();
        let count = (dims.x * dims.y * dims.z) as usize;
        let desired: BTreeSet<Vec3i> = (0..count)
            .filter_map(|index| chunk_index_to_coord(index, dims))
            .collect();
        let mut client = ClientView {
            world_chunks: dims,
            ..ClientView::default()
        };
        sync_view_chunks(&mut client, sim.state(), &desired);
        project_entities(&mut client, sim.state(), sim.primary_entity_id());
        client
    }

    /// Force the FOV origin: overwrite the projected primary entity position.
    fn set_fov_origin(client: &mut ClientView, position: Vec3i) {
        let entity = client
            .entities
            .first_mut()
            .expect("fixture needs a primary entity");
        entity.position = position;
    }

    fn bitmap_visible_set(perspective: &EntityPerspective, dims: Vec3u) -> BTreeSet<Vec3i> {
        let mut set = BTreeSet::new();
        for (chunk, bits) in &perspective.visible {
            let base = chunk_min_world_position_unbounded(*chunk, dims).expect("chunk base");
            for (word_index, word) in bits.iter().enumerate() {
                let mut word = *word;
                while word != 0 {
                    let voxel = word_index * 64 + word.trailing_zeros() as usize;
                    let (vx, vy, vz) = (
                        (voxel & 15) as i32,
                        ((voxel >> 4) & 15) as i32,
                        (voxel >> 8) as i32,
                    );
                    set.insert(Vec3i::new(base.x + vx, base.y + vy, base.z + vz));
                    word &= word - 1;
                }
            }
        }
        set
    }

    fn bitmap_memory_map(
        perspective: &EntityPerspective,
        dims: Vec3u,
    ) -> BTreeMap<Vec3i, BlockType> {
        let mut map = BTreeMap::new();
        for (chunk, blob) in &perspective.memory {
            let base = chunk_min_world_position_unbounded(*chunk, dims).expect("chunk base");
            for (voxel, byte) in blob.iter().enumerate() {
                let Some(block) = od_core::client_view::decode_memory_block(*byte) else {
                    continue;
                };
                let (vx, vy, vz) = (
                    (voxel & 15) as i32,
                    ((voxel >> 4) & 15) as i32,
                    (voxel >> 8) as i32,
                );
                map.insert(Vec3i::new(base.x + vx, base.y + vy, base.z + vz), block);
            }
        }
        map
    }

    /// Run the bitmap implementation and the legacy set-based oracle over
    /// the same client/origin sequence and require identical visible and
    /// remembered value sets after every step.
    fn assert_fov_parity_over_origins(client: &mut ClientView, origins: &[Vec3i], label: &str) {
        let dims = client.world_chunks;
        let mut perspective = EntityPerspective::default();
        let mut legacy = LegacyVisibility::default();
        for (step, origin) in origins.iter().enumerate() {
            set_fov_origin(client, *origin);
            recompute_entity_perspective(&mut perspective, client);
            legacy_fov_oracle::recompute_fov(client, Some(*origin), &mut legacy);

            let bitmap_visible = bitmap_visible_set(&perspective, dims);
            let legacy_visible: BTreeSet<Vec3i> = legacy.visible.iter().copied().collect();
            assert_eq!(
                bitmap_visible, legacy_visible,
                "{label}: visible parity at step {step} origin {origin:?}"
            );
            assert_eq!(
                perspective.visible_tile_count(),
                legacy.visible.len(),
                "{label}: visible count parity at step {step}"
            );

            let bitmap_memory = bitmap_memory_map(&perspective, dims);
            let legacy_memory: BTreeMap<Vec3i, BlockType> = legacy
                .memory
                .iter()
                .map(|(pos, block)| (*pos, *block))
                .collect();
            assert_eq!(
                bitmap_memory, legacy_memory,
                "{label}: memory parity at step {step} origin {origin:?}"
            );
            assert_eq!(
                perspective.remembered_tile_count(),
                legacy.memory.len(),
                "{label}: remembered count parity at step {step}"
            );
        }
    }

    #[test]
    fn fov_bitmap_matches_legacy_sets_in_default_world() {
        let sim = sim(Vec3u::new(1, 1, 1), true);
        let spawn = sim.entity_position(1).expect("player");
        let mut client = full_client(&sim);
        // Spawn, one-tile moves, and a vertical shift: the radius-20 sphere
        // always crosses the world bounds in a 16^3 world (out-of-world
        // parity included).
        let origins = [
            spawn,
            Vec3i::new(spawn.x - 1, spawn.y, spawn.z),
            Vec3i::new(spawn.x - 1, spawn.y + 1, spawn.z),
            Vec3i::new(spawn.x, spawn.y, spawn.z - 1),
            spawn,
        ];
        assert_fov_parity_over_origins(&mut client, &origins, "default 1x1x1");
    }

    #[test]
    fn fov_bitmap_matches_legacy_sets_across_chunk_boundaries() {
        let sim = sim(Vec3u::new(9, 9, 1), true);
        let mut client = full_client(&sim);
        // Origins straddling chunk boundaries in x/y (chunk edges at
        // multiples of 16 offset by -8) plus a diagonal walk across one.
        let origins = [
            Vec3i::new(7, 7, -1),   // last voxel of chunk (0, 0, 0) in x/y
            Vec3i::new(8, 7, -1),   // first voxel of chunk (1, 0, 0)
            Vec3i::new(8, 8, -1),   // chunk (1, 1, 0)
            Vec3i::new(-9, -8, -1), // chunk (-1, 0, 0) at its east edge
            Vec3i::new(23, 8, -2),  // one z down, chunk (1, 1, 0) east edge
            Vec3i::new(24, 8, -2),  // chunk (2, 1, 0)
        ];
        assert_fov_parity_over_origins(&mut client, &origins, "play 9x9x1 boundaries");
    }

    #[test]
    fn fov_bitmap_matches_legacy_sets_with_negative_chunks_and_missing_chunks() {
        let sim = sim(Vec3u::new(2, 2, 2), true);
        let mut client = full_client(&sim);
        let spawn = sim.entity_position(1).expect("player");
        let origins = [
            spawn,
            Vec3i::new(-1, -1, -1), // centered origin: all four negative chunks
            Vec3i::new(0, 0, 0),
            Vec3i::new(-16, -16, -16), // world minimum corner
        ];
        assert_fov_parity_over_origins(&mut client, &origins, "2x2x2 negative");

        // Fail-closed parity: drop a chunk from the projection; a missing
        // required chunk must be opaque for both implementations.
        let mut partial = full_client(&sim);
        partial.chunks.remove(&Vec3i::new(0, 0, 0));
        partial.chunks.remove(&Vec3i::new(-1, 0, -1));
        let origins = [Vec3i::new(-1, -1, -1), Vec3i::new(-8, 4, -2)];
        assert_fov_parity_over_origins(&mut partial, &origins, "2x2x2 missing chunks");
    }

    #[test]
    fn perspective_memory_survives_projection_stream_out_and_in() {
        let sim = sim(Vec3u::new(9, 9, 1), true);
        let dims = sim.world_chunks();
        let mut client = full_client(&sim);
        let mut perspective = EntityPerspective::default();

        // See the area around the origin, then move far away so the old
        // area leaves visibility and becomes memory.
        set_fov_origin(&mut client, Vec3i::new(0, 0, -1));
        recompute_entity_perspective(&mut perspective, &client);
        set_fov_origin(&mut client, Vec3i::new(60, 60, -1));
        recompute_entity_perspective(&mut perspective, &client);
        let remembered = bitmap_memory_map(&perspective, dims);
        assert!(!remembered.is_empty(), "old area must be remembered");
        let memory_chunks: Vec<Vec3i> = perspective.memory.keys().copied().collect();

        // Stream the remembered chunks out of the projection window (the
        // camera moved away): memory must survive untouched.
        let far_window: BTreeSet<Vec3i> = [Vec3i::new(3, 3, 0), Vec3i::new(4, 4, 0)]
            .into_iter()
            .collect();
        let stats = sync_view_chunks(&mut client, sim.state(), &far_window);
        assert!(stats.removed > 0, "chunks actually left the projection");
        for chunk in &memory_chunks {
            assert!(
                !client.chunks.contains_key(chunk) || far_window.contains(chunk),
                "fixture: remembered chunk {chunk:?} left the projection"
            );
        }
        assert_eq!(
            bitmap_memory_map(&perspective, dims),
            remembered,
            "stream-out must not erase memory"
        );

        // A recompute while the remembered chunks are absent (fail closed)
        // must also preserve them: they are not visible, so they stay
        // remembered.
        project_entities(&mut client, sim.state(), sim.primary_entity_id());
        set_fov_origin(&mut client, Vec3i::new(60, 60, -1));
        recompute_entity_perspective(&mut perspective, &client);
        assert_eq!(bitmap_memory_map(&perspective, dims), remembered);

        // Stream the chunks back in: memory unchanged and still readable.
        let count = (dims.x * dims.y * dims.z) as usize;
        let all: BTreeSet<Vec3i> = (0..count)
            .filter_map(|index| chunk_index_to_coord(index, dims))
            .collect();
        sync_view_chunks(&mut client, sim.state(), &all);
        assert_eq!(bitmap_memory_map(&perspective, dims), remembered);
        let (&sample_pos, &sample_block) = remembered.iter().next().expect("entry");
        assert_eq!(
            perspective.remembered_block(sample_pos, dims),
            Some(sample_block)
        );
    }

    #[test]
    fn column_revisions_bump_only_for_changed_columns() {
        let sim = sim(Vec3u::new(9, 9, 1), true);
        let mut client = full_client(&sim);
        let mut perspective = EntityPerspective::default();
        set_fov_origin(&mut client, Vec3i::new(0, 0, -1));
        recompute_entity_perspective(&mut perspective, &client);
        let after_first = perspective.visibility_revision_by_column.clone();
        assert!(!after_first.is_empty(), "first recompute paints columns");
        // Radius 20 from x/y = 0 cannot touch chunk column (3, 3) and
        // beyond (closest voxel is 40 tiles away).
        assert!(!after_first.contains_key(&(3, 3)));
        assert!(!after_first.contains_key(&(4, 4)));

        // Same input recompute: identical paint, zero bumps.
        perspective.fov_dirty = true;
        recompute_entity_perspective(&mut perspective, &client);
        assert_eq!(
            perspective.visibility_revision_by_column, after_first,
            "identical inputs must bump no column revision"
        );
        assert_eq!(perspective.fov_recompute_count, 2);

        // One-tile origin move: the bumped columns must equal exactly the
        // set of XY chunk columns whose visible bits or memory bytes
        // actually changed (value-level diff, not a broad invalidation).
        let dims = sim.world_chunks();
        let visible_before = bitmap_visible_set(&perspective, dims);
        let memory_before = bitmap_memory_map(&perspective, dims);
        set_fov_origin(&mut client, Vec3i::new(1, 0, -1));
        recompute_entity_perspective(&mut perspective, &client);
        let visible_after = bitmap_visible_set(&perspective, dims);
        let memory_after = bitmap_memory_map(&perspective, dims);

        let mut expected_changed: BTreeSet<(i32, i32)> = BTreeSet::new();
        for pos in visible_before.symmetric_difference(&visible_after) {
            let (chunk, _) = position_to_chunk_voxel_unbounded(*pos, dims).expect("mapped");
            expected_changed.insert((chunk.x, chunk.y));
        }
        for pos in memory_before
            .keys()
            .chain(memory_after.keys())
            .filter(|pos| memory_before.get(*pos) != memory_after.get(*pos))
        {
            let (chunk, _) = position_to_chunk_voxel_unbounded(*pos, dims).expect("mapped");
            expected_changed.insert((chunk.x, chunk.y));
        }
        assert!(!expected_changed.is_empty(), "movement changes some paint");

        let after_move = perspective.visibility_revision_by_column.clone();
        let bumped: BTreeSet<(i32, i32)> = after_move
            .iter()
            .filter(|(column, revision)| after_first.get(*column) != Some(*revision))
            .map(|(column, _)| *column)
            .collect();
        assert_eq!(
            bumped, expected_changed,
            "revision bumps must equal the exact per-column paint diff"
        );
        assert!(
            !after_move.contains_key(&(4, 4)),
            "distant column untouched"
        );
    }

    #[test]
    fn column_revisions_bump_for_block_mutation_in_view() {
        let mut sim = sim(Vec3u::new(9, 9, 1), true);
        let mut client = full_client(&sim);
        let mut perspective = EntityPerspective::default();
        let origin = Vec3i::new(0, 0, -1);
        set_fov_origin(&mut client, origin);
        recompute_entity_perspective(&mut perspective, &client);
        let before = perspective.visibility_revision_by_column.clone();

        // Mutate one visible air tile to solid, re-project, recompute.
        let visible = bitmap_visible_set(&perspective, sim.world_chunks());
        let target = *visible
            .iter()
            .find(|pos| {
                pos.z == origin.z
                    && **pos != origin
                    && client.block_at(**pos) == Some(BlockType::Air)
            })
            .expect("a visible air tile near the origin");
        assert!(test_util::set_block(
            &mut sim,
            target,
            BlockType::SolidStone
        ));
        let dims = sim.world_chunks();
        let count = (dims.x * dims.y * dims.z) as usize;
        let all: BTreeSet<Vec3i> = (0..count)
            .filter_map(|index| chunk_index_to_coord(index, dims))
            .collect();
        sync_view_chunks(&mut client, sim.state(), &all);
        set_fov_origin(&mut client, origin);
        recompute_entity_perspective(&mut perspective, &client);

        let after = perspective.visibility_revision_by_column.clone();
        assert_ne!(after, before, "the mutation changed visible paint");
        assert!(
            !after.contains_key(&(4, 4)),
            "a column outside the FOV never bumps"
        );
    }

    /// Records the FOV-recompute wall-time distribution (report evidence;
    /// deliberately not a CI timing gate).
    #[test]
    fn fov_recompute_timing_distribution_is_recorded() {
        let sim = sim(Vec3u::new(9, 9, 1), true);
        let mut client = full_client(&sim);
        let mut perspective = EntityPerspective::default();
        let mut samples_us: Vec<u128> = Vec::new();
        // Warm + measure across a walk of origins (movement-like workload).
        for step in 0..40 {
            let origin = Vec3i::new(step % 8, (step / 2) % 8, -1);
            set_fov_origin(&mut client, origin);
            perspective.fov_dirty = true;
            let start = std::time::Instant::now();
            recompute_entity_perspective(&mut perspective, &client);
            samples_us.push(start.elapsed().as_micros());
        }
        samples_us.sort_unstable();
        let median = samples_us[samples_us.len() / 2];
        let p95 = samples_us[(samples_us.len() * 95) / 100 - 1];
        println!(
            "fov recompute samples (us): median={median} p95={p95} min={} max={} n={}",
            samples_us.first().expect("samples"),
            samples_us.last().expect("samples"),
            samples_us.len(),
        );
        assert_eq!(perspective.fov_recompute_count, 40);
    }
}
