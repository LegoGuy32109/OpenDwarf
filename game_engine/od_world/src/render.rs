//! World renderer (Stage 4): consumes the projected [`ClientView`].
//!
//! Render never reaches `WorldState` or a `WorldSnapshot`: floor emission,
//! the player quad, occlusion, topmost scans, and the legacy FOV all read
//! the locally projected `ClientView` (plus [`VisibilityState`] memory).
//!
//! Fail-closed lookup rules:
//! - Positions outside the world are known void ([`BlockType::Air`]),
//!   matching the legacy sparse-snapshot semantics.
//! - Positions whose chunk is not projected are *missing*: render skips
//!   them (nothing is emitted) and LOS treats them as opaque.

use std::collections::{HashMap, HashSet};

use od_core::client_view::{ClientView, EntityView};
use od_core::world::chunk::{CHUNK_AREA, SUPPORTED_CHUNK_EDGE, chunk_min_world_position};
use od_core::{
    BlockType, DRAWCMD_PROGRAM_WORLD_ATLAS_QUAD, DrawCmd, EntitySnapshot, LocalWorldView,
    TEXTURE_ID_FLOOR, TEXTURE_ID_SPRITE, Vec3i, WorldAtlasQuadInstance, WorldViewMode,
    world_position_to_chunk_voxel,
};

const TILE_SIZE_PX: f32 = 64.0;
const Z_LEVELS_BELOW: i32 = 5;
const FOV_RADIUS: i32 = 20;
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

#[derive(Debug, Clone, Copy)]
struct TileMemory {
    block: BlockType,
}

#[derive(Debug, Clone)]
pub struct VisibilityState {
    visible: HashSet<Vec3i>,
    memory: HashMap<Vec3i, TileMemory>,
    fov_dirty: bool,
    fov_recompute_count: u64,
}

impl Default for VisibilityState {
    fn default() -> Self {
        Self {
            visible: HashSet::new(),
            memory: HashMap::new(),
            fov_dirty: true,
            fov_recompute_count: 0,
        }
    }
}

impl VisibilityState {
    pub fn reset(&mut self) {
        self.visible.clear();
        self.memory.clear();
        self.fov_dirty = true;
        self.fov_recompute_count = 0;
    }

    pub fn mark_fov_dirty(&mut self) {
        self.fov_dirty = true;
    }

    #[must_use]
    pub fn fov_dirty(&self) -> bool {
        self.fov_dirty
    }

    #[must_use]
    pub fn fov_recompute_count(&self) -> u64 {
        self.fov_recompute_count
    }

    #[must_use]
    pub fn visible_count(&self) -> usize {
        self.visible.len()
    }

    #[must_use]
    pub fn remembered_count(&self) -> usize {
        self.memory.len()
    }

    #[must_use]
    pub fn visibility_at(&self, pos: Vec3i) -> TileVisibility {
        if self.visible.contains(&pos) {
            TileVisibility::Visible
        } else if self.memory.contains_key(&pos) {
            TileVisibility::Remembered
        } else {
            TileVisibility::Unseen
        }
    }

