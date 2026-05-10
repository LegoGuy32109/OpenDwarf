use super::*;

pub(super) fn active_chunks_xy(
    replay_active: bool,
    world_chunks: Vec3u,
    chunk_streaming_state: Option<&ChunkStreamingState>,
) -> HashSet<IVec2> {
    if replay_active {
        all_world_chunk_coords(world_chunks)
            .into_iter()
            .map(|c| IVec2::new(c.x, c.y))
            .collect()
    } else if let Some(streaming) = chunk_streaming_state {
        if streaming.loaded_chunks.is_empty() {
            all_world_chunk_coords(world_chunks)
                .into_iter()
                .map(|c| IVec2::new(c.x, c.y))
                .collect()
        } else {
            streaming
                .loaded_chunks
                .iter()
                .map(|c| IVec2::new(c.x, c.y))
                .collect()
        }
    } else {
        all_world_chunk_coords(world_chunks)
            .into_iter()
            .map(|c| IVec2::new(c.x, c.y))
            .collect()
    }
}

pub(super) fn z_levels_to_render(view_z_current: i32) -> Vec<i32> {
    (0..=Z_LEVELS_BELOW_RENDERED)
        .map(|offset| view_z_current - offset)
        .collect()
}

pub(super) fn chunk_local_tile_index(local_x: u32, local_y: u32, chunk_edge: u32) -> usize {
    usize::try_from(local_y)
        .expect("local_y does not fit in usize")
        .checked_mul(usize::try_from(chunk_edge).expect("chunk edge does not fit in usize"))
        .and_then(|offset| {
            offset.checked_add(usize::try_from(local_x).expect("local_x does not fit in usize"))
        })
        .expect("chunk-local tile index overflowed")
}

pub(super) fn empty_chunk_tile_data(chunk_edge: u32) -> Vec<Option<TileData>> {
    vec![
        None;
        usize::try_from(chunk_edge)
            .expect("chunk_edge overflowed")
            .checked_mul(usize::try_from(chunk_edge).expect("chunk_edge overflowed"))
            .expect("chunk tile count overflowed")
    ]
}

