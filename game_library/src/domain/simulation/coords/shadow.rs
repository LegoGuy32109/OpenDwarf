use std::collections::HashMap;

use crate::domain::simulation::Z_LEVELS_BELOW_RENDERED;
use world_sim::world_api::{BlockType, Vec3i};

pub(crate) fn compute_shadow_mask_for_air(
    x: i32,
    y: i32,
    z: i32,
    blocks: &HashMap<Vec3i, BlockType>,
) -> u8 {
    let mut mask = 0u8;
    let solid = |pos: Vec3i| terrain_block_for_shadow(pos, blocks, false) == BlockType::SolidStone;

    if solid(Vec3i::new(x, y + 1, z)) {
        mask |= 1;
    }
    if solid(Vec3i::new(x + 1, y, z)) {
        mask |= 2;
    }
    if solid(Vec3i::new(x, y - 1, z)) {
        mask |= 4;
    }
    if solid(Vec3i::new(x - 1, y, z)) {
        mask |= 8;
    }

    mask
}

pub(crate) fn terrain_block(pos: Vec3i, blocks: &HashMap<Vec3i, BlockType>) -> BlockType {
    blocks.get(&pos).copied().unwrap_or(BlockType::Air)
}

pub(crate) fn terrain_block_for_shadow(
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

pub(crate) fn topmost_solid_z_in_column(
    wx: i32,
    wy: i32,
    view_z: i32,
    blocks: &HashMap<Vec3i, BlockType>,
    unknown_is_solid: bool,
) -> Option<i32> {
    for offset in 0..=Z_LEVELS_BELOW_RENDERED {
        let z = view_z - offset;
        if terrain_block_for_shadow(Vec3i::new(wx, wy, z), blocks, unknown_is_solid)
            == BlockType::SolidStone
        {
            return Some(z);
        }
    }
    None
}
