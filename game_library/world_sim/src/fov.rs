use crate::world_api::{BlockType, TileMemory, Vec3i, Vec3u};

const FOV_RADIUS_XY: i32 = 10;
const FOV_RADIUS_UP: i32 = 5;
const FOV_RADIUS_DOWN: i32 = 5;

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
    // Snapshot current visible set for memory degradation
    let previously_visible = std::mem::take(&mut fov.visible);
    fov.visible.clear();
    fov.dirty = false;

    let entity_z = position.z;

    // Iterate through z-slices from top to bottom
    for z in (entity_z - FOV_RADIUS_DOWN)..=(entity_z + FOV_RADIUS_UP) {
        if z < 0 {
            continue;
        }

        if z == entity_z {
            // Same level: use standard 2D symmetric shadow cast without vertical checks
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
        } else {
            // Different level: check vertical access first
            if is_vertically_open(
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
/// Returns true if the column is open (all intermediate z-levels are air).
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
        if let Some(block) = block_at(Vec3i::new(x, y, z), blocks, world_chunks, chunk_edge) {
            if matches!(block, BlockType::SolidStone) {
                return false;
            }
        }
    }
    true
}

/// Compute 2D symmetric shadow cast for a single z-level.
/// If vertical_check is true, also verify vertical access from entity's level.
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
    let entity_pos = Vec3i::new(entity_x, entity_y, z);

    // The entity's own position is always visible
    fov.visible.insert(entity_pos);

    // Run symmetric shadow casting in the 21x21 region
    // Divide the plane into four quadrants and process each
    for quadrant_dx in [-1, 1] {
        for quadrant_dy in [-1, 1] {
            scan_quadrant(
                fov,
                entity_x,
                entity_y,
                z,
                quadrant_dx,
                quadrant_dy,
                blocks,
                world_chunks,
                chunk_edge,
                vertical_check,
            );
        }
    }
}

/// Process one quadrant of the FOV using symmetric shadow casting.
fn scan_quadrant(
    fov: &mut super::world_core::EntityFov,
    entity_x: i32,
    entity_y: i32,
    z: i32,
    dx: i32, // +1 or -1
    dy: i32, // +1 or -1
    blocks: &[BlockType],
    world_chunks: Vec3u,
    chunk_edge: u32,
    vertical_check: bool,
) {
    // Shadow lines are represented as fractions (num/denom)
    // We track a list of active shadows that block sight
    let mut shadows: Vec<(i32, i32, i32, i32)> = Vec::new();

    for row in 1..=FOV_RADIUS_XY {
        let mut new_shadows = Vec::new();

        for col in 0..=row {
            let x = entity_x + dx * col;
            let y = entity_y + dy * row;

            // Check if this tile is blocked by existing shadows
            if is_in_shadow(&shadows, col, row) {
                // Tile is blocked, add its shadow
                let shadow = compute_shadow(col, row);
                new_shadows.push(shadow);
            } else {
                // Tile is visible; check diagonal occlusion and vertical access if needed
                let pos = Vec3i::new(x, y, z);

                let visible = if vertical_check {
                    is_vertically_open(entity_x, entity_y, z, z, blocks, world_chunks, chunk_edge)
                        && !is_diagonally_blocked(
                            x, y, z, dx, dy, col, row, blocks, world_chunks, chunk_edge,
                        )
                } else {
                    // On same level, check horizontal diagonal occlusion
                    !is_horizontally_diagonally_blocked(
                        x, y, z, dx, dy, col, row, blocks, world_chunks, chunk_edge,
                    )
                };

                if visible {
                    fov.visible.insert(pos);
                }

                // If this tile is opaque, it starts a shadow
                if let Some(block) = block_at(pos, blocks, world_chunks, chunk_edge) {
                    if matches!(block, BlockType::SolidStone) {
                        let shadow = compute_shadow(col, row);
                        new_shadows.push(shadow);
                    }
                }
            }
        }

        shadows.extend(new_shadows);

        // Early exit if all sight is blocked
        if shadows.iter().all(|(n, d, _, _)| n * 2 >= *d) {
            break;
        }
    }
}

