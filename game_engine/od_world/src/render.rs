use std::collections::{HashMap, HashSet};

use od_core::world::chunk::{SUPPORTED_CHUNK_EDGE, chunk_min_world_position};
use od_core::{
    BlockType, DRAWCMD_PROGRAM_WORLD_ATLAS_QUAD, DrawCmd, EntitySnapshot, LocalWorldView,
    TEXTURE_ID_FLOOR, TEXTURE_ID_SPRITE, Vec3i, WorldAtlasQuadInstance, WorldSnapshot,
    WorldViewMode,
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

#[derive(Debug, Clone, Copy, Default)]
pub struct RenderStats {
    pub floor_quads: u32,
    pub player_quads: u32,
    pub dropped_atlas_quads: u32,
    pub dropped_draw_cmds: u32,
    /// Canonical snapshots constructed by the current RAF frame.
    pub snapshot_calls_last_frame: u32,
    pub visible_tiles: u32,
    pub remembered_tiles: u32,
}

pub struct RenderInput<'a> {
    pub snapshot: &'a WorldSnapshot,
    pub view: &'a LocalWorldView,
    pub primary_entity_id: Option<u64>,
    pub smooth_player_xy: Option<[f32; 2]>,
}

pub struct RenderOutput {
    pub stats: RenderStats,
}

pub fn render(
    input: RenderInput<'_>,
    visibility: &mut VisibilityState,
    atlas_quads: &mut Vec<WorldAtlasQuadInstance>,
    draw_cmds: &mut Vec<DrawCmd>,
) -> RenderOutput {
    if input.view.view_mode == WorldViewMode::Entity {
        if visibility.fov_dirty {
            recompute_fov(input.snapshot, input.primary_entity_id, visibility);
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
        input.snapshot,
        input.view,
        visibility,
        atlas_quads,
        draw_cmds,
        &mut stats,
    );

    let player_start = atlas_quads.len();
    emit_player_quad(input, visibility, atlas_quads, &mut stats);
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
    snapshot: &WorldSnapshot,
    view: &LocalWorldView,
    visibility: &VisibilityState,
    atlas_quads: &mut Vec<WorldAtlasQuadInstance>,
    draw_cmds: &mut Vec<DrawCmd>,
    stats: &mut RenderStats,
) {
    let mut floor_batch_start = atlas_quads.len();
    let mut floor_batch_count = 0_usize;
    for chunk in &view.visible_chunks {
        let Some(base) = chunk_min_world_position(*chunk, snapshot.world_chunks) else {
            continue;
        };
        let [base_x, base_y] = [base.x, base.y];
        for ty in 0..SUPPORTED_CHUNK_EDGE {
            for tx in 0..SUPPORTED_CHUNK_EDGE {
                let tile_x = base_x + i32::try_from(tx).unwrap_or(i32::MAX);
                let tile_y = base_y + i32::try_from(ty).unwrap_or(i32::MAX);
                let Some((floor_z, visibility_state)) =
                    topmost_floor(snapshot, visibility, view, tile_x, tile_y)
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
}

fn topmost_floor(
    snapshot: &WorldSnapshot,
    visibility: &VisibilityState,
    view: &LocalWorldView,
    tile_x: i32,
    tile_y: i32,
) -> Option<(i32, TileVisibility)> {
    let z_min = view.view_z - Z_LEVELS_BELOW;
    for z in (z_min..=view.view_z).rev() {
        let pos = Vec3i::new(tile_x, tile_y, z);
        let render_block = render_block_at(snapshot, visibility, view.view_mode, pos);
        if render_block != Some(BlockType::SolidStone) {
            continue;
        }
        if view.view_mode == WorldViewMode::Entity {
            match visibility.visibility_at(pos) {
                TileVisibility::Visible => return Some((z, TileVisibility::Visible)),
                TileVisibility::Remembered => return Some((z, TileVisibility::Remembered)),
                TileVisibility::Unseen => continue,
            }
        }
        return Some((z, TileVisibility::Visible));
    }
    None
}

fn emit_player_quad(
    input: RenderInput<'_>,
    visibility: &VisibilityState,
    atlas_quads: &mut Vec<WorldAtlasQuadInstance>,
    stats: &mut RenderStats,
) {
    let Some(player) = primary_entity(input.snapshot, input.primary_entity_id) else {
        return;
    };
    let z_offset = player.position.z - input.view.view_z;
    if z_offset < -Z_LEVELS_BELOW {
        return;
    }
    if input.view.view_mode == WorldViewMode::Entity
        && visibility.visibility_at(entity_visibility_position(player)) != TileVisibility::Visible
    {
        return;
    }
    if player_occluded(input.snapshot, player, input.view.view_z) {
        return;
    }
    if atlas_quads.len() == atlas_quads.capacity() {
        stats.dropped_atlas_quads = stats.dropped_atlas_quads.saturating_add(1);
        return;
    }
    let [x, y] = input
        .smooth_player_xy
        .unwrap_or_else(|| entity_render_position_xy(player));
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
    snapshot: &WorldSnapshot,
    primary_entity_id: Option<u64>,
    visibility: &mut VisibilityState,
) {
    let Some(player) = primary_entity(snapshot, primary_entity_id) else {
        visibility.visible.clear();
        return;
    };
    let position = entity_visibility_position(player);
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
                if has_los(snapshot, position, candidate) {
                    next_visible.insert(candidate);
                }
            }
        }
    }

    let mut wall_reveal = Vec::new();
    for &pos in &next_visible {
        if solid_at(snapshot, pos) {
            continue;
        }
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let wall = Vec3i::new(pos.x + dx, pos.y + dy, pos.z);
            if !next_visible.contains(&wall) && solid_at(snapshot, wall) {
                wall_reveal.push(wall);
            }
        }
    }
    next_visible.extend(wall_reveal);

    let lower_half: Vec<Vec3i> = next_visible
        .iter()
        .copied()
        .filter(|pos| pos.z <= position.z && !solid_at(snapshot, *pos))
        .collect();
    for pos in lower_half {
        next_visible.insert(Vec3i::new(pos.x, pos.y, pos.z - 1));
    }

    for pos in previous_visible {
        if !next_visible.contains(&pos) {
            visibility.memory.insert(
                pos,
                TileMemory {
                    block: block_at(snapshot, pos),
                },
            );
        }
    }
    for pos in &next_visible {
        visibility.memory.remove(pos);
    }
    visibility.visible = next_visible;
}

