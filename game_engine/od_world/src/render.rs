//! World renderer (Stage 5): consumes the projected [`ClientView`] plus an
//! **immutable** [`EntityPerspective`].
//!
//! Render never reaches `WorldState` or a `WorldSnapshot`, and it no longer
//! recomputes FOV: perspective bitmaps/memory are maintained at tick exit
//! (or lifecycle / explicit view-mode changes) by `crate::project`. Render
//! mutates only its own caches and the output arenas.
//!
//! Fail-closed lookup rules:
//! - Positions outside the world are known void ([`BlockType::Air`]),
//!   matching the legacy sparse-snapshot semantics.
//! - Positions whose chunk is not projected are *missing*: render skips
//!   them (nothing is emitted) and LOS treats them as opaque.

use std::collections::{HashMap, HashSet};

use od_core::client_view::{ClientView, EntityPerspective, EntityView};
use od_core::world::chunk::{CHUNK_AREA, SUPPORTED_CHUNK_EDGE, chunk_min_world_position};
use od_core::{
    BlockType, DRAWCMD_PROGRAM_WORLD_ATLAS_QUAD, DrawCmd, EntitySnapshot, LocalWorldView,
    TEXTURE_ID_FLOOR, TEXTURE_ID_SPRITE, Vec3i, Vec3u, WorldAtlasQuadInstance, WorldViewMode,
    world_position_to_chunk_voxel,
};

const TILE_SIZE_PX: f32 = 64.0;
const Z_LEVELS_BELOW: i32 = 5;
pub const MAX_WORLD_ATLAS_INSTANCES_PER_DRAW: usize = 8192;
const FLOOR_ATLAS_FRAMES: f32 = 31.0;
const FLOOR_FRAME: f32 = 5.0;
const DEPTH_TINTS: [[f32; 3]; 6] = [
    [1.0, 1.0, 1.0],
    [0.75, 0.75, 0.75],
    [0.65, 0.65, 0.8],
    [0.43, 0.45, 0.61],
    [0.32, 0.34, 0.61],
    [0.2, 0.2, 0.4],
];
const REMEMBERED_TINT: [f32; 3] = [1.0, 0.86, 0.34];

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum TileVisibility {
    Visible,
    Remembered,
    #[default]
    Unseen,
}

/// Perspective classification for one tile (bitmap + memory lookup).
fn tile_visibility(perspective: &EntityPerspective, dims: Vec3u, pos: Vec3i) -> TileVisibility {
    if perspective.is_visible(pos, dims) {
        TileVisibility::Visible
    } else if perspective.remembered_block(pos, dims).is_some() {
        TileVisibility::Remembered
    } else {
        TileVisibility::Unseen
    }
}

/// Render-owned caches (topmost this stage; the keyed floor-emission cache
/// lands in Stage 7). Derived data only: safe to clear at any lifecycle
/// boundary.
#[derive(Debug, Default)]
pub struct RenderCaches {
    pub topmost: TopmostCache,
}

impl RenderCaches {
    /// Lifecycle reset (world reset/import): revisions restart at zero in a
    /// new world, so stale entries must never be allowed to match.
    pub fn reset(&mut self) {
        self.topmost.clear();
    }
}

/// Per-XY-chunk-column cache of terrain-solid bits over the scanned z slice
/// `[view_z - Z_LEVELS_BELOW, view_z]`.
///
/// An entry is valid only when its `view_z` matches and every exact
/// `(chunk_z, terrain_revision)` source tuple matches the current
/// `ClientView` (the slice spans at most two z-chunks with the fixed 16
/// edge). Columns whose slice touches a missing projected chunk are
/// recomputed every frame and never cached (fail closed). Entries for
/// columns outside the visible window are evicted after emission.
#[derive(Debug)]
pub struct TopmostCache {
    entries: HashMap<(i32, i32), TopmostColumn>,
    scratch: Box<[u8; CHUNK_AREA]>,
    hits: u64,
    rebuilds: u64,
}

impl Default for TopmostCache {
    fn default() -> Self {
        Self {
            entries: HashMap::new(),
            scratch: Box::new([0; CHUNK_AREA]),
            hits: 0,
            rebuilds: 0,
        }
    }
}

#[derive(Debug, Clone)]
struct TopmostColumn {
    view_z: i32,
    /// Exact `(chunk_z, terrain_revision)` dependency tuples, never a
    /// global epoch.
    sources: Vec<(i32, u64)>,
    /// Per tile (y-major, x fastest); bit `view_z - z` set => terrain solid.
    solid: Box<[u8; CHUNK_AREA]>,
}