    fn remembered_block_at(&self, pos: Vec3i) -> Option<BlockType> {
        self.memory.get(&pos).map(|memory| memory.block)
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
    pub smooth_player_xy: Option<[f32; 2]>,
}

pub struct RenderOutput {
    pub stats: RenderStats,
}

pub fn render(
    input: RenderInput<'_>,
    visibility: &mut VisibilityState,
    caches: &mut RenderCaches,
    atlas_quads: &mut Vec<WorldAtlasQuadInstance>,
    draw_cmds: &mut Vec<DrawCmd>,
) -> RenderOutput {
    if input.view.view_mode == WorldViewMode::Entity {
        if visibility.fov_dirty {
            recompute_fov(input.client, primary_entity(input.client), visibility);
            visibility.fov_dirty = false;
            visibility.fov_recompute_count = visibility.fov_recompute_count.saturating_add(1);
        }
    } else {
        visibility.visible.clear();
    }

    let mut stats = RenderStats {
        visible_tiles: u32::try_from(visibility.visible_count()).unwrap_or(u32::MAX),
        remembered_tiles: u32::try_from(visibility.remembered_count()).unwrap_or(u32::MAX),
        ..RenderStats::default()
    };

    emit_floor_quads(
        input.client,
        input.view,
        visibility,
        &mut caches.topmost,
        atlas_quads,
        draw_cmds,
        &mut stats,
    );

    let player_start = atlas_quads.len();
    emit_player_quad(&input, visibility, atlas_quads, &mut stats);
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
    visibility: &VisibilityState,
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
                    topmost_floor(bits, visibility, view, tile_x, tile_y)
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
    visibility: &VisibilityState,
    view: &LocalWorldView,
    tile_x: i32,
    tile_y: i32,
) -> Option<(i32, TileVisibility)> {
    for offset in 0..=Z_LEVELS_BELOW {
        let z = view.view_z - offset;
        let terrain_solid = solid_bits & (1 << offset) != 0;
        if view.view_mode == WorldViewMode::Entity {
            let pos = Vec3i::new(tile_x, tile_y, z);
            match visibility.visibility_at(pos) {
                TileVisibility::Visible => {
                    if terrain_solid {
                        return Some((z, TileVisibility::Visible));
                    }
                }
                TileVisibility::Remembered => {
                    if visibility.remembered_block_at(pos) == Some(BlockType::SolidStone) {
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
    visibility: &VisibilityState,
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
        && visibility.visibility_at(player.position) != TileVisibility::Visible
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
    let [x, y] = input.smooth_player_xy.unwrap_or(player.curr_xy);
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

fn recompute_fov(
    client: &ClientView,
    primary: Option<&EntityView>,
    visibility: &mut VisibilityState,
) {
    let Some(player) = primary else {
        visibility.visible.clear();
        return;
    };
    let position = player.position;
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
                visibility.memory.insert(pos, TileMemory { block });
            }
        }
    }
    for pos in &next_visible {
        visibility.memory.remove(pos);
    }
    visibility.visible = next_visible;
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
fn projected_block_at(client: &ClientView, pos: Vec3i) -> Option<BlockType> {
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

/// LOS blocker: known solid or an unexpectedly missing required chunk
/// (fail closed). Out-of-world void stays transparent (legacy parity).
fn opaque_for_los(client: &ClientView, pos: Vec3i) -> bool {
    !matches!(projected_block_at(client, pos), Some(BlockType::Air))
}

fn primary_entity(client: &ClientView) -> Option<&EntityView> {
    client
        .primary_entity_id
        .and_then(|id| client.entity(id))
        .or_else(|| client.entities.first())
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

    use crate::project::{project_entities, sync_view_chunks};
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
        visibility: &mut VisibilityState,
        caches: &mut RenderCaches,
        atlas: &mut Vec<WorldAtlasQuadInstance>,
        cmds: &mut Vec<DrawCmd>,
    ) -> RenderOutput {
        atlas.clear();
        cmds.clear();
        render(
            RenderInput {
                client,
                view,
                smooth_player_xy: None,
            },
            visibility,
            caches,
            atlas,
            cmds,
        )
    }

    #[test]
    fn render_emits_floor_and_player_quads() {
        let sim = WorldSim::new(WorldConfig::default(), true);
        let client = full_client_view(&sim);
        let mut view = LocalWorldView::default();
        view.view_z = sim.entity_position(1).expect("player").z;
        view.view_mode = WorldViewMode::Master;
        view.visible_chunks = all_chunks(&sim);
        let mut visibility = VisibilityState::default();
        let mut caches = RenderCaches::default();
        let mut atlas = Vec::with_capacity(4096);
        let mut cmds = Vec::with_capacity(8);

        let out = render_once(
            &client,
            &view,
            &mut visibility,
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
        let mut visibility = VisibilityState::default();
        let mut caches = RenderCaches::default();
        let mut atlas = Vec::with_capacity(24_000);
        let mut cmds = Vec::with_capacity(8);

        let out = render_once(
            &client,
            &view,
            &mut visibility,
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

    #[test]
    fn entity_mode_fov_recomputes_only_when_dirty() {
        let sim = WorldSim::new(WorldConfig::default(), true);
        let client = full_client_view(&sim);
        let mut view = LocalWorldView::default();
        view.view_z = sim.entity_position(1).expect("player").z;
        view.visible_chunks = all_chunks(&sim);
        let mut visibility = VisibilityState::default();
        let mut caches = RenderCaches::default();
        let mut atlas = Vec::with_capacity(4096);
        let mut cmds = Vec::with_capacity(8);

        let _ = render_once(
            &client,
            &view,
            &mut visibility,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );
        let first_count = visibility.fov_recompute_count();
        assert_eq!(first_count, 1);
        assert!(!visibility.fov_dirty());

        let _ = render_once(
            &client,
            &view,
            &mut visibility,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );

        assert_eq!(visibility.fov_recompute_count(), first_count);
        visibility.mark_fov_dirty();
        let _ = render_once(
            &client,
            &view,
            &mut visibility,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );
        assert_eq!(visibility.fov_recompute_count(), first_count + 1);
    }

    #[test]
    fn entity_mode_fov_creates_memory_after_motion() {
        let mut sim = WorldSim::new(WorldConfig::default(), true);
        let mut visibility = VisibilityState::default();
        let mut caches = RenderCaches::default();
        let mut atlas = Vec::with_capacity(4096);
        let mut cmds = Vec::with_capacity(8);
        let mut client = full_client_view(&sim);
        let mut view = LocalWorldView::default();
        view.view_z = sim.entity_position(1).expect("player").z;
        view.visible_chunks = all_chunks(&sim);

        let _ = render_once(
            &client,
            &view,
            &mut visibility,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );
        let visible_before = visibility.visible_count();

        sim.send_command(od_core::WorldCommand::MoveEntity {
            id: 1,
            direction: Vec3i::new(-1, 0, 0),
        })
        .expect("starter room west move");
        sim.step_ticks(10);
        sync_full_client_view(&sim, &mut client);
        visibility.mark_fov_dirty();
        let _ = render_once(
            &client,
            &view,
            &mut visibility,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );

        assert!(visible_before > 0);
        assert!(visibility.remembered_count() > 0);
    }

    #[test]
    fn master_mode_preserves_entity_fov_memory() {
        let mut sim = WorldSim::new(WorldConfig::default(), true);
        let mut visibility = VisibilityState::default();
        let mut caches = RenderCaches::default();
        let mut atlas = Vec::with_capacity(4096);
        let mut cmds = Vec::with_capacity(8);
        let mut client = full_client_view(&sim);
        let mut view = LocalWorldView::default();
        view.view_z = sim.entity_position(1).expect("player").z;
        view.visible_chunks = all_chunks(&sim);

        let _ = render_once(
            &client,
            &view,
            &mut visibility,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );
        sim.send_command(od_core::WorldCommand::MoveEntity {
            id: 1,
            direction: Vec3i::new(-1, 0, 0),
        })
        .expect("starter room west move");
        sim.step_ticks(10);
        sync_full_client_view(&sim, &mut client);
        visibility.mark_fov_dirty();
        let _ = render_once(
            &client,
            &view,
            &mut visibility,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );
        let remembered_before_master = visibility.remembered_count();
        assert!(remembered_before_master > 0);

        view.view_mode = WorldViewMode::Master;
        let _ = render_once(
            &client,
            &view,
            &mut visibility,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );

        assert_eq!(visibility.remembered_count(), remembered_before_master);
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
        let mut visibility = VisibilityState::default();
        let mut caches = RenderCaches::default();
        let mut atlas = Vec::with_capacity(24_000);
        let mut cmds = Vec::with_capacity(8);

        let out = render_once(
            &client,
            &view,
            &mut visibility,
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
        let mut visibility = VisibilityState::default();
        let mut caches = RenderCaches::default();
        let mut atlas = Vec::with_capacity(4096);
        let mut cmds = Vec::with_capacity(8);

        let first = render_once(
            &client,
            &view,
            &mut visibility,
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
            &mut visibility,
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
            &mut visibility,
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
        let mut visibility = VisibilityState::default();
        let mut caches = RenderCaches::default();
        let mut atlas = Vec::with_capacity(4096);
        let mut cmds = Vec::with_capacity(8);

        let _ = render_once(
            &client,
            &view,
            &mut visibility,
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
            &mut visibility,
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
            &mut visibility,
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
            &mut visibility,
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
        let mut visibility = VisibilityState::default();
        let mut caches = RenderCaches::default();
        let mut atlas = Vec::with_capacity(8192);
        let mut cmds = Vec::with_capacity(8);

        let _ = render_once(
            &client,
            &view,
            &mut visibility,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );
        assert_eq!(caches.topmost.len(), 2);

        view.visible_chunks = vec![Vec3i::new(1, 0, 0), Vec3i::new(2, 0, 0)];
        let _ = render_once(
            &client,
            &view,
            &mut visibility,
            &mut caches,
            &mut atlas,
            &mut cmds,
        );
        assert_eq!(caches.topmost.len(), 2);
        assert!(!caches.topmost.entries.contains_key(&(0, 0)), "evicted");
        assert!(caches.topmost.entries.contains_key(&(2, 0)), "entered");
        assert_eq!(caches.topmost.hits(), 1, "the retained column was a hit");
    }
}
