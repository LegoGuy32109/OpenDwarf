//! Shadow ClientView projection (Stage 3).
//!
//! Computes the local projection window from `LocalWorldView`, synchronizes
//! projected chunk copies against authoritative `WorldState`, and projects
//! entities with client-owned interpolation history. In Stage 3 the
//! projection is updated after fixed ticks / lifecycle rebuilds and verified
//! by tests only; draw output still consumes the legacy snapshot path.
//!
//! Cameras never mutate authoritative residency here: a desired chunk that is
//! not simulation-resident is counted as `authority_missing` and removed from
//! the ClientView so stale data never remains renderable (fail closed).

use std::collections::{BTreeSet, HashMap};

use od_core::client_view::{ChunkView, ClientView, EntityView};
use od_core::world::chunk::{
    CHUNK_VOLUME, SUPPORTED_CHUNK_EDGE, chunk_coord_to_index, chunk_min_world_position,
    world_position_to_chunk_voxel,
};
use od_core::{BlockType, LocalWorldView, Vec3i, Vec3u, WorldViewMode};

use crate::WorldState;
use crate::render::entity_render_position_xy;

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

#[cfg(test)]
mod tests {
    use od_core::{TerrainConfig, WorldCamera, WorldCommand, WorldConfig};

    use crate::{WorldSim, test_util};

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
        assert!(test_util::set_block(&mut sim, mutated, BlockType::SolidStone));
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

        let entity = compute_projection_window(&entity_view(camera, 0), dims, position, framebuffer);
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
        let master = compute_projection_window(&master_view(camera, 0), dims, position, framebuffer);
        assert!(!master.resident.contains(&Vec3i::new(2, 0, 0)));
        assert!(!master.resident.contains(&Vec3i::new(2, 1, 0)));
        // Entity mode without a primary entity also retains no FOV ring.
        let no_entity = compute_projection_window(&entity_view(camera, 0), dims, None, framebuffer);
        assert_eq!(no_entity.resident, master.resident);
    }

    #[test]
    fn shadow_client_view_matches_authoritative_bytes_for_complete_window() {
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
}
