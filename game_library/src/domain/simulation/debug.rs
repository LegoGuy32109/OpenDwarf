use super::*;

pub fn draw_depth_labels(
    mut commands: Commands,
    chunk_border_debug_state: Res<ChunkBorderDebugState>,
    view_z: Res<ViewZLevel>,
    view_mode: Res<ViewMode>,
    config: Res<TerrainConfig>,
    terrain: Res<TerrainData>,
    viewport: Res<RenderViewport>,
    existing_labels: Query<Entity, With<DepthDebugLabel>>,
) {
    // Return early if debug labels are disabled
    if !chunk_border_debug_state.visible {
        // Despawn any existing labels
        for entity in &existing_labels {
            commands.entity(entity).despawn();
        }
        return;
    }

    // Only rebuild if something changed.
    if !viewport.is_changed() && !view_z.is_changed() && !chunk_border_debug_state.is_changed() {
        return;
    }

    let chunk_edge = config.chunk_edge;
    let tile_size = f32::from(TILE_SIZE_IN_PX);

    // Despawn all existing labels
    for entity in &existing_labels {
        commands.entity(entity).despawn();
    }

    // Determine z-levels to render (same as tints)
    let z_levels_to_render = z_levels_to_render(view_z.current);
    let entity_mode = *view_mode == ViewMode::Entity;
    let render_blocks = if entity_mode {
        &terrain.blocks
    } else {
        terrain.source_blocks.as_ref()
    };

    // Phase 3: use viewport instead of active_chunks_xy for viewport-bounded rendering
    // For each chunk and each visible z-level, spawn shadow mask labels on air tiles
    for &chunk_xy in &viewport.visible_chunks_xy {
        let chunk_coord = Vec3i::new(chunk_xy.x, chunk_xy.y, 0);
        for &world_z in &z_levels_to_render {
            for local_y in 0..chunk_edge {
                for local_x in 0..chunk_edge {
                    let world_position =
                        world_pos_in_chunk(chunk_coord, chunk_edge, local_x, local_y, world_z);

                    // Only label air tiles that have shadows
                    if terrain_block(world_position, render_blocks) == BlockType::Air {
                        let mask = compute_shadow_mask_for_air(
                            world_position.x,
                            world_position.y,
                            world_position.z,
                            render_blocks,
                        );

                        // Only spawn label if there's a shadow
                        if mask != 0 {
                            let mask_text = mask.to_string();
                            let text_position =
                                world_to_pixel_translation(world_position, tile_size);

                            commands.spawn((
                                Text2d::new(mask_text),
                                TextFont {
                                    font_size: 12.0,
                                    ..default()
                                },
                                TextColor(Color::srgba(1.0, 1.0, 0.0, 0.95)),
                                Transform::from_translation(
                                    text_position + Vec3::new(0.0, 0.0, 2.0),
                                ),
                                DepthDebugLabel,
                            ));
                        }
                    }
                }
            }
        }
    }
}

pub fn toggle_chunk_borders(
    input_state: Res<InputState>,
    mut chunk_border_debug_state: ResMut<ChunkBorderDebugState>,
) {
    if input_state.just_pressed_key(KeyCode::F3) {
        chunk_border_debug_state.visible = !chunk_border_debug_state.visible;
        info!(
            "Chunk borders {}",
            if chunk_border_debug_state.visible {
                "enabled"
            } else {
                "disabled"
            }
        );
    }
}

pub fn draw_chunk_borders(
    chunk_border_debug_state: Res<ChunkBorderDebugState>,
    mut gizmos: Gizmos,
    chunk_query: Query<(&TilemapChunk, &Transform), With<WorldTileChunk>>,
) {
    if !chunk_border_debug_state.visible {
        return;
    }

    let border_color = Color::srgba(1.0, 1.0, 0.0, 0.95);
    for (tilemap_chunk, transform) in &chunk_query {
        let size = Vec2::new(
            tilemap_chunk.chunk_size.x as f32 * tilemap_chunk.tile_display_size.x as f32,
            tilemap_chunk.chunk_size.y as f32 * tilemap_chunk.tile_display_size.y as f32,
        );
        gizmos.rect_2d(
            Isometry2d::from_translation(transform.translation.truncate()),
            size,
            border_color,
        );
    }
}