/// Check if a tile at (col, row) is blocked by any of the shadow lines.
fn is_in_shadow(shadows: &[(i32, i32, i32, i32)], col: i32, row: i32) -> bool {
    if row == 0 {
        return false;
    }

    for &(shadow_start_num, shadow_start_denom, shadow_end_num, shadow_end_denom) in shadows {
        // Check if the tile at (col, row) falls within the shadow
        // A tile is blocked if its center (col + 0.5, row + 0.5) is between the shadow lines
        let left_fov = (col * shadow_start_denom) as f64 / row as f64;
        let right_fov = ((col + 1) * shadow_start_denom) as f64 / row as f64;

        let shadow_start = (shadow_start_num as f64) / (shadow_start_denom as f64);
        let shadow_end = (shadow_end_num as f64) / (shadow_end_denom as f64);

        if left_fov < shadow_end && right_fov > shadow_start {
            return true;
        }
    }

    false
}

/// Compute the shadow cast by an opaque tile at (col, row).
/// Returns (start_num, start_denom, end_num, end_denom).
fn compute_shadow(col: i32, row: i32) -> (i32, i32, i32, i32) {
    let start_num = col;
    let start_denom = row + 1;
    let end_num = col + 1;
    let end_denom = row;

    (start_num, start_denom, end_num, end_denom)
}

/// Check if there is a diagonal occlusion on the same z-level.
/// For moving diagonally in x-y plane, check if both orthogonal neighbors are solid.
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
        return false; // No diagonal occlusion on cardinal directions
    }

    // The two orthogonal neighbors that share edges with both origin and target
    let ortho1 = Vec3i::new(x - dx, y, z);
    let ortho2 = Vec3i::new(x, y - dy, z);

    let ortho1_solid = matches!(
        block_at(ortho1, blocks, world_chunks, chunk_edge),
        Some(BlockType::SolidStone)
    );
    let ortho2_solid = matches!(
        block_at(ortho2, blocks, world_chunks, chunk_edge),
        Some(BlockType::SolidStone)
    );

    ortho1_solid && ortho2_solid
}

/// Check if there is a diagonal occlusion involving vertical movement.
/// For moving diagonally in x-y-z space, check if both orthogonal neighbors are solid.
fn is_diagonally_blocked(
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
    // When looking from a different z-level, we have both x-y and z movement
    // Check vertical diagonal occlusion if applicable
    if col > 0 && row > 0 {
        // Moving diagonally in x-y as well, check horizontal diagonal
        let ortho1 = Vec3i::new(x - dx, y, z);
        let ortho2 = Vec3i::new(x, y - dy, z);

        let ortho1_solid = matches!(
            block_at(ortho1, blocks, world_chunks, chunk_edge),
            Some(BlockType::SolidStone)
        );
        let ortho2_solid = matches!(
            block_at(ortho2, blocks, world_chunks, chunk_edge),
            Some(BlockType::SolidStone)
        );

        if ortho1_solid && ortho2_solid {
            return true;
        }
    }

    false
}

/// Get block at world position, accounting for world bounds.
fn block_at(
    pos: Vec3i,
    blocks: &[BlockType],
    world_chunks: Vec3u,
    chunk_edge: u32,
) -> Option<BlockType> {
    if pos.x < 0
        || pos.y < 0
        || pos.z < 0
        || pos.x >= (world_chunks.x as i32 * chunk_edge as i32)
        || pos.y >= (world_chunks.y as i32 * chunk_edge as i32)
        || pos.z >= (world_chunks.z as i32 * chunk_edge as i32)
    {
        return None;
    }

    let index = world_position_to_block_index(pos, world_chunks, chunk_edge)?;
    blocks.get(index).copied()
}

/// Convert a world position to a block index in the flat blocks array.
fn world_position_to_block_index(
    pos: Vec3i,
    world_chunks: Vec3u,
    chunk_edge: u32,
) -> Option<usize> {
    let chunk_edge = chunk_edge as i32;
    let chunks_x = world_chunks.x as i32;
    let chunks_y = world_chunks.y as i32;
    let chunks_z = world_chunks.z as i32;

    let chunk_x = pos.x / chunk_edge;
    let chunk_y = pos.y / chunk_edge;
    let chunk_z = pos.z / chunk_edge;

    if chunk_x < 0
        || chunk_y < 0
        || chunk_z < 0
        || chunk_x >= chunks_x
        || chunk_y >= chunks_y
        || chunk_z >= chunks_z
    {
        return None;
    }

    let local_x = pos.x % chunk_edge;
    let local_y = pos.y % chunk_edge;
    let local_z = pos.z % chunk_edge;

    let chunk_index = (chunk_z * chunks_y * chunks_x + chunk_y * chunks_x + chunk_x) as usize;
    let local_index = (local_z * chunk_edge * chunk_edge + local_y * chunk_edge + local_x) as usize;
    let total_index = chunk_index * (chunk_edge * chunk_edge * chunk_edge) as usize + local_index;

    Some(total_index)
}
