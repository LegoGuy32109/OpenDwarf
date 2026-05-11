use bevy::prelude::*;
use bevy::sprite_render::TileData;
use std::collections::HashMap;

use super::coords::{
    chunk_local_tile_index, get_depth_tint_tile_color, terrain_block_for_shadow,
    topmost_solid_z_in_column, world_pos_in_chunk,
};
use super::{FogData, REMEMBERED_FOG_RGBA};
use world_sim::world_api::{BlockType, Vec3i};

pub(super) fn stone_tile_index() -> u16 {
    5
}

// ─── Geometry-cache helpers ────────────────────────────────────────────────
// These separate "build geometry indices" from "apply color at read time".
// The geometry (which tiles are solid + atlas index) is static while the world
// is static. Tint/fog color is applied from the cache at read time so view_z
// changes never require a full geometry rebuild.

/// Returns floor geometry (tileset indices) without tint — suitable for caching.
pub(super) fn build_floor_geometry(
    chunk_xy: IVec2,
    world_z: i32,
    chunk_edge: u32,
    topmost_cache: &HashMap<(i32, i32), Option<i32>>,
) -> Vec<Option<u16>> {
    let tile_count = chunk_edge
        .checked_mul(chunk_edge)
        .expect("chunk tile count overflowed") as usize;
    let mut geom = vec![None; tile_count];
    let chunk_coord = Vec3i::new(chunk_xy.x, chunk_xy.y, 0);
    for local_y in 0..chunk_edge {
        for local_x in 0..chunk_edge {
            let wp = world_pos_in_chunk(chunk_coord, chunk_edge, local_x, local_y, world_z);
            if topmost_from_cache(wp.x, wp.y, topmost_cache) == Some(world_z) {
                geom[chunk_local_tile_index(local_x, local_y, chunk_edge)] = Some(stone_tile_index());
            }
        }
    }
    geom
}

/// Applies depth tint to cached floor geometry indices at read time.
pub(super) fn floor_tile_data_from_geometry(
    geometry: &[Option<u16>],
    z_offset: i32,
    apply_depth_tint: bool,
) -> Vec<Option<TileData>> {
    geometry
        .iter()
        .map(|opt| {
            opt.map(|idx| {
                let mut td = TileData::from_tileset_index(idx);
                td.color = if apply_depth_tint {
                    get_depth_tint_tile_color(z_offset)
                } else {
                    Color::WHITE
                };
                td
            })
        })
        .collect()
}

/// Returns edge shadow geometry (atlas indices) for caching.
pub(super) fn build_edge_shadow_geometry(
    chunk_xy: IVec2,
    world_z: i32,
    chunk_edge: u32,
    topmost_cache: &HashMap<(i32, i32), Option<i32>>,
) -> Vec<Option<u16>> {
    let tile_count = chunk_edge
        .checked_mul(chunk_edge)
        .expect("chunk tile count overflowed") as usize;
    let mut geom = vec![None; tile_count];
    let chunk_coord = Vec3i::new(chunk_xy.x, chunk_xy.y, 0);
    for local_y in 0..chunk_edge {
        for local_x in 0..chunk_edge {
            let wp = world_pos_in_chunk(chunk_coord, chunk_edge, local_x, local_y, world_z);
            let idx = chunk_local_tile_index(local_x, local_y, chunk_edge);
            let is_solid = |dx: i32, dy: i32| -> bool {
                topmost_from_cache(wp.x + dx, wp.y + dy, topmost_cache) == Some(world_z)
            };
            let mut mask: u8 = 0;
            if is_solid(0, 0) { mask |= 1; }
            if is_solid(1, 0) { mask |= 2; }
            if is_solid(0, 1) { mask |= 4; }
            if is_solid(1, 1) { mask |= 8; }
            if mask > 0 && mask < 15 {
                geom[idx] = Some((mask - 1) as u16);
            }
        }
    }
    geom
}

/// Returns ceiling shadow geometry (atlas indices) for caching.
pub(super) fn build_ceiling_shadow_geometry(
    chunk_xy: IVec2,
    world_z: i32,
    chunk_edge: u32,
    blocks: &HashMap<Vec3i, BlockType>,
    unknown_is_solid: bool,
    topmost_cache: &HashMap<(i32, i32), Option<i32>>,
) -> Vec<Option<u16>> {
    let tile_count = chunk_edge
        .checked_mul(chunk_edge)
        .expect("chunk tile count overflowed") as usize;
    let mut geom = vec![None; tile_count];
    let chunk_coord = Vec3i::new(chunk_xy.x, chunk_xy.y, 0);
    for local_y in 0..chunk_edge {
        for local_x in 0..chunk_edge {
            let wp = world_pos_in_chunk(chunk_coord, chunk_edge, local_x, local_y, world_z);
            let idx = chunk_local_tile_index(local_x, local_y, chunk_edge);
            let mut mask: u8 = 0;
            let check_corner = |dx: i32, dy: i32| -> bool {
                let cx = wp.x + dx;
                let cy = wp.y + dy;
                let above = Vec3i::new(cx, cy, world_z + 1);
                topmost_from_cache(cx, cy, topmost_cache) == Some(world_z)
                    && terrain_block_for_shadow(above, blocks, unknown_is_solid)
                        == BlockType::SolidStone
            };
            if check_corner(0, 0) { mask |= 1; }
            if check_corner(1, 0) { mask |= 2; }
            if check_corner(0, 1) { mask |= 4; }
            if check_corner(1, 1) { mask |= 8; }
            if mask != 0 {
                geom[idx] = Some((mask - 1) as u16);
            }
        }
    }
    geom
}