fn has_los(snapshot: &WorldSnapshot, from: Vec3i, to: Vec3i) -> bool {
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
        if solid_at(snapshot, cursor) {
            return false;
        }
    }
    true
}

fn player_occluded(snapshot: &WorldSnapshot, player: &EntitySnapshot, view_z: i32) -> bool {
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
    (lo..=hi).any(|z| solid_at(snapshot, Vec3i::new(player_pos.x, player_pos.y, z)))
}

fn render_block_at(
    snapshot: &WorldSnapshot,
    visibility: &VisibilityState,
    view_mode: WorldViewMode,
    pos: Vec3i,
) -> Option<BlockType> {
    if view_mode != WorldViewMode::Entity || visibility.visible.contains(&pos) {
        return Some(block_at(snapshot, pos));
    }
    visibility.remembered_block_at(pos)
}

fn block_at(snapshot: &WorldSnapshot, pos: Vec3i) -> BlockType {
    snapshot
        .terrain_blocks
        .get(&pos)
        .copied()
        .unwrap_or(BlockType::Air)
}

fn solid_at(snapshot: &WorldSnapshot, pos: Vec3i) -> bool {
    block_at(snapshot, pos) == BlockType::SolidStone
}

fn primary_entity(
    snapshot: &WorldSnapshot,
    primary_entity_id: Option<u64>,
) -> Option<&EntitySnapshot> {
    primary_entity_id
        .and_then(|id| snapshot.entities.iter().find(|entity| entity.id == id))
        .or_else(|| snapshot.entities.first())
}

