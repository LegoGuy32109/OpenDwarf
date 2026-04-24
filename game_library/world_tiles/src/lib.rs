use bevy::prelude::*;
use std::collections::HashMap;
use world_sim::world_api::{BlockType, TileMemory, Vec3i};

pub use crate::tile_layer::TileLayer;

mod tile_layer {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    pub enum TileLayer {
        Floor,
        EdgeShadow,
        CeilingShadow,
        FogShadow,
    }
}

const STONE_TILE_INDEX: u16 = 5;

fn chunk_local_tile_index(local_x: u32, local_y: u32, chunk_edge: u32) -> usize {
    usize::try_from(local_y)
        .expect("local_y does not fit in usize")
        .checked_mul(usize::try_from(chunk_edge).expect("chunk edge does not fit in usize"))
        .and_then(|offset| {
            offset.checked_add(usize::try_from(local_x).expect("local_x does not fit in usize"))
        })
        .expect("chunk-local tile index overflowed")
}

fn world_pos_in_chunk(chunk_coord: Vec3i, chunk_edge: u32, x: u32, y: u32, z: i32) -> Vec3i {
    let edge_i = i32::try_from(chunk_edge).expect("chunk edge does not fit in i32");
    let half = edge_i / 2;
    Vec3i::new(
        chunk_coord
            .x
            .checked_mul(edge_i)
            .and_then(|base| base.checked_add(i32::try_from(x).expect("x does not fit in i32")))
            .and_then(|value| value.checked_sub(half))
            .expect("world x in chunk overflowed"),
        chunk_coord
            .y
            .checked_mul(edge_i)
            .and_then(|base| base.checked_add(i32::try_from(y).expect("y does not fit in i32")))
            .and_then(|value| value.checked_sub(half))
            .expect("world y in chunk overflowed"),
        z,
    )
}

fn terrain_block(pos: Vec3i, blocks: &HashMap<Vec3i, BlockType>) -> BlockType {
    blocks.get(&pos).copied().unwrap_or(BlockType::Air)
}

fn terrain_block_for_shadow(
    pos: Vec3i,
    blocks: &HashMap<Vec3i, BlockType>,
    unknown_is_solid: bool,
) -> BlockType {
    blocks.get(&pos).copied().unwrap_or(if unknown_is_solid {
        BlockType::SolidStone
    } else {
        BlockType::Air
    })
}

pub fn get_depth_tint_color(z_offset: i32) -> Color {
    match z_offset {
        0 => Color::WHITE,
        -1 => Color::srgb(0.75, 0.75, 0.75),
        -2 => Color::srgb(0.47, 0.49, 0.49),
        -3 => Color::srgb(0.33, 0.35, 0.61),
        -4 => Color::srgb(0.22, 0.24, 0.61),
        -5 => Color::srgb(0.12, 0.15, 0.43),
        _ => Color::srgb(0.02, 0.05, 0.43),
    }
}

pub fn build_floor_layer(
    chunk_xy: IVec2,
    world_z: i32,
    chunk_edge: u32,
    blocks: &HashMap<Vec3i, BlockType>,
    _z_offset: i32,
    _apply_depth_tint: bool,
) -> Vec<Option<u16>> {
    let tile_count = chunk_edge
        .checked_mul(chunk_edge)
        .expect("chunk tile count overflowed");
    let mut tile_data = vec![None; usize::try_from(tile_count).expect("tile count too large")];

    let chunk_coord = Vec3i::new(chunk_xy.x, chunk_xy.y, 0);

    for local_y in 0..chunk_edge {
        for local_x in 0..chunk_edge {
            let world_position =
                world_pos_in_chunk(chunk_coord, chunk_edge, local_x, local_y, world_z);
            let index_in_slice = chunk_local_tile_index(local_x, local_y, chunk_edge);

            if terrain_block(world_position, blocks) == BlockType::SolidStone {
                tile_data[index_in_slice] = Some(STONE_TILE_INDEX);
            }
        }
    }

    tile_data
}

#[allow(dead_code)]
fn chunk_has_edge(
    chunk_xy: IVec2,
    world_z: i32,
    chunk_edge: u32,
    blocks: &HashMap<Vec3i, BlockType>,
    unknown_is_solid: bool,
) -> bool {
    let chunk_coord = Vec3i::new(chunk_xy.x, chunk_xy.y, 0);

    for local_y in 0..chunk_edge {
        for local_x in 0..chunk_edge {
            let wp = world_pos_in_chunk(chunk_coord, chunk_edge, local_x, local_y, world_z);

            let is_solid = |dx: i32, dy: i32| -> bool {
                terrain_block_for_shadow(
                    Vec3i::new(wp.x + dx, wp.y + dy, world_z),
                    blocks,
                    unknown_is_solid,
                ) == BlockType::SolidStone
            };

            let mut mask: u8 = 0;
            if is_solid(0, 0) {
                mask |= 1;
            }
            if is_solid(1, 0) {
                mask |= 2;
            }
            if is_solid(0, 1) {
                mask |= 4;
            }
            if is_solid(1, 1) {
                mask |= 8;
            }

            if mask > 0 && mask < 15 {
                return true;
            }
        }
    }
    false
}