/// Converts cached shadow geometry indices directly to TileData (no color modification).
pub(super) fn shadow_tile_data_from_geometry(geometry: &[Option<u16>]) -> Vec<Option<TileData>> {
    geometry
        .iter()
        .map(|opt| opt.map(TileData::from_tileset_index))
        .collect()
}

/// Builds fog geometry for caching: stores RGBA per tile, or None for transparent tiles.
pub(super) fn build_fog_geometry(
    chunk_xy: IVec2,
    world_z: i32,
    chunk_edge: u32,
    topmost_cache: &HashMap<(i32, i32), Option<i32>>,
    fog: &FogData,
) -> Vec<Option<[f32; 4]>> {
    let tile_count = (chunk_edge * chunk_edge) as usize;
    let mut geom: Vec<Option<[f32; 4]>> = vec![None; tile_count];
    let edge_i = chunk_edge as i32;
    let half = edge_i / 2;
    for local_y in 0..chunk_edge {
        for local_x in 0..chunk_edge {
            let wx = chunk_xy.x * edge_i + local_x as i32 - half;
            let wy = chunk_xy.y * edge_i + local_y as i32 - half;
            let world_pos = Vec3i::new(wx, wy, world_z);
            let idx = chunk_local_tile_index(local_x, local_y, chunk_edge);
            if topmost_from_cache(wx, wy, topmost_cache) != Some(world_z) {
                continue;
            }
            if fog.visible.contains(&world_pos) {
                continue;
            }
            geom[idx] = Some(REMEMBERED_FOG_RGBA);
        }
    }
    geom
}

/// Converts cached fog geometry to TileData.
pub(super) fn fog_tile_data_from_cache(fog_geom: &[Option<[f32; 4]>]) -> Vec<Option<TileData>> {
    fog_geom
        .iter()
        .map(|opt| {
            opt.map(|rgba| {
                let mut td = TileData::from_tileset_index(0);
                td.color = Color::srgba(rgba[0], rgba[1], rgba[2], rgba[3]);
                td
            })
        })
        .collect()
}

/// Precompute `topmost_solid_z_in_column` for every (wx, wy) position covered by the
/// given chunks plus a 1-tile border on each side. Building this once per rebuild batch
/// eliminates repeated HashMap traversal inside each tile builder.
///
/// Pass `unknown_is_solid = false` for Floor/Fog layers and `true` for Edge/Ceiling
/// shadow layers in Entity mode.
pub(super) fn build_topmost_cache(
    chunk_xys: impl IntoIterator<Item = IVec2>,
    view_z: i32,
    chunk_edge: u32,
    blocks: &HashMap<Vec3i, BlockType>,
    unknown_is_solid: bool,
    depth: i32,
) -> HashMap<(i32, i32), Option<i32>> {
    let edge = chunk_edge as i32;
    let half = edge / 2;
    let mut cache: HashMap<(i32, i32), Option<i32>> = HashMap::new();

    for chunk_xy in chunk_xys {
        // Cover the chunk tile range plus 1-tile border on each side so that
        // dual-grid shadow builders can query neighboring positions without a cache miss.
        let min_wx = chunk_xy.x * edge - half - 1;
        let max_wx = chunk_xy.x * edge + edge - half; // inclusive upper bound
        let min_wy = chunk_xy.y * edge - half - 1;
        let max_wy = chunk_xy.y * edge + edge - half;
        for wx in min_wx..=max_wx {
            for wy in min_wy..=max_wy {
                cache.entry((wx, wy)).or_insert_with(|| {
                    topmost_solid_z_in_column(wx, wy, view_z, blocks, unknown_is_solid, depth)
                });
            }
        }
    }

    cache
}

#[inline]
fn topmost_from_cache(wx: i32, wy: i32, cache: &HashMap<(i32, i32), Option<i32>>) -> Option<i32> {
    cache.get(&(wx, wy)).copied().flatten()
}