pub(super) fn world_pos_in_chunk(
    chunk_coord: Vec3i,
    chunk_edge: u32,
    x: u32,
    y: u32,
    z: i32,
) -> Vec3i {
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

pub(super) fn calculate_sprite_z(z_offset: i32, layer: TileLayer) -> f32 {
    let base = (z_offset.clamp(-5, 0) * 2) as f32;

    match layer {
        TileLayer::Floor => base,
        TileLayer::EdgeShadow => base + 0.5,
        TileLayer::CeilingShadow => base + 0.75, // above edge shadows, below entities
        TileLayer::FogShadow => GLOBAL_MEMORY_OVERLAY_SPRITE_Z,
    }
}

/// Multiplicative tint color for tiles at a given z-offset from the camera.
/// Converts the old overlay-based depth tinting to per-tile color multiplication.
/// Formula: for overlay srgba(r, g, b, a), the equivalent multiplicative color is
/// srgb(1-a + a*r, 1-a + a*g, 1-a + a*b).
pub(super) fn get_depth_tint_tile_color(z_offset: i32) -> Color {
    match z_offset {
        0 => Color::WHITE,
        -1 => Color::srgb(0.75, 0.75, 0.75), // 25% black overlay
        -2 => Color::srgb(0.47, 0.49, 0.49), // blue-gray 45%
        -3 => Color::srgb(0.33, 0.35, 0.61), // blue-gray 60%
        -4 => Color::srgb(0.22, 0.24, 0.61), // blue-gray 72%
        -5 => Color::srgb(0.12, 0.15, 0.43), // blue-gray 82%
        _ => Color::srgb(0.02, 0.05, 0.43),
    }
}

pub(super) fn get_depth_tint_sprite_color(z_offset: i32) -> Color {
    // Sprites can appear above or below the view plane; tint by absolute distance.
    match z_offset.abs() {
        0 => Color::WHITE,
        1 => Color::srgb(0.75, 0.75, 0.75),
        2 => Color::srgb(0.47, 0.49, 0.49),
        3 => Color::srgb(0.33, 0.35, 0.61),
        4 => Color::srgb(0.22, 0.24, 0.61),
        5 => Color::srgb(0.12, 0.15, 0.43),
        _ => Color::srgb(0.02, 0.05, 0.43),
    }
}

pub(super) fn chunk_world_translation_xy(chunk_xy: IVec2, chunk_edge: u32, sprite_z: f32) -> Vec3 {
    let edge = chunk_edge as f32;
    let tile_size = f32::from(TILE_SIZE_IN_PX);
    Vec3::new(
        (chunk_xy.x as f32) * edge * tile_size,
        (chunk_xy.y as f32) * edge * tile_size,
        sprite_z,
    )
}

pub(super) fn world_to_pixel_translation(world_position: Vec3i, tile_size: f32) -> Vec3 {
    Vec3::new(
        ((world_position.x as f32) + 0.5) * tile_size,
        ((world_position.y as f32) + 0.5) * tile_size,
        1.0,
    )
}

pub(super) fn world_to_pixel_translation_f32(world_position: Vec3, tile_size: f32) -> Vec3 {
    Vec3::new(
        (world_position.x + 0.5) * tile_size,
        (world_position.y + 0.5) * tile_size,
        1.0,
    )
}

pub(super) fn render_movement_state(movement: EntityMovementSnapshot) -> RenderEntityMovementState {
    RenderEntityMovementState {
        start_position: Vec3::new(
            movement.start_position[0],
            movement.start_position[1],
            movement.start_position[2],
        ),
        origin: movement.origin,
        target: movement.target,
        progress_percent: movement.progress_percent,
    }
}

pub(super) fn render_movement_direction(movement: RenderEntityMovementState) -> IVec3 {
    IVec3::new(
        (movement.target.x - movement.origin.x).signum(),
        (movement.target.y - movement.origin.y).signum(),
        (movement.target.z - movement.origin.z).signum(),
    )
}

pub(super) fn all_world_chunk_coords(world_chunks: Vec3u) -> HashSet<Vec3i> {
    let mut result = HashSet::new();
    let center_x = i32::try_from(world_chunks.x).expect("world_chunks.x too large") / 2;
    let center_y = i32::try_from(world_chunks.y).expect("world_chunks.y too large") / 2;
    let center_z = i32::try_from(world_chunks.z).expect("world_chunks.z too large") / 2;

    for z in 0..world_chunks.z {
        for y in 0..world_chunks.y {
            for x in 0..world_chunks.x {
                result.insert(Vec3i::new(
                    i32::try_from(x).expect("x too large") - center_x,
                    i32::try_from(y).expect("y too large") - center_y,
                    i32::try_from(z).expect("z too large") - center_z,
                ));
            }
        }
    }

    result
}

pub(super) fn desired_streaming_window(
    viewport: &RenderViewport,
    world_chunks: Vec3u,
) -> HashSet<Vec3i> {
    // Use visible_chunks_xy from viewport (includes 1-chunk padding from Phase 1).
    // Extend z range by ±1 for boundary correctness:
    // - EdgeShadow reads z-1 neighbor
    // - CeilingShadow reads z+1 for ceiling input
    let z_min = viewport
        .visible_z_levels
        .iter()
        .min()
        .copied()
        .unwrap_or(0)
        .saturating_sub(1);
    let z_max = viewport
        .visible_z_levels
        .iter()
        .max()
        .copied()
        .unwrap_or(0)
        .saturating_add(1);

    let all_chunks = all_world_chunk_coords(world_chunks);
    let mut window = HashSet::new();

    for &chunk_xy in &viewport.visible_chunks_xy {
        for z in z_min..=z_max {
            let chunk = Vec3i::new(chunk_xy.x, chunk_xy.y, z);
            if all_chunks.contains(&chunk) {
                window.insert(chunk);
            }
        }
    }

    window
}

/// Compute which cardinal edges of a tile are exposed (adjacent to air).
/// Returns a 4-bit mask: bit 0 (N), bit 1 (E), bit 2 (S), bit 3 (W)
/// Compute shadow mask for an AIR tile by checking which cardinal neighbors are SOLID.
/// Returns a 4-bit mask: bit 0 (N), bit 1 (E), bit 2 (S), bit 3 (W).
/// Shadows appear on the edges of air tiles that face solid neighbors.
pub(super) fn compute_shadow_mask_for_air(
    x: i32,
    y: i32,
    z: i32,
    blocks: &HashMap<Vec3i, BlockType>,
) -> u8 {
    let mut mask = 0u8;
    let solid = |pos: Vec3i| terrain_block_for_shadow(pos, blocks, false) == BlockType::SolidStone;

    if solid(Vec3i::new(x, y + 1, z)) {
        mask |= 1;
    } // North
    if solid(Vec3i::new(x + 1, y, z)) {
        mask |= 2;
    } // East
    if solid(Vec3i::new(x, y - 1, z)) {
        mask |= 4;
    } // South
    if solid(Vec3i::new(x - 1, y, z)) {
        mask |= 8;
    } // West

    mask
}

/// Returns the block at `pos`, defaulting to `Air` for positions not in the sparse map.
pub(super) fn terrain_block(pos: Vec3i, blocks: &HashMap<Vec3i, BlockType>) -> BlockType {
    blocks.get(&pos).copied().unwrap_or(BlockType::Air)
}

pub(super) fn terrain_block_for_shadow(
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

/// Find the highest z in `[view_z - Z_LEVELS_BELOW_RENDERED, view_z]` where
/// `(wx, wy, z)` is solid stone. Returns `None` if no solid tile exists in that range.
/// This is the tile the player "sees" looking down at column (wx, wy).
pub(super) fn topmost_solid_z_in_column(
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
