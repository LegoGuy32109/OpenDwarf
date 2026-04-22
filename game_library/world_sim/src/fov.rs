use crate::world_api::{BlockType, TileMemory, Vec3i, Vec3u};

const FOV_RADIUS: i32 = 5;

/// Recomputes `fov.visible` for the given entity position using 3D DDA ray casting.
/// Every tile within a spherical radius is tested with a ray from the entity center.
pub fn compute_fov(
    fov: &mut super::world_core::EntityFov,
    position: Vec3i,
    blocks: &[BlockType],
    world_chunks: Vec3u,
    chunk_edge: u32,
    current_tick: u64,
) {
    let previously_visible = std::mem::take(&mut fov.visible);
    fov.dirty = false;

    let r_sq = FOV_RADIUS * FOV_RADIUS;

    for dz in -FOV_RADIUS..=FOV_RADIUS {
        for dy in -FOV_RADIUS..=FOV_RADIUS {
            for dx in -FOV_RADIUS..=FOV_RADIUS {
                if dx * dx + dy * dy + dz * dz > r_sq {
                    continue;
                }
                let candidate =
                    Vec3i::new(position.x + dx, position.y + dy, position.z + dz);
                if has_los(position, candidate, blocks, world_chunks, chunk_edge) {
                    fov.visible.insert(candidate);
                }
            }
        }
    }

    // For every visible tile at or below the entity's z-level, also reveal the tile
    // directly underneath. This fills in the floor at the base of walls when looking
    // horizontally or downward, without affecting upward ledge occlusion.
    let lower_half: Vec<Vec3i> = fov
        .visible
        .iter()
        .filter(|p| p.z <= position.z)
        .copied()
        .collect();
    for pos in lower_half {
        fov.visible.insert(Vec3i::new(pos.x, pos.y, pos.z - 1));
    }

    // Tiles that were visible but are no longer visible become memory entries.
    for pos in previously_visible {
        if !fov.visible.contains(&pos) {
            if let Some(block) = block_at(pos, blocks, world_chunks, chunk_edge) {
                fov.memory.insert(
                    pos,
                    TileMemory {
                        block,
                        tick_observed: current_tick,
                    },
                );
            }
        }
    }
}

/// Returns true if there is an unobstructed line of sight from `from` to `to`.
/// Uses a 3D DDA ray march. Intermediate voxels that are SolidStone block LOS;
/// the source and target voxels themselves are never checked for blocking.
fn has_los(
    from: Vec3i,
    to: Vec3i,
    blocks: &[BlockType],
    world_chunks: Vec3u,
    chunk_edge: u32,
) -> bool {
    if from == to {
        return true;
    }

    // Ray from center of `from` to center of `to`
    let fx = from.x as f32 + 0.5;
    let fy = from.y as f32 + 0.5;
    let fz = from.z as f32 + 0.5;

    let dir_x = to.x as f32 + 0.5 - fx;
    let dir_y = to.y as f32 + 0.5 - fy;
    let dir_z = to.z as f32 + 0.5 - fz;

    let step_x: i32 = if dir_x >= 0.0 { 1 } else { -1 };
    let step_y: i32 = if dir_y >= 0.0 { 1 } else { -1 };
    let step_z: i32 = if dir_z >= 0.0 { 1 } else { -1 };

    // t_delta: how much the ray parameter increases per unit step on each axis.
    let t_delta_x = if dir_x == 0.0 { f32::INFINITY } else { (1.0 / dir_x).abs() };
    let t_delta_y = if dir_y == 0.0 { f32::INFINITY } else { (1.0 / dir_y).abs() };
    let t_delta_z = if dir_z == 0.0 { f32::INFINITY } else { (1.0 / dir_z).abs() };

    // t_max: parameter value at first axis crossing from entity center.
    // Starting at tile center (offset 0.5 within the voxel), the first crossing
    // is always 0.5 voxel-units away along that axis.
    let mut t_max_x = if dir_x == 0.0 { f32::INFINITY } else { 0.5 / dir_x.abs() };
    let mut t_max_y = if dir_y == 0.0 { f32::INFINITY } else { 0.5 / dir_y.abs() };
    let mut t_max_z = if dir_z == 0.0 { f32::INFINITY } else { 0.5 / dir_z.abs() };

    let mut cx = from.x;
    let mut cy = from.y;
    let mut cz = from.z;

    // Worst-case steps: Manhattan distance plus a small buffer.
    let max_steps = (from.x - to.x).abs()
        + (from.y - to.y).abs()
        + (from.z - to.z).abs()
        + 1;

    for _ in 0..max_steps {
        // Advance to the next voxel boundary.
        if t_max_x <= t_max_y && t_max_x <= t_max_z {
            cx += step_x;
            t_max_x += t_delta_x;
        } else if t_max_y <= t_max_z {
            cy += step_y;
            t_max_y += t_delta_y;
        } else {
            cz += step_z;
            t_max_z += t_delta_z;
        }

        if cx == to.x && cy == to.y && cz == to.z {
            return true;
        }

        let pos = Vec3i::new(cx, cy, cz);
        if matches!(
            block_at(pos, blocks, world_chunks, chunk_edge),
            Some(BlockType::SolidStone)
        ) {
            return false;
        }
    }

    true
}

fn block_at(
    pos: Vec3i,
    blocks: &[BlockType],
    world_chunks: Vec3u,
    chunk_edge: u32,
) -> Option<BlockType> {
    let sx = (world_chunks.x * chunk_edge) as i32;
    let sy = (world_chunks.y * chunk_edge) as i32;
    let sz = (world_chunks.z * chunk_edge) as i32;

    let ix = pos.x + sx / 2;
    let iy = pos.y + sy / 2;
    let iz = pos.z + sz / 2;

    if ix < 0 || iy < 0 || iz < 0 || ix >= sx || iy >= sy || iz >= sz {
        return None;
    }

    let sx = sx as usize;
    let sy = sy as usize;
    blocks
        .get(iz as usize * sx * sy + iy as usize * sx + ix as usize)
        .copied()
}
