use super::*;

pub(super) fn stone_tile_index() -> u16 {
    5
}

pub(super) fn build_chunk_tile_data(
    chunk_xy: IVec2,
    world_z: i32,
    view_z: i32,
    chunk_edge: u32,
    blocks: &HashMap<Vec3i, BlockType>,
    z_offset: i32,
    apply_depth_tint: bool,
) -> Vec<Option<TileData>> {
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

            // Column-aware: only render the topmost solid in each xy column.
            // Tiles below an opaque upper tile are occluded.
            if topmost_solid_z_in_column(world_position.x, world_position.y, view_z, blocks, false)
                == Some(world_z)
            {
                let mut td = TileData::from_tileset_index(stone_tile_index());
                td.color = if apply_depth_tint {
                    get_depth_tint_tile_color(z_offset)
                } else {
                    Color::WHITE
                };
                tile_data[index_in_slice] = Some(td);
            }
        }
    }

    tile_data
}

/// Dual-grid terrain edge shadow. Rendered offset by half a tile (+32, +32 px).
/// For each dual-grid cell (lx, ly), samples whether each of the 4 surrounding
/// world tiles at the same z is solid, building a 4-bit corner mask:
///
///   C = (wx,   wy+1)  |  D = (wx+1, wy+1)     bit 2 | bit 3
///   ------------------+------------------      ------+------
///   A = (wx,   wy  )  |  B = (wx+1, wy  )     bit 0 | bit 1
///
/// Mask 0 (all air) and mask 15 (all solid) produce no tile.
/// Masks 1-14 -> atlas frame index (mask - 1).
pub(super) fn build_edge_shadow_tile_data(
    chunk_xy: IVec2,
    world_z: i32,
    view_z: i32,
    chunk_edge: u32,
    blocks: &HashMap<Vec3i, BlockType>,
    unknown_is_solid: bool,
) -> Vec<Option<TileData>> {
    let tile_count = chunk_edge
        .checked_mul(chunk_edge)
        .expect("chunk tile count overflowed");
    let mut tile_data = vec![None; usize::try_from(tile_count).expect("tile count too large")];

    let chunk_coord = Vec3i::new(chunk_xy.x, chunk_xy.y, 0);

    for local_y in 0..chunk_edge {
        for local_x in 0..chunk_edge {
            let wp = world_pos_in_chunk(chunk_coord, chunk_edge, local_x, local_y, world_z);
            let index_in_slice = chunk_local_tile_index(local_x, local_y, chunk_edge);

            // Column-aware: a corner contributes to the edge mask only if it's the
            // topmost solid in its column (otherwise it's occluded and not rendered).
            let is_solid = |dx: i32, dy: i32| -> bool {
                topmost_solid_z_in_column(wp.x + dx, wp.y + dy, view_z, blocks, unknown_is_solid)
                    == Some(world_z)
            };

            let mut mask: u8 = 0;
            if is_solid(0, 0) {
                mask |= 1;
            } // A: bottom-left
            if is_solid(1, 0) {
                mask |= 2;
            } // B: bottom-right
            if is_solid(0, 1) {
                mask |= 4;
            } // C: top-left
            if is_solid(1, 1) {
                mask |= 8;
            } // D: top-right

            if mask > 0 && mask < 15 {
                tile_data[index_in_slice] = Some(TileData::from_tileset_index((mask - 1) as u16));
            }
        }
    }

    tile_data
}

/// Builds the dual-grid ceiling shadow tile data for one chunk at `world_z`.
///
/// The resulting tilemap is rendered offset by half a tile (+tile_size/2 in x and y)
/// relative to the regular floor chunks, so each shadow tile sits at the corner between
/// four regular tiles. For shadow tile at chunk-local (lx, ly), the 4-bit mask samples
/// whether the block ONE LEVEL ABOVE (world_z + 1) is solid at each of the four surrounding
/// world positions:
///
///   C = (wx,   wy+1)  |  D = (wx+1, wy+1)     bit 2 | bit 3
///   ──────────────────+──────────────────      ──────+──────
///   A = (wx,   wy  )  |  B = (wx+1, wy  )     bit 0 | bit 1
///
/// Mask 0 → no ceiling tile. Masks 1–15 → atlas frame index (mask - 1).
pub(super) fn build_ceiling_shadow_tile_data(
    chunk_xy: IVec2,
    world_z: i32,
    view_z: i32,
    chunk_edge: u32,
    blocks: &HashMap<Vec3i, BlockType>,
    unknown_is_solid: bool,
) -> Vec<Option<TileData>> {
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

            // Column-aware: a corner draws the ceiling only where (a) world_z is the
            // topmost-solid in its column (the actual visible floor) and (b) world_z+1
            // above is solid (something is overhanging it).
            let check_corner = |dx: i32, dy: i32| -> bool {
                let cx = wp.x + dx;
                let cy = wp.y + dy;
                let above = Vec3i::new(cx, cy, world_z + 1);
                topmost_solid_z_in_column(cx, cy, view_z, blocks, unknown_is_solid) == Some(world_z)
                    && terrain_block_for_shadow(above, blocks, unknown_is_solid)
                        == BlockType::SolidStone
            };

            if check_corner(0, 0) {
                mask |= 1;
            } // A: bottom-left
            if check_corner(1, 0) {
                mask |= 2;
            } // B: bottom-right
            if check_corner(0, 1) {
                mask |= 4;
            } // C: top-left
            if check_corner(1, 1) {
                mask |= 8;
            } // D: top-right

            if mask != 0 {
                tile_data[index_in_slice] = Some(TileData::from_tileset_index((mask - 1) as u16));
            }
        }
    }

    tile_data
}

pub(super) fn build_fog_tile_data(
    chunk_xy: IVec2,
    world_z: i32,
    current_z: i32,
    chunk_edge: u32,
    blocks: &HashMap<Vec3i, BlockType>,
    fog: &FogData,
) -> Vec<Option<TileData>> {
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

            // Column-aware: yellow tint applies only at the topmost-solid tile in the
            // column (the tile the player actually sees), and only when that tile is
            // not currently in FOV.
            if topmost_solid_z_in_column(wx, wy, current_z, blocks, false) != Some(world_z) {
                continue;
            }

            if fog.visible.contains(&world_pos) {
                continue;
            }

            let mut td = TileData::from_tileset_index(0);
            td.color = Color::srgba(
                REMEMBERED_FOG_RGBA[0],
                REMEMBERED_FOG_RGBA[1],
                REMEMBERED_FOG_RGBA[2],
                REMEMBERED_FOG_RGBA[3],
            );
            tile_data[idx] = Some(td);
        }
    }

    tile_data
}