impl TopmostCache {
    pub fn clear(&mut self) {
        self.entries.clear();
        self.hits = 0;
        self.rebuilds = 0;
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    #[must_use]
    pub fn hits(&self) -> u64 {
        self.hits
    }

    #[must_use]
    pub fn rebuilds(&self) -> u64 {
        self.rebuilds
    }

    /// Terrain-solid mask for one XY chunk column, cached when every source
    /// tuple is available and unchanged.
    fn solid_mask(
        &mut self,
        client: &ClientView,
        key: (i32, i32),
        base_xy: [i32; 2],
        view_z: i32,
    ) -> &[u8; CHUNK_AREA] {
        match column_sources(client, key, view_z) {
            Some(sources) => {
                let valid = self
                    .entries
                    .get(&key)
                    .is_some_and(|entry| entry.view_z == view_z && entry.sources == sources);
                if valid {
                    self.hits = self.hits.saturating_add(1);
                } else {
                    let mut solid = Box::new([0_u8; CHUNK_AREA]);
                    build_solid_mask(client, base_xy, view_z, &mut solid);
                    self.entries.insert(
                        key,
                        TopmostColumn {
                            view_z,
                            sources,
                            solid,
                        },
                    );
                    self.rebuilds = self.rebuilds.saturating_add(1);
                }
                &self
                    .entries
                    .get(&key)
                    .expect("entry inserted or validated above")
                    .solid
            }
            None => {
                // A required source chunk is missing from the projection:
                // fail closed, recompute per frame, and never cache.
                self.entries.remove(&key);
                self.rebuilds = self.rebuilds.saturating_add(1);
                build_solid_mask(client, base_xy, view_z, &mut self.scratch);
                &self.scratch
            }
        }
    }

    fn retain_columns(&mut self, keys: &HashSet<(i32, i32)>) {
        self.entries.retain(|key, _| keys.contains(key));
    }
}

/// Exact source tuples for a column's scanned z slice, or [`None`] when any
/// in-world source chunk is missing from the projection.
fn column_sources(client: &ClientView, key: (i32, i32), view_z: i32) -> Option<Vec<(i32, u64)>> {
    let dims = client.world_chunks;
    let z_chunks = i32::try_from(dims.z).ok()?;
    let center = z_chunks / 2;
    let z_lo = view_z - Z_LEVELS_BELOW;
    let mut sources = Vec::with_capacity(2);
    for cz in -center..(z_chunks - center) {
        let chunk = Vec3i::new(key.0, key.1, cz);
        let Some(base) = chunk_min_world_position(chunk, dims) else {
            continue;
        };
        let edge = i32::try_from(SUPPORTED_CHUNK_EDGE).expect("chunk edge fits in i32");
        if base.z > view_z || base.z + edge - 1 < z_lo {
            continue;
        }
        let view = client.chunks.get(&chunk)?;
        sources.push((cz, view.terrain_revision));
    }
    Some(sources)
}

fn build_solid_mask(
    client: &ClientView,
    base_xy: [i32; 2],
    view_z: i32,
    out: &mut [u8; CHUNK_AREA],
) {
    out.fill(0);
    let edge = i32::try_from(SUPPORTED_CHUNK_EDGE).expect("chunk edge fits in i32");
    for ty in 0..edge {
        for tx in 0..edge {
            let tile_x = base_xy[0] + tx;
            let tile_y = base_xy[1] + ty;
            let mut bits = 0_u8;
            for offset in 0..=Z_LEVELS_BELOW {
                let pos = Vec3i::new(tile_x, tile_y, view_z - offset);
                if projected_block_at(client, pos) == Some(BlockType::SolidStone) {
                    bits |= 1 << offset;
                }
            }
            out[usize::try_from(ty * edge + tx).expect("tile index fits in usize")] = bits;
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct RenderStats {
    pub floor_quads: u32,
    pub player_quads: u32,
    pub dropped_atlas_quads: u32,
    pub dropped_draw_cmds: u32,
    /// Canonical snapshots constructed by the current RAF frame. Stage 4:
    /// the renderer consumes only `ClientView`, so this stays `0` on every
    /// frame path.
    pub snapshot_calls_last_frame: u32,
    pub visible_tiles: u32,
    pub remembered_tiles: u32,
}

pub struct RenderInput<'a> {
    pub client: &'a ClientView,
    pub view: &'a LocalWorldView,
    /// Fixed-tick interpolation factor in `[0, 1]`: `0` renders the start of
    /// the current tick interval (`prev_xy`), `1` renders the tick-exit
    /// position (`curr_xy`).
    pub alpha: f32,
}

pub struct RenderOutput {
    pub stats: RenderStats,
}

pub fn render(
    input: RenderInput<'_>,
    perspective: &EntityPerspective,
    caches: &mut RenderCaches,
    atlas_quads: &mut Vec<WorldAtlasQuadInstance>,
    draw_cmds: &mut Vec<DrawCmd>,
) -> RenderOutput {
    // Visible tiles are an entity-mode concept; master mode paints terrain
    // directly (legacy parity: the set-based renderer cleared the visible
    // set on every master frame and therefore reported zero).
    let visible_tiles = if input.view.view_mode == WorldViewMode::Entity {
        perspective.visible_tile_count()
    } else {
        0
    };
    let mut stats = RenderStats {
        visible_tiles: u32::try_from(visible_tiles).unwrap_or(u32::MAX),
        remembered_tiles: u32::try_from(perspective.remembered_tile_count()).unwrap_or(u32::MAX),
        ..RenderStats::default()
    };

    emit_floor_quads(
        input.client,
        input.view,
        perspective,
        &mut caches.topmost,
        atlas_quads,
        draw_cmds,
        &mut stats,
    );

    let player_start = atlas_quads.len();
    emit_player_quad(&input, perspective, atlas_quads, &mut stats);
    push_cmd(
        draw_cmds,
        player_start,
        atlas_quads.len() - player_start,
        TEXTURE_ID_SPRITE,
        &mut stats,
    );

    RenderOutput { stats }
}

fn push_cmd(
    draw_cmds: &mut Vec<DrawCmd>,
    instance_offset: usize,
    instance_count: usize,
    texture_id: u32,
    stats: &mut RenderStats,
) {
    if instance_count == 0 {
        return;
    }
    if draw_cmds.len() >= draw_cmds.capacity() {
        stats.dropped_draw_cmds = stats.dropped_draw_cmds.saturating_add(1);
        return;
    }
    draw_cmds.push(DrawCmd {
        program: DRAWCMD_PROGRAM_WORLD_ATLAS_QUAD,
        instance_offset: u32::try_from(instance_offset).unwrap_or(u32::MAX),
        instance_count: u32::try_from(instance_count).unwrap_or(u32::MAX),
        scissor_x: -1,
        scissor_y: -1,
        scissor_w: -1,
        scissor_h: -1,
        reserved: texture_id,
    });
}

fn emit_floor_quads(
    client: &ClientView,
    view: &LocalWorldView,
    perspective: &EntityPerspective,
    topmost: &mut TopmostCache,
    atlas_quads: &mut Vec<WorldAtlasQuadInstance>,
    draw_cmds: &mut Vec<DrawCmd>,
    stats: &mut RenderStats,
) {
    let mut floor_batch_start = atlas_quads.len();
    let mut floor_batch_count = 0_usize;
    let mut visible_columns: HashSet<(i32, i32)> = HashSet::new();
    let edge = i32::try_from(SUPPORTED_CHUNK_EDGE).expect("chunk edge fits in i32");
    for chunk in &view.visible_chunks {
        let Some(base) = chunk_min_world_position(*chunk, client.world_chunks) else {
            continue;
        };
        let key = (chunk.x, chunk.y);
        visible_columns.insert(key);
        let mask = *topmost.solid_mask(client, key, [base.x, base.y], view.view_z);
        for ty in 0..edge {
            for tx in 0..edge {
                let tile_x = base.x + tx;
                let tile_y = base.y + ty;
                let bits = mask[usize::try_from(ty * edge + tx).expect("tile index fits in usize")];
                let Some((floor_z, visibility_state)) =
                    topmost_floor(bits, perspective, client.world_chunks, view, tile_x, tile_y)
                else {
                    continue;
                };
                if atlas_quads.len() == atlas_quads.capacity() {
                    stats.dropped_atlas_quads = stats.dropped_atlas_quads.saturating_add(1);
                    continue;
                }
                let z_offset = floor_z - view.view_z;
                let (tint, alpha) = match visibility_state {
                    TileVisibility::Remembered => (REMEMBERED_TINT, 0.95),
                    TileVisibility::Visible | TileVisibility::Unseen => {
                        let idx = usize::try_from((-z_offset).max(0)).unwrap_or(usize::MAX);
                        (DEPTH_TINTS[idx.min(DEPTH_TINTS.len() - 1)], 1.0)
                    }
                };
                atlas_quads.push(WorldAtlasQuadInstance {
                    pos: [tile_x as f32 * TILE_SIZE_PX, tile_y as f32 * TILE_SIZE_PX],
                    size: [TILE_SIZE_PX, TILE_SIZE_PX],
                    uv_rect: floor_uv_rect(),
                    tint,
                    alpha,
                });
                stats.floor_quads = stats.floor_quads.saturating_add(1);
                floor_batch_count += 1;
                if floor_batch_count >= MAX_WORLD_ATLAS_INSTANCES_PER_DRAW {
                    push_cmd(
                        draw_cmds,
                        floor_batch_start,
                        floor_batch_count,
                        TEXTURE_ID_FLOOR,
                        stats,
                    );
                    floor_batch_start = atlas_quads.len();
                    floor_batch_count = 0;
                }
            }
        }
    }
    push_cmd(
        draw_cmds,
        floor_batch_start,
        floor_batch_count,
        TEXTURE_ID_FLOOR,
        stats,
    );
    topmost.retain_columns(&visible_columns);
}

/// Topmost solid floor for one tile from the column's terrain-solid bits,
/// scanning `view_z` downward. In entity mode, visible tiles use projected
/// terrain, remembered tiles use perspective memory, and unseen tiles are
/// skipped (legacy semantics preserved exactly).
fn topmost_floor(
    solid_bits: u8,
    perspective: &EntityPerspective,
    dims: Vec3u,
    view: &LocalWorldView,
    tile_x: i32,
    tile_y: i32,
) -> Option<(i32, TileVisibility)> {
    for offset in 0..=Z_LEVELS_BELOW {
        let z = view.view_z - offset;
        let terrain_solid = solid_bits & (1 << offset) != 0;
        if view.view_mode == WorldViewMode::Entity {
            let pos = Vec3i::new(tile_x, tile_y, z);
            match tile_visibility(perspective, dims, pos) {
                TileVisibility::Visible => {
                    if terrain_solid {
                        return Some((z, TileVisibility::Visible));
                    }
                }
                TileVisibility::Remembered => {
                    if perspective.remembered_block(pos, dims) == Some(BlockType::SolidStone) {
                        return Some((z, TileVisibility::Remembered));
                    }
                }
                TileVisibility::Unseen => {}
            }
        } else if terrain_solid {
            return Some((z, TileVisibility::Visible));
        }
    }
    None
}

fn emit_player_quad(
    input: &RenderInput<'_>,
    perspective: &EntityPerspective,
    atlas_quads: &mut Vec<WorldAtlasQuadInstance>,
    stats: &mut RenderStats,
) {
    let Some(player) = primary_entity(input.client) else {
        return;
    };
    let z_offset = player.position.z - input.view.view_z;
    if z_offset < -Z_LEVELS_BELOW {
        return;
    }
    if input.view.view_mode == WorldViewMode::Entity
        && !perspective.is_visible(player.position, input.client.world_chunks)
    {
        return;
    }
    if player_occluded(input.client, player, input.view.view_z) {
        return;
    }
    if atlas_quads.len() == atlas_quads.capacity() {
        stats.dropped_atlas_quads = stats.dropped_atlas_quads.saturating_add(1);
        return;
    }
    let [x, y] = lerp_xy(player.prev_xy, player.curr_xy, input.alpha);
    let tint = if z_offset < 0 {
        let idx = usize::try_from(-z_offset).unwrap_or(usize::MAX);
        DEPTH_TINTS[idx.min(DEPTH_TINTS.len() - 1)]
    } else {
        [1.0, 1.0, 1.0]
    };
    atlas_quads.push(WorldAtlasQuadInstance {
        pos: [x * TILE_SIZE_PX, y * TILE_SIZE_PX],
        size: [TILE_SIZE_PX, TILE_SIZE_PX],
        uv_rect: player_uv_rect(player.facing_left),
        tint,
        alpha: 1.0,
    });
    stats.player_quads = 1;
}

fn player_occluded(client: &ClientView, player: &EntityView, view_z: i32) -> bool {
    let player_pos = player.position;
    if player_pos.z == view_z {
        return false;
    }
    let lo = if player_pos.z < view_z {
        player_pos.z + 1
    } else {
        view_z + 1
    };
    let hi = if player_pos.z < view_z {
        view_z
    } else {
        player_pos.z
    };
    (lo..=hi).any(|z| known_solid(client, Vec3i::new(player_pos.x, player_pos.y, z)))
}

/// Fail-closed block lookup over the projection.
///
/// - Outside the world: `Some(Air)` (known void, legacy parity).
/// - Inside the world but chunk not projected: `None` (missing).
pub(crate) fn projected_block_at(client: &ClientView, pos: Vec3i) -> Option<BlockType> {
    match world_position_to_chunk_voxel(pos, client.world_chunks) {
        None => Some(BlockType::Air),
        Some((chunk, voxel)) => client.chunks.get(&chunk).map(|view| view.blocks[voxel]),
    }
}

/// Solid only when the block is known solid (missing chunks are not solid
/// for render purposes: nothing is emitted for them).
fn known_solid(client: &ClientView, pos: Vec3i) -> bool {
    projected_block_at(client, pos) == Some(BlockType::SolidStone)
}

pub(crate) fn primary_entity(client: &ClientView) -> Option<&EntityView> {
    client
        .primary_entity_id
        .and_then(|id| client.entity(id))
        .or_else(|| client.entities.first())
}

/// Fixed-tick interpolation between two tick-boundary render positions.
///
/// Endpoints are exact by construction: `alpha <= 0` returns `prev`
/// bit-identically and `alpha >= 1` returns `curr` bit-identically (never
/// `prev + (curr - prev) * 1.0`, which can differ in f32). Interior alphas
/// use the standard `prev + (curr - prev) * alpha` form.
#[must_use]
pub fn lerp_xy(prev: [f32; 2], curr: [f32; 2], alpha: f32) -> [f32; 2] {
    if alpha <= 0.0 {
        return prev;
    }
    if alpha >= 1.0 {
        return curr;
    }
    [
        prev[0] + (curr[0] - prev[0]) * alpha,
        prev[1] + (curr[1] - prev[1]) * alpha,
    ]
}

#[must_use]
pub fn entity_render_position_xy(entity: &EntitySnapshot) -> [f32; 2] {
    if let Some(movement) = entity.movement.as_ref() {
        let fraction = f32::from(movement.progress_percent) / 100.0;
        [
            movement.start_position[0]
                + (movement.target.x as f32 - movement.start_position[0]) * fraction,
            movement.start_position[1]
                + (movement.target.y as f32 - movement.start_position[1]) * fraction,
        ]
    } else {
        [entity.position.x as f32, entity.position.y as f32]
    }
}

const fn floor_uv_rect() -> [f32; 4] {
    [
        0.0,
        FLOOR_FRAME / FLOOR_ATLAS_FRAMES,
        1.0,
        1.0 / FLOOR_ATLAS_FRAMES,
    ]
}

const fn player_uv_rect(facing_left: bool) -> [f32; 4] {
    if facing_left {
        [1.0, 0.0, -1.0, 1.0]
    } else {
        [0.0, 0.0, 1.0, 1.0]
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use od_core::world::chunk::chunk_index_to_coord;
    use od_core::{Vec3u, WorldConfig, WorldViewMode};

    use crate::project::{project_entities, recompute_entity_perspective, sync_view_chunks};
    use crate::{WorldSim, test_util};

    use super::*;

    /// Project the complete world (every simulation-resident chunk) plus
    /// entities into a fresh ClientView.
    fn full_client_view(sim: &WorldSim) -> ClientView {
        let mut client = ClientView {
            tick: sim.tick_count(),
            world_chunks: sim.world_chunks(),
            ..ClientView::default()
        };
        sync_full_client_view(sim, &mut client);
        client
    }

    fn sync_full_client_view(sim: &WorldSim, client: &mut ClientView) {
        let dims = sim.world_chunks();
        let count = (dims.x * dims.y * dims.z) as usize;
        let desired: BTreeSet<Vec3i> = (0..count)
            .filter_map(|index| chunk_index_to_coord(index, dims))
            .collect();
        sync_view_chunks(client, sim.state(), &desired);
        project_entities(client, sim.state(), sim.primary_entity_id());
        client.tick = sim.tick_count();
    }

    fn all_chunks(sim: &WorldSim) -> Vec<Vec3i> {
        let dims = sim.world_chunks();
        let count = (dims.x * dims.y * dims.z) as usize;
        (0..count)
            .filter_map(|index| chunk_index_to_coord(index, dims))
            .collect()
    }

    fn render_once(
        client: &ClientView,
        view: &LocalWorldView,
        perspective: &EntityPerspective,
        caches: &mut RenderCaches,
        atlas: &mut Vec<WorldAtlasQuadInstance>,
        cmds: &mut Vec<DrawCmd>,
    ) -> RenderOutput {
        render_once_with_alpha(client, view, perspective, caches, atlas, cmds, 0.0)
    }

    #[allow(clippy::too_many_arguments)]
    fn render_once_with_alpha(
        client: &ClientView,
        view: &LocalWorldView,
        perspective: &EntityPerspective,
        caches: &mut RenderCaches,
        atlas: &mut Vec<WorldAtlasQuadInstance>,
        cmds: &mut Vec<DrawCmd>,
        alpha: f32,
    ) -> RenderOutput {
        atlas.clear();
        cmds.clear();
        render(
            RenderInput {
                client,
                view,
                alpha,
            },
            perspective,
            caches,
            atlas,
            cmds,
        )
    }

    /// Tick-time perspective for a projected client view (entity mode).
    fn recomputed_perspective(client: &ClientView) -> EntityPerspective {
        let mut perspective = EntityPerspective::default();
        recompute_entity_perspective(&mut perspective, client);
        perspective
    }

    #[test]
    fn render_emits_floor_and_player_quads() {
        let sim = WorldSim::new(WorldConfig::default(), true);
        let client = full_client_view(&sim);
        let mut view = LocalWorldView::default();
        view.view_z = sim.entity_position(1).expect("player").z;
        view.view_mode = WorldViewMode::Master;
        view.visible_chunks = all_chunks(&sim);
        let perspective = EntityPerspective::default();
        let mut caches = RenderCaches::default();
        let mut atlas = Vec::with_capacity(4096);
        let mut cmds = Vec::with_capacity(8);

        let out = render_once(
            &client,
            &view,
            &perspective,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );

        assert!(out.stats.floor_quads > 0);
        assert_eq!(out.stats.player_quads, 1);
        assert_eq!(cmds.len(), 2);
        assert_eq!(cmds[0].reserved, TEXTURE_ID_FLOOR);
        assert_eq!(cmds[1].reserved, TEXTURE_ID_SPRITE);
    }

    #[test]
    fn render_splits_floor_draw_cmds_at_webgl_instance_limit() {
        let sim = WorldSim::new(
            WorldConfig {
                world_chunks: Vec3u::new(9, 9, 1),
                ..WorldConfig::default()
            },
            true,
        );
        let client = full_client_view(&sim);
        let mut view = LocalWorldView::default();
        view.view_z = sim.entity_position(1).expect("player").z;
        view.view_mode = WorldViewMode::Master;
        view.visible_chunks = all_chunks(&sim);
        let perspective = EntityPerspective::default();
        let mut caches = RenderCaches::default();
        let mut atlas = Vec::with_capacity(24_000);
        let mut cmds = Vec::with_capacity(8);

        let out = render_once(
            &client,
            &view,
            &perspective,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );

        assert!(out.stats.floor_quads > MAX_WORLD_ATLAS_INSTANCES_PER_DRAW as u32);
        assert_eq!(cmds[0].reserved, TEXTURE_ID_FLOOR);
        assert_eq!(
            cmds[0].instance_count,
            MAX_WORLD_ATLAS_INSTANCES_PER_DRAW as u32
        );
        assert_eq!(cmds.last().expect("player cmd").reserved, TEXTURE_ID_SPRITE);
    }

    /// Stage 5: render consumes the perspective immutably — an unchanged
    /// perspective renders value-identical entity-mode output, and stats
    /// mirror the bitmap/memory counts without render-side recomputation.
    #[test]
    fn entity_mode_renders_from_immutable_perspective_bitmaps() {
        let sim = WorldSim::new(WorldConfig::default(), true);
        let client = full_client_view(&sim);
        let mut view = LocalWorldView::default();
        view.view_z = sim.entity_position(1).expect("player").z;
        view.visible_chunks = all_chunks(&sim);
        let perspective = recomputed_perspective(&client);
        assert_eq!(perspective.fov_recompute_count, 1);
        let mut caches = RenderCaches::default();
        let mut atlas = Vec::with_capacity(4096);
        let mut cmds = Vec::with_capacity(8);

        let first = render_once(
            &client,
            &view,
            &perspective,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );
        assert!(first.stats.floor_quads > 0);
        assert_eq!(first.stats.player_quads, 1);
        assert_eq!(
            first.stats.visible_tiles as usize,
            perspective.visible_tile_count()
        );
        let first_quads = atlas.clone();

        // Rendering again from the same immutable perspective is
        // value-identical and performed zero recomputes.
        let second = render_once(
            &client,
            &view,
            &perspective,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );
        assert_eq!(perspective.fov_recompute_count, 1);
        assert_eq!(second.stats.floor_quads, first.stats.floor_quads);
        assert_eq!(atlas.len(), first_quads.len());
        assert!(
            atlas.iter().zip(first_quads.iter()).all(|(a, b)| {
                a.pos == b.pos && a.uv_rect == b.uv_rect && a.tint == b.tint && a.alpha == b.alpha
            }),
            "identical perspective => identical emission"
        );
    }

    #[test]
    fn entity_mode_fov_creates_memory_after_motion() {
        let mut sim = WorldSim::new(WorldConfig::default(), true);
        let mut caches = RenderCaches::default();
        let mut atlas = Vec::with_capacity(4096);
        let mut cmds = Vec::with_capacity(8);
        let mut client = full_client_view(&sim);
        let mut view = LocalWorldView::default();
        view.view_z = sim.entity_position(1).expect("player").z;
        view.visible_chunks = all_chunks(&sim);
        let mut perspective = EntityPerspective::default();
        recompute_entity_perspective(&mut perspective, &client);

        let out = render_once(
            &client,
            &view,
            &perspective,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );
        let visible_before = out.stats.visible_tiles;

        sim.send_command(od_core::WorldCommand::MoveEntity {
            id: 1,
            direction: Vec3i::new(-1, 0, 0),
        })
        .expect("starter room west move");
        sim.step_ticks(10);
        sync_full_client_view(&sim, &mut client);
        // Tick-exit recompute after the origin change.
        recompute_entity_perspective(&mut perspective, &client);
        let out = render_once(
            &client,
            &view,
            &perspective,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );

        assert!(visible_before > 0);
        assert!(out.stats.remembered_tiles > 0);
        assert_eq!(perspective.fov_recompute_count, 2);
    }

    #[test]
    fn master_mode_preserves_entity_fov_memory() {
        let mut sim = WorldSim::new(WorldConfig::default(), true);
        let mut caches = RenderCaches::default();
        let mut atlas = Vec::with_capacity(4096);
        let mut cmds = Vec::with_capacity(8);
        let mut client = full_client_view(&sim);
        let mut view = LocalWorldView::default();
        view.view_z = sim.entity_position(1).expect("player").z;
        view.visible_chunks = all_chunks(&sim);
        let mut perspective = EntityPerspective::default();
        recompute_entity_perspective(&mut perspective, &client);

        sim.send_command(od_core::WorldCommand::MoveEntity {
            id: 1,
            direction: Vec3i::new(-1, 0, 0),
        })
        .expect("starter room west move");
        sim.step_ticks(10);
        sync_full_client_view(&sim, &mut client);
        recompute_entity_perspective(&mut perspective, &client);
        let remembered_before_master = perspective.remembered_tile_count();
        assert!(remembered_before_master > 0);

        // Master-mode maintenance clears visible state but preserves memory.
        view.view_mode = WorldViewMode::Master;
        perspective.clear_visible_preserve_memory();
        let out = render_once(
            &client,
            &view,
            &perspective,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );

        assert_eq!(perspective.visible_tile_count(), 0);
        assert_eq!(out.stats.visible_tiles, 0);
        assert_eq!(
            perspective.remembered_tile_count(),
            remembered_before_master
        );
        assert_eq!(
            out.stats.remembered_tiles as usize,
            remembered_before_master
        );
    }

    #[test]
    fn render_fails_closed_on_missing_projected_chunks() {
        let sim = WorldSim::new(
            WorldConfig {
                world_chunks: Vec3u::new(9, 9, 1),
                ..WorldConfig::default()
            },
            true,
        );
        let mut client = full_client_view(&sim);
        let missing = Vec3i::new(4, 4, 0);
        client.chunks.remove(&missing);
        let mut view = LocalWorldView::default();
        view.view_z = sim.entity_position(1).expect("player").z;
        view.view_mode = WorldViewMode::Master;
        view.visible_chunks = all_chunks(&sim);
        let perspective = EntityPerspective::default();
        let mut caches = RenderCaches::default();
        let mut atlas = Vec::with_capacity(24_000);
        let mut cmds = Vec::with_capacity(8);

        let out = render_once(
            &client,
            &view,
            &perspective,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );

        // The missing chunk's tiles emit nothing (fail closed), everything
        // else still renders.
        assert!(out.stats.floor_quads > 0);
        let base = chunk_min_world_position(missing, sim.world_chunks()).expect("base");
        let min_px = [base.x as f32 * TILE_SIZE_PX, base.y as f32 * TILE_SIZE_PX];
        let max_px = [
            (base.x + 16) as f32 * TILE_SIZE_PX,
            (base.y + 16) as f32 * TILE_SIZE_PX,
        ];
        // Only floor quads are position-tested; the player quad is unrelated.
        let floor_quads = out.stats.floor_quads as usize;
        assert!(
            atlas[..floor_quads].iter().all(|quad| {
                quad.pos[0] < min_px[0]
                    || quad.pos[0] >= max_px[0]
                    || quad.pos[1] < min_px[1]
                    || quad.pos[1] >= max_px[1]
            }),
            "no floor quad may come from the missing chunk"
        );
        // The uncached (fail-closed) column is never stored.
        assert!(!caches.topmost.entries.contains_key(&(4, 4)));
    }

    #[test]
    fn topmost_cache_hits_on_repeat_and_invalidates_on_view_z_change() {
        let sim = WorldSim::new(WorldConfig::default(), true);
        let client = full_client_view(&sim);
        let mut view = LocalWorldView::default();
        view.view_z = sim.entity_position(1).expect("player").z;
        view.view_mode = WorldViewMode::Master;
        view.visible_chunks = all_chunks(&sim);
        let perspective = EntityPerspective::default();
        let mut caches = RenderCaches::default();
        let mut atlas = Vec::with_capacity(4096);
        let mut cmds = Vec::with_capacity(8);

        let first = render_once(
            &client,
            &view,
            &perspective,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );
        assert_eq!(caches.topmost.rebuilds(), 1, "one visible column built");
        assert_eq!(caches.topmost.hits(), 0);
        let first_quads = atlas.clone();

        let second = render_once(
            &client,
            &view,
            &perspective,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );
        assert_eq!(caches.topmost.rebuilds(), 1, "second frame is a pure hit");
        assert_eq!(caches.topmost.hits(), 1);
        assert_eq!(atlas.len(), first_quads.len());
        assert!(
            atlas.iter().zip(first_quads.iter()).all(|(a, b)| {
                a.pos == b.pos
                    && a.size == b.size
                    && a.uv_rect == b.uv_rect
                    && a.tint == b.tint
                    && a.alpha == b.alpha
            }),
            "cached emission is value-identical"
        );
        assert_eq!(second.stats.floor_quads, first.stats.floor_quads);

        // view_z change invalidates the column even though terrain did not
        // change.
        view.view_z -= 1;
        let _ = render_once(
            &client,
            &view,
            &perspective,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );
        assert_eq!(caches.topmost.rebuilds(), 2, "view_z change rebuilds");
        assert_eq!(caches.topmost.hits(), 1, "no false hit after view_z change");
        let entry = caches.topmost.entries.values().next().expect("column");
        assert_eq!(entry.view_z, view.view_z, "entry rekeyed to the new view_z");
    }

    #[test]
    fn topmost_cache_invalidates_for_both_source_z_chunks_in_slice() {
        // 1x1x2 world: z voxels span [-16, 15]; view_z = 2 scans [-3, 2],
        // which crosses the z-chunk boundary at 0 and therefore depends on
        // both z-chunk sources (-1 and 0).
        let mut sim = WorldSim::new(
            WorldConfig {
                world_chunks: Vec3u::new(1, 1, 2),
                ..WorldConfig::default()
            },
            false,
        );
        let client = full_client_view(&sim);
        let mut view = LocalWorldView::default();
        view.view_z = 2;
        view.view_mode = WorldViewMode::Master;
        view.visible_chunks = vec![Vec3i::new(0, 0, 0)];
        let perspective = EntityPerspective::default();
        let mut caches = RenderCaches::default();
        let mut atlas = Vec::with_capacity(4096);
        let mut cmds = Vec::with_capacity(8);

        let _ = render_once(
            &client,
            &view,
            &perspective,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );
        let entry = caches.topmost.entries.get(&(0, 0)).expect("cached column");
        assert_eq!(
            entry.sources,
            vec![(-1, 0), (0, 0)],
            "slice [-3, 2] depends on exactly the two source z-chunks"
        );
        assert_eq!(caches.topmost.rebuilds(), 1);

        // Mutating the upper source z-chunk (z in [0, 2]) invalidates.
        let upper_pos = Vec3i::new(3, 3, 1);
        let before = projected_block_at(&client, upper_pos).expect("known");
        let flipped = if before == BlockType::SolidStone {
            BlockType::Air
        } else {
            BlockType::SolidStone
        };
        assert!(test_util::set_block(&mut sim, upper_pos, flipped));
        let client = full_client_view(&sim);
        let _ = render_once(
            &client,
            &view,
            &perspective,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );
        assert_eq!(
            caches.topmost.rebuilds(),
            2,
            "upper z-chunk revision change rebuilds the column"
        );
        let entry = caches.topmost.entries.get(&(0, 0)).expect("cached column");
        assert_eq!(entry.sources, vec![(-1, 0), (0, 1)]);

        // Mutating the lower source z-chunk (z in [-3, -1]) also invalidates.
        let lower_pos = Vec3i::new(5, 5, -2);
        let before = projected_block_at(&client, lower_pos).expect("known");
        let flipped = if before == BlockType::SolidStone {
            BlockType::Air
        } else {
            BlockType::SolidStone
        };
        assert!(test_util::set_block(&mut sim, lower_pos, flipped));
        let client = full_client_view(&sim);
        let _ = render_once(
            &client,
            &view,
            &perspective,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );
        assert_eq!(
            caches.topmost.rebuilds(),
            3,
            "lower z-chunk revision change rebuilds the column"
        );
        let entry = caches.topmost.entries.get(&(0, 0)).expect("cached column");
        assert_eq!(entry.sources, vec![(-1, 1), (0, 1)]);

        // A z-chunk outside the scanned slice is not a dependency: view_z
        // deep in the lower chunk depends only on that chunk.
        view.view_z = -10; // slice [-15, -10] stays inside z-chunk -1
        let _ = render_once(
            &client,
            &view,
            &perspective,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );
        let entry = caches.topmost.entries.get(&(0, 0)).expect("cached column");
        assert_eq!(entry.sources, vec![(-1, 1)], "single-source slice");
    }

    #[test]
    fn topmost_cache_evicts_columns_leaving_the_visible_window() {
        let sim = WorldSim::new(
            WorldConfig {
                world_chunks: Vec3u::new(9, 9, 1),
                ..WorldConfig::default()
            },
            false,
        );
        let client = full_client_view(&sim);
        let mut view = LocalWorldView::default();
        view.view_z = 0;
        view.view_mode = WorldViewMode::Master;
        view.visible_chunks = vec![Vec3i::new(0, 0, 0), Vec3i::new(1, 0, 0)];
        let perspective = EntityPerspective::default();
        let mut caches = RenderCaches::default();
        let mut atlas = Vec::with_capacity(8192);
        let mut cmds = Vec::with_capacity(8);

        let _ = render_once(
            &client,
            &view,
            &perspective,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );
        assert_eq!(caches.topmost.len(), 2);

        view.visible_chunks = vec![Vec3i::new(1, 0, 0), Vec3i::new(2, 0, 0)];
        let _ = render_once(
            &client,
            &view,
            &perspective,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );
        assert_eq!(caches.topmost.len(), 2);
        assert!(!caches.topmost.entries.contains_key(&(0, 0)), "evicted");
        assert!(caches.topmost.entries.contains_key(&(2, 0)), "entered");
        assert_eq!(caches.topmost.hits(), 1, "the retained column was a hit");
    }

    /// Stage 6: `lerp_xy` endpoint and interior semantics are exact.
    ///
    /// `alpha == 0` is the start of the tick interval (`prev`, bit-exact),
    /// `alpha == 1` is the tick-exit position (`curr`, bit-exact), interior
    /// alphas use `prev + (curr - prev) * alpha` in f32, and out-of-range
    /// alphas clamp to the endpoints.
    #[test]
    fn lerp_xy_endpoints_bit_exact_midpoint_exact_and_clamped() {
        // Chosen so that `prev + (curr - prev) * 1.0` is NOT bit-equal to
        // `curr` in f32 (rounding in the subtraction), proving the endpoint
        // branches are required for bit-exactness.
        let prev = [16_777_216.0_f32, -3.5];
        let curr = [0.1_f32, 7.25];
        assert_ne!(
            (prev[0] + (curr[0] - prev[0]) * 1.0).to_bits(),
            curr[0].to_bits(),
            "fixture must exercise the f32 endpoint hazard"
        );

        let at0 = lerp_xy(prev, curr, 0.0);
        assert_eq!(at0[0].to_bits(), prev[0].to_bits(), "alpha 0 == prev.x");
        assert_eq!(at0[1].to_bits(), prev[1].to_bits(), "alpha 0 == prev.y");
        let at1 = lerp_xy(prev, curr, 1.0);
        assert_eq!(at1[0].to_bits(), curr[0].to_bits(), "alpha 1 == curr.x");
        assert_eq!(at1[1].to_bits(), curr[1].to_bits(), "alpha 1 == curr.y");

        // Interior alpha: exact f32 formula.
        let mid = lerp_xy([1.25, 2.5], [4.75, -3.5], 0.5);
        assert_eq!(mid[0].to_bits(), (1.25_f32 + (4.75 - 1.25) * 0.5).to_bits());
        assert_eq!(mid[1].to_bits(), (2.5_f32 + (-3.5 - 2.5) * 0.5).to_bits());

        // Alpha never exceeds [0, 1]: out-of-range clamps to the endpoints.
        assert_eq!(lerp_xy(prev, curr, -0.25), prev);
        assert_eq!(lerp_xy(prev, curr, 1.75), curr);
    }

    /// Stage 6: the player quad position equals the fixed-tick lerp result
    /// exactly (bit-exact f32 math) at alpha 0, an interior alpha, and 1.
    /// There is no other smoothing input to the player quad.
    #[test]
    fn player_quad_position_is_exact_fixed_tick_lerp() {
        let sim = WorldSim::new(WorldConfig::default(), true);
        let mut client = full_client_view(&sim);
        let player_id = client.primary_entity_id.expect("primary entity");
        let index = client
            .entities
            .iter()
            .position(|entity| entity.id == player_id)
            .expect("projected player");
        let prev = [-6.0_f32, 1.0];
        let curr = [-5.0_f32, 1.0];
        client.entities[index].prev_xy = prev;
        client.entities[index].curr_xy = curr;
        let mut view = LocalWorldView::default();
        view.view_z = sim.entity_position(player_id).expect("player").z;
        view.view_mode = WorldViewMode::Master;
        view.visible_chunks = all_chunks(&sim);
        let perspective = EntityPerspective::default();
        let mut caches = RenderCaches::default();
        let mut atlas = Vec::with_capacity(4096);
        let mut cmds = Vec::with_capacity(8);

        for alpha in [0.0_f32, 0.5, 0.3, 1.0] {
            let out = render_once_with_alpha(
                &client,
                &view,
                &perspective,
                &mut caches,
                &mut atlas,
                &mut cmds,
                alpha,
            );
            assert_eq!(out.stats.player_quads, 1);
            let player_quad = atlas.last().expect("player quad is emitted last");
            let expected = lerp_xy(prev, curr, alpha);
            assert_eq!(
                player_quad.pos[0].to_bits(),
                (expected[0] * TILE_SIZE_PX).to_bits(),
                "player x at alpha {alpha}"
            );
            assert_eq!(
                player_quad.pos[1].to_bits(),
                (expected[1] * TILE_SIZE_PX).to_bits(),
                "player y at alpha {alpha}"
            );
        }

        // Value-level endpoint checks: alpha 0 renders prev, alpha 1 curr.
        let _ = render_once_with_alpha(
            &client,
            &view,
            &perspective,
            &mut caches,
            &mut atlas,
            &mut cmds,
            0.0,
        );
        assert_eq!(
            atlas.last().expect("player").pos,
            [prev[0] * TILE_SIZE_PX, prev[1] * TILE_SIZE_PX]
        );
        let _ = render_once_with_alpha(
            &client,
            &view,
            &perspective,
            &mut caches,
            &mut atlas,
            &mut cmds,
            1.0,
        );
        assert_eq!(
            atlas.last().expect("player").pos,
            [curr[0] * TILE_SIZE_PX, curr[1] * TILE_SIZE_PX]
        );
    }
}