fn entity_visibility_position(entity: &EntitySnapshot) -> Vec3i {
    entity.position
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
    use od_core::{Vec3u, WorldConfig, WorldViewMode};

    use crate::WorldSim;

    use super::*;

    #[test]
    fn render_emits_floor_and_player_quads() {
        let sim = WorldSim::new(WorldConfig::default(), true);
        let snapshot = sim.snapshot();
        let mut view = LocalWorldView::default();
        view.view_z = snapshot.entities[0].position.z;
        view.view_mode = WorldViewMode::Master;
        view.visible_chunks = snapshot.loaded_chunks.iter().copied().collect();
        let mut visibility = VisibilityState::default();
        let mut atlas = Vec::with_capacity(4096);
        let mut cmds = Vec::with_capacity(8);

        let out = render(
            RenderInput {
                snapshot: &snapshot,
                view: &view,
                primary_entity_id: sim.primary_entity_id(),
                smooth_player_xy: None,
            },
            &mut visibility,
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
        let snapshot = sim.snapshot();
        let mut view = LocalWorldView::default();
        view.view_z = snapshot.entities[0].position.z;
        view.view_mode = WorldViewMode::Master;
        view.visible_chunks = snapshot.loaded_chunks.iter().copied().collect();
        let mut visibility = VisibilityState::default();
        let mut atlas = Vec::with_capacity(24_000);
        let mut cmds = Vec::with_capacity(8);

        let out = render(
            RenderInput {
                snapshot: &snapshot,
                view: &view,
                primary_entity_id: sim.primary_entity_id(),
                smooth_player_xy: None,
            },
            &mut visibility,
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
        let snapshot = sim.snapshot();
        let mut view = LocalWorldView::default();
        view.view_z = snapshot.entities[0].position.z;
        view.visible_chunks = snapshot.loaded_chunks.iter().copied().collect();
        let mut visibility = VisibilityState::default();
        let mut atlas = Vec::with_capacity(4096);
        let mut cmds = Vec::with_capacity(8);

        let _ = render(
            RenderInput {
                snapshot: &snapshot,
                view: &view,
                primary_entity_id: sim.primary_entity_id(),
                smooth_player_xy: None,
            },
            &mut visibility,
            &mut atlas,
            &mut cmds,
        );
        let first_count = visibility.fov_recompute_count();
        assert_eq!(first_count, 1);
        assert!(!visibility.fov_dirty());

        atlas.clear();
        cmds.clear();
        let _ = render(
            RenderInput {
                snapshot: &snapshot,
                view: &view,
                primary_entity_id: sim.primary_entity_id(),
                smooth_player_xy: None,
            },
            &mut visibility,
            &mut atlas,
            &mut cmds,
        );

        assert_eq!(visibility.fov_recompute_count(), first_count);
        visibility.mark_fov_dirty();
        atlas.clear();
        cmds.clear();
        let _ = render(
            RenderInput {
                snapshot: &snapshot,
                view: &view,
                primary_entity_id: sim.primary_entity_id(),
                smooth_player_xy: None,
            },
            &mut visibility,
            &mut atlas,
            &mut cmds,
        );
        assert_eq!(visibility.fov_recompute_count(), first_count + 1);
    }

    #[test]
    fn entity_mode_fov_creates_memory_after_motion() {
        let mut sim = WorldSim::new(WorldConfig::default(), true);
        let mut visibility = VisibilityState::default();
        let mut atlas = Vec::with_capacity(4096);
        let mut cmds = Vec::with_capacity(8);
        let snapshot = sim.snapshot();
        let mut view = LocalWorldView::default();
        view.view_z = snapshot.entities[0].position.z;
        view.visible_chunks = snapshot.loaded_chunks.iter().copied().collect();

        let _ = render(
            RenderInput {
                snapshot: &snapshot,
                view: &view,
                primary_entity_id: sim.primary_entity_id(),
                smooth_player_xy: None,
            },
            &mut visibility,
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
        let snapshot = sim.snapshot();
        visibility.mark_fov_dirty();
        atlas.clear();
        cmds.clear();
        let _ = render(
            RenderInput {
                snapshot: &snapshot,
                view: &view,
                primary_entity_id: sim.primary_entity_id(),
                smooth_player_xy: None,
            },
            &mut visibility,
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
        let mut atlas = Vec::with_capacity(4096);
        let mut cmds = Vec::with_capacity(8);
        let snapshot = sim.snapshot();
        let mut view = LocalWorldView::default();
        view.view_z = snapshot.entities[0].position.z;
        view.visible_chunks = snapshot.loaded_chunks.iter().copied().collect();

        let _ = render(
            RenderInput {
                snapshot: &snapshot,
                view: &view,
                primary_entity_id: sim.primary_entity_id(),
                smooth_player_xy: None,
            },
            &mut visibility,
            &mut atlas,
            &mut cmds,
        );
        sim.send_command(od_core::WorldCommand::MoveEntity {
            id: 1,
            direction: Vec3i::new(-1, 0, 0),
        })
        .expect("starter room west move");
        sim.step_ticks(10);
        visibility.mark_fov_dirty();
        let snapshot = sim.snapshot();
        atlas.clear();
        cmds.clear();
        let _ = render(
            RenderInput {
                snapshot: &snapshot,
                view: &view,
                primary_entity_id: sim.primary_entity_id(),
                smooth_player_xy: None,
            },
            &mut visibility,
            &mut atlas,
            &mut cmds,
        );
        let remembered_before_master = visibility.remembered_count();
        assert!(remembered_before_master > 0);

        view.view_mode = WorldViewMode::Master;
        atlas.clear();
        cmds.clear();
        let _ = render(
            RenderInput {
                snapshot: &snapshot,
                view: &view,
                primary_entity_id: sim.primary_entity_id(),
                smooth_player_xy: None,
            },
            &mut visibility,
            &mut atlas,
            &mut cmds,
        );

        assert_eq!(visibility.remembered_count(), remembered_before_master);
    }
}
