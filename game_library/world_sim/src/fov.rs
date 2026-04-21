use crate::world_api::{BlockType, TileMemory, Vec3i, Vec3u};

const FOV_RADIUS_XY: i32 = 4;
const FOV_RADIUS_UP: i32 = 4;
const FOV_RADIUS_DOWN: i32 = 4;

/// Recomputes `fov.visible` for the given entity position.
/// Call once per sim tick when the entity has moved or nearby terrain changed.
pub fn compute_fov(
    fov: &mut super::world_core::EntityFov,
    position: Vec3i,
    blocks: &[BlockType],
    world_chunks: Vec3u,
    chunk_edge: u32,
    current_tick: u64,
) {
    // Snapshot current visible set for memory update
    let previously_visible = std::mem::take(&mut fov.visible);
    fov.dirty = false;

    let entity_z = position.z;

    // Iterate through z-slices
    for z in (entity_z - FOV_RADIUS_DOWN)..=(entity_z + FOV_RADIUS_UP) {
        if z == entity_z {
            // Same level: standard 2D symmetric shadow cast
            compute_2d_fov(
                fov,
                position.x,
                position.y,
                z,
                blocks,
                world_chunks,
                chunk_edge,
                false,
            );
        } else if is_vertically_open(
            position.x,
            position.y,
            entity_z,
            z,
            blocks,
            world_chunks,
            chunk_edge,
        ) {
            compute_2d_fov(
                fov,
                position.x,
                position.y,
                z,
                blocks,
                world_chunks,
                chunk_edge,
                true,
            );
        }
    }

    // Update memory: tiles that were visible but are no longer visible get recorded
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

/// Check if there is vertical line of sight from (x, y, entity_z) to (x, y, target_z).
fn is_vertically_open(
    x: i32,
    y: i32,
    entity_z: i32,
    target_z: i32,
    blocks: &[BlockType],
    world_chunks: Vec3u,
    chunk_edge: u32,
) -> bool {
    let start = entity_z.min(target_z);
    let end = entity_z.max(target_z);

    for z in (start + 1)..end {
        if matches!(
            block_at(Vec3i::new(x, y, z), blocks, world_chunks, chunk_edge),
            Some(BlockType::SolidStone)
        ) {
            return false;
        }
    }
    true
}

/// Compute 2D symmetric shadow cast for a single z-level using all 8 octants.
fn compute_2d_fov(
    fov: &mut super::world_core::EntityFov,
    entity_x: i32,
    entity_y: i32,
    z: i32,
    blocks: &[BlockType],
    world_chunks: Vec3u,
    chunk_edge: u32,
    vertical_check: bool,
) {
    // The entity's own position is always visible
    fov.visible.insert(Vec3i::new(entity_x, entity_y, z));

    // Run symmetric shadow casting in all 8 octants.
    // swap_axes=false: row advances in dy direction, col sweeps in dx (y-dominant octants)
    // swap_axes=true:  row advances in dx direction, col sweeps in dy (x-dominant octants)
    for dx in [-1i32, 1] {
        for dy in [-1i32, 1] {
            scan_quadrant(
                fov,
                entity_x,
                entity_y,
                z,
                dx,
                dy,
                false,
                blocks,
                world_chunks,
                chunk_edge,
                vertical_check,
            );
            scan_quadrant(
                fov,
                entity_x,
                entity_y,
                z,
                dx,
                dy,
                true,
                blocks,
                world_chunks,
                chunk_edge,
                vertical_check,
            );
        }
    }
}

/// Process one octant of the FOV using symmetric shadow casting.
/// swap_axes=false: row is the primary axis (dy direction), col sweeps in dx direction
/// swap_axes=true:  row is the primary axis (dx direction), col sweeps in dy direction
fn scan_quadrant(
    fov: &mut super::world_core::EntityFov,
    entity_x: i32,
    entity_y: i32,
    z: i32,
    dx: i32,
    dy: i32,
    swap_axes: bool,
    blocks: &[BlockType],
    world_chunks: Vec3u,
    chunk_edge: u32,
    vertical_check: bool,
) {
    let mut shadows: Vec<(i32, i32, i32, i32)> = Vec::new();

    for row in 1..=FOV_RADIUS_XY {
        let mut new_shadows = Vec::new();

        for col in 0..=row {
            let (x, y) = if swap_axes {
                (entity_x + dx * row, entity_y + dy * col)
            } else {
                (entity_x + dx * col, entity_y + dy * row)
            };

            if is_in_shadow(&shadows, col, row) {
                new_shadows.push(compute_shadow(col, row));
            } else {
                let pos = Vec3i::new(x, y, z);

                let visible = if vertical_check {
                    is_vertically_open(entity_x, entity_y, z, z, blocks, world_chunks, chunk_edge)
                        && !is_diagonally_blocked(
                            x,
                            y,
                            z,
                            dx,
                            dy,
                            col,
                            row,
                            swap_axes,
                            blocks,
                            world_chunks,
                            chunk_edge,
                        )
                } else {
                    !is_horizontally_diagonally_blocked(
                        x,
                        y,
                        z,
                        dx,
                        dy,
                        col,
                        row,
                        blocks,
                        world_chunks,
                        chunk_edge,
                    )
                };

                if visible {
                    fov.visible.insert(pos);
                }

                if matches!(
                    block_at(pos, blocks, world_chunks, chunk_edge),
                    Some(BlockType::SolidStone)
                ) {
                    new_shadows.push(compute_shadow(col, row));
                }
            }
        }

        shadows.extend(new_shadows);
    }
}

/// A tile at (col, row) occupies the angular range [col/row, (col+1)/row].
/// It is in shadow if that range overlaps any shadow interval [start_num/start_denom, end_num/end_denom].
fn is_in_shadow(shadows: &[(i32, i32, i32, i32)], col: i32, row: i32) -> bool {
    if row == 0 {
        return false;
    }
    let tile_left = col as f64 / row as f64;
    let tile_right = (col + 1) as f64 / row as f64;

    for &(start_num, start_denom, end_num, end_denom) in shadows {
        let shadow_start = start_num as f64 / start_denom as f64;
        let shadow_end = end_num as f64 / end_denom as f64;
        if tile_left < shadow_end && tile_right > shadow_start {
            return true;
        }
    }

    false
}

fn compute_shadow(col: i32, row: i32) -> (i32, i32, i32, i32) {
    (col, row + 1, col + 1, row)
}

/// Diagonal occlusion on the same z-level: blocked if both orthogonal neighbors are solid.
fn is_horizontally_diagonally_blocked(
    x: i32,
    y: i32,
    z: i32,
    dx: i32,
    dy: i32,
    col: i32,
    row: i32,
    blocks: &[BlockType],
    world_chunks: Vec3u,
    chunk_edge: u32,
) -> bool {
    if col == 0 || row == 0 {
        return false;
    }

    let ortho1 = Vec3i::new(x - dx, y, z);
    let ortho2 = Vec3i::new(x, y - dy, z);

    matches!(
        block_at(ortho1, blocks, world_chunks, chunk_edge),
        Some(BlockType::SolidStone)
    ) && matches!(
        block_at(ortho2, blocks, world_chunks, chunk_edge),
        Some(BlockType::SolidStone)
    )
}

fn is_diagonally_blocked(
    x: i32,
    y: i32,
    z: i32,
    dx: i32,
    dy: i32,
    col: i32,
    row: i32,
    swap_axes: bool,
    blocks: &[BlockType],
    world_chunks: Vec3u,
    chunk_edge: u32,
) -> bool {
    if col == 0 || row == 0 {
        return false;
    }

    // In swapped octants the primary sweep direction reverses meaning of dx/dy for neighbors
    let (check_x, check_y) = if swap_axes {
        (Vec3i::new(x - dx, y, z), Vec3i::new(x, y - dy, z))
    } else {
        (Vec3i::new(x - dx, y, z), Vec3i::new(x, y - dy, z))
    };

    matches!(
        block_at(check_x, blocks, world_chunks, chunk_edge),
        Some(BlockType::SolidStone)
    ) && matches!(
        block_at(check_y, blocks, world_chunks, chunk_edge),
        Some(BlockType::SolidStone)
    )
}

/// Get block at world position using the same centered coordinate system as WorldState::block_at.
fn block_at(
    pos: Vec3i,
    blocks: &[BlockType],
    world_chunks: Vec3u,
    chunk_edge: u32,
) -> Option<BlockType> {
    let sx = (world_chunks.x * chunk_edge) as i32;
    let sy = (world_chunks.y * chunk_edge) as i32;
    let sz = (world_chunks.z * chunk_edge) as i32;

    // Shift from centered coords to array indices
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