pub fn build_edge_shadow_layer(
    chunk_xy: IVec2,
    world_z: i32,
    chunk_edge: u32,
    blocks: &HashMap<Vec3i, BlockType>,
    unknown_is_solid: bool,
) -> Vec<Option<u16>> {
    let tile_count = chunk_edge
        .checked_mul(chunk_edge)
        .expect("chunk tile count overflowed");
    let mut tile_data = vec![None; usize::try_from(tile_count).expect("tile count too large")];

    let chunk_coord = Vec3i::new(chunk_xy.x, chunk_xy.y, 0);

    for local_y in 0..chunk_edge {
        for local_x in 0..chunk_edge {
            let wp = world_pos_in_chunk(chunk_coord, chunk_edge, local_x, local_y, world_z);
            let index_in_slice = chunk_local_tile_index(local_x, local_y, chunk_edge);

            let is_solid = |dx: i32, dy: i32| -> bool {
                terrain_block_for_shadow(
                    Vec3i::new(wp.x + dx, wp.y + dy, world_z),
                    blocks,
                    unknown_is_solid,
                ) == BlockType::SolidStone
            };

            let mut mask: u8 = 0;
            if is_solid(0, 0) {
                mask |= 1;
            }
            if is_solid(1, 0) {
                mask |= 2;
            }
            if is_solid(0, 1) {
                mask |= 4;
            }
            if is_solid(1, 1) {
                mask |= 8;
            }

            if mask > 0 && mask < 15 {
                tile_data[index_in_slice] = Some((mask - 1) as u16);
            }
        }
    }

    tile_data
}

pub fn build_ceiling_shadow_layer(
    chunk_xy: IVec2,
    world_z: i32,
    chunk_edge: u32,
    blocks: &HashMap<Vec3i, BlockType>,
    unknown_is_solid: bool,
) -> Vec<Option<u16>> {
    let tile_count = chunk_edge
        .checked_mul(chunk_edge)
        .expect("chunk tile count overflowed");
    let mut tile_data = vec![None; usize::try_from(tile_count).expect("tile count too large")];

    let chunk_coord = Vec3i::new(chunk_xy.x, chunk_xy.y, 0);

    for local_y in 0..chunk_edge {
        for local_x in 0..chunk_edge {
            let index_in_slice = chunk_local_tile_index(local_x, local_y, chunk_edge);
            let wp = world_pos_in_chunk(chunk_coord, chunk_edge, local_x, local_y, world_z);

            let mut mask: u8 = 0;

            let check_corner = |dx: i32, dy: i32| -> bool {
                let above = Vec3i::new(wp.x + dx, wp.y + dy, world_z + 1);
                let below = Vec3i::new(wp.x + dx, wp.y + dy, world_z);
                terrain_block_for_shadow(above, blocks, unknown_is_solid) == BlockType::SolidStone
                    && terrain_block_for_shadow(below, blocks, unknown_is_solid)
                        == BlockType::SolidStone
            };

            if check_corner(0, 0) {
                mask |= 1;
            }
            if check_corner(1, 0) {
                mask |= 2;
            }
            if check_corner(0, 1) {
                mask |= 4;
            }
            if check_corner(1, 1) {
                mask |= 8;
            }

            if mask != 0 {
                tile_data[index_in_slice] = Some((mask - 1) as u16);
            }
        }
    }

    tile_data
}

pub struct FogData {
    pub visible: std::collections::HashSet<Vec3i>,
    pub memory: HashMap<Vec3i, TileMemory>,
}

pub fn build_fog_shadow_layer(
    chunk_xy: IVec2,
    world_z: i32,
    current_z: i32,
    chunk_edge: u32,
    blocks: &HashMap<Vec3i, BlockType>,
    fog: &FogData,
) -> Vec<Option<u16>> {
    let tile_count =
        usize::try_from(chunk_edge * chunk_edge).expect("chunk tile count does not fit in usize");
    let mut tile_data = vec![None; tile_count];

    let edge_i = i32::try_from(chunk_edge).expect("chunk_edge does not fit in i32");
    let half = edge_i / 2;

    for local_y in 0..chunk_edge {
        for local_x in 0..chunk_edge {
            let wx = chunk_xy.x * edge_i
                + i32::try_from(local_x).expect("local_x does not fit in i32")
                - half;
            let wy = chunk_xy.y * edge_i
                + i32::try_from(local_y).expect("local_y does not fit in i32")
                - half;
            let world_pos = Vec3i::new(wx, wy, world_z);

            let idx = chunk_local_tile_index(local_x, local_y, chunk_edge);

            if fog.visible.contains(&world_pos) {
                tile_data[idx] = None;
            } else if world_z == current_z {
                if !fog.memory.contains_key(&world_pos) {
                    tile_data[idx] = None;
                    continue;
                }
                tile_data[idx] = Some(0);
            } else if terrain_block(world_pos, blocks) == BlockType::SolidStone {
                tile_data[idx] = Some(0);
            } else {
                tile_data[idx] = None;
            }
        }
    }

    tile_data
}
