use super::*;

pub fn manage_tilemap_chunk_lifecycle(
    mut commands: Commands,
    replay_mode: Res<ReplayMode>,
    chunk_streaming_state: Option<Res<ChunkStreamingState>>,
    view_z: Res<ViewZLevel>,
    view_mode: Res<ViewMode>,
    tile_layer_debug_state: Res<TileLayerDebugState>,
    tilemap_assets: Res<TilemapAssets>,
    shadow_atlas: Res<crate::domain::visuals::EdgeShadowAtlas>,
    obscure_atlas: Res<crate::domain::visuals::CeilingShadowAtlas>,
    fog_atlas: Res<crate::domain::visuals::FogShadowAtlas>,
    config: Res<TerrainConfig>,
    chunk_query: Query<(Entity, &WorldTileChunk)>,
    mut invalidation: ResMut<crate::domain::tilemap_invalidation::TilemapInvalidation>,
) {
    let chunk_edge = config.chunk_edge;
    if chunk_edge == 0 {
        return;
    }

    let active_chunks_xy = active_chunks_xy(
        replay_mode.active,
        config.world_chunks,
        chunk_streaming_state.as_deref(),
    );
    let rendered_z_levels = if tile_layer_debug_state.show_depth_stack {
        z_levels_to_render(view_z.current)
    } else {
        vec![view_z.current]
    };
    let entity_mode = *view_mode == ViewMode::Entity;
    let render_floor = tile_layer_debug_state.show_floor;
    let render_edge_shadow = tile_layer_debug_state.show_edge_shadow;
    let render_ceiling_shadow = tile_layer_debug_state.show_ceiling_shadow;
    let render_fog_shadow = entity_mode && tile_layer_debug_state.show_fog_shadow;

    let existing_chunks: HashSet<(IVec2, i32, TileLayer)> = chunk_query
        .iter()
        .map(|(_, chunk)| (chunk.chunk_xy, chunk.world_z, chunk.layer))
        .collect();

    for &chunk_xy in &active_chunks_xy {
        for &world_z in &rendered_z_levels {
            if render_floor {
                let chunk_key = (chunk_xy, world_z, TileLayer::Floor);
                if !existing_chunks.contains(&chunk_key) {
                    spawn_empty_tilemap_chunk(
                        &mut commands,
                        chunk_xy,
                        world_z,
                        view_z.current,
                        TileLayer::Floor,
                        chunk_edge,
                        &tilemap_assets,
                        &shadow_atlas,
                        &obscure_atlas,
                        &fog_atlas,
                    );
                    invalidation.mark(chunk_xy, world_z, TileLayer::Floor);
                }
            }

            if render_edge_shadow {
                let chunk_key = (chunk_xy, world_z, TileLayer::EdgeShadow);
                if !existing_chunks.contains(&chunk_key) {
                    spawn_empty_tilemap_chunk(
                        &mut commands,
                        chunk_xy,
                        world_z,
                        view_z.current,
                        TileLayer::EdgeShadow,
                        chunk_edge,
                        &tilemap_assets,
                        &shadow_atlas,
                        &obscure_atlas,
                        &fog_atlas,
                    );
                    invalidation.mark(chunk_xy, world_z, TileLayer::EdgeShadow);
                }
            }

            if render_ceiling_shadow && world_z == view_z.current {
                let chunk_key = (chunk_xy, world_z, TileLayer::CeilingShadow);
                if !existing_chunks.contains(&chunk_key) {
                    spawn_empty_tilemap_chunk(
                        &mut commands,
                        chunk_xy,
                        world_z,
                        view_z.current,
                        TileLayer::CeilingShadow,
                        chunk_edge,
                        &tilemap_assets,
                        &shadow_atlas,
                        &obscure_atlas,
                        &fog_atlas,
                    );
                    invalidation.mark(chunk_xy, world_z, TileLayer::CeilingShadow);
                }
            }

            if render_fog_shadow {
                let chunk_key = (chunk_xy, world_z, TileLayer::FogShadow);
                if !existing_chunks.contains(&chunk_key) {
                    spawn_empty_tilemap_chunk(
                        &mut commands,
                        chunk_xy,
                        world_z,
                        view_z.current,
                        TileLayer::FogShadow,
                        chunk_edge,
                        &tilemap_assets,
                        &shadow_atlas,
                        &obscure_atlas,
                        &fog_atlas,
                    );
                    invalidation.mark(chunk_xy, world_z, TileLayer::FogShadow);
                }
            }
        }
    }

    for (entity, world_chunk) in &chunk_query {
        let in_active_xy = active_chunks_xy.contains(&world_chunk.chunk_xy);
        let in_z_range = rendered_z_levels.contains(&world_chunk.world_z);
        let layer_ok = match world_chunk.layer {
            TileLayer::Floor => render_floor,
            TileLayer::EdgeShadow => render_edge_shadow,
            TileLayer::CeilingShadow => {
                render_ceiling_shadow && world_chunk.world_z == view_z.current
            }
            TileLayer::FogShadow => render_fog_shadow,
        };
        if !in_active_xy || !in_z_range || !layer_ok {
            commands.entity(entity).despawn();
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn spawn_empty_tilemap_chunk(
    commands: &mut Commands,
    chunk_xy: IVec2,
    world_z: i32,
    view_z_current: i32,
    layer: TileLayer,
    chunk_edge: u32,
    tilemap_assets: &TilemapAssets,
    shadow_atlas: &crate::domain::visuals::EdgeShadowAtlas,
    obscure_atlas: &crate::domain::visuals::CeilingShadowAtlas,
    fog_atlas: &crate::domain::visuals::FogShadowAtlas,
) {
    let z_offset = world_z - view_z_current;
    let sprite_z = calculate_sprite_z(z_offset, layer);
    let half_tile = f32::from(crate::domain::visuals::TILE_SIZE_IN_PX) / 2.0;
    let offset = if matches!(layer, TileLayer::EdgeShadow | TileLayer::CeilingShadow) {
        Vec3::new(half_tile, half_tile, 0.0)
    } else {
        Vec3::ZERO
    };
    let (tile_display_size, tileset, alpha_mode) = match layer {
        TileLayer::Floor => (
            tilemap_assets.tile_display_size,
            tilemap_assets.tileset.clone(),
            bevy::sprite_render::AlphaMode2d::Opaque,
        ),
        TileLayer::EdgeShadow => (
            UVec2::splat(64),
            shadow_atlas.atlas.clone(),
            bevy::sprite_render::AlphaMode2d::Blend,
        ),
        TileLayer::CeilingShadow => (
            UVec2::splat(64),
            obscure_atlas.atlas.clone(),
            bevy::sprite_render::AlphaMode2d::Blend,
        ),
        TileLayer::FogShadow => (
            UVec2::splat(64),
            fog_atlas.atlas.clone(),
            bevy::sprite_render::AlphaMode2d::Blend,
        ),
    };

    commands.spawn((
        WorldTileChunk {
            chunk_xy,
            world_z,
            layer,
        },
        TilemapChunk {
            chunk_size: UVec2::splat(chunk_edge),
            tile_display_size,
            tileset,
            alpha_mode,
        },
        TilemapChunkTileData(empty_chunk_tile_data(chunk_edge)),
        Transform::from_translation(
            chunk_world_translation_xy(chunk_xy, chunk_edge, sprite_z) + offset,
        ),
        GlobalTransform::default(),
        Visibility::default(),
        InheritedVisibility::default(),
        ViewVisibility::default(),
    ));
}

pub fn project_world_to_tilemap(
    replay_mode: Res<ReplayMode>,
    chunk_streaming_state: Option<Res<ChunkStreamingState>>,
    view_z: Res<ViewZLevel>,
    view_mode: Res<ViewMode>,
    tile_layer_debug_state: Res<TileLayerDebugState>,
    config: Res<TerrainConfig>,
    terrain: Res<TerrainData>,
    fog_data: Res<FogData>,
    mut tilemap_render_metrics: ResMut<TilemapRenderMetrics>,
    mut chunk_query: Query<(&WorldTileChunk, &mut TilemapChunkTileData, &mut Transform)>,
    mut invalidation: ResMut<crate::domain::tilemap_invalidation::TilemapInvalidation>,
) {
    #[cfg(not(target_arch = "wasm32"))]
    let start = std::time::Instant::now();

    // Z-level changes require tile data rebuild for depth tinting.
    if view_z.is_changed() {
        invalidation.invalidate_view();
    }

    // ViewMode changes should refresh the full tile projection immediately.
    if view_mode.is_changed() {
        invalidation.invalidate_view();
    }

    if tile_layer_debug_state.is_changed() {
        invalidation.invalidate_view();
    }

    if invalidation.is_empty() && !invalidation.view_invalidated() && !invalidation.viewport_changed
    {
        return;
    }

    let chunk_edge = config.chunk_edge;
    if chunk_edge == 0 {
        return;
    }

    let entity_mode = *view_mode == ViewMode::Entity;

    let active_chunks_xy = active_chunks_xy(
        replay_mode.active,
        config.world_chunks,
        chunk_streaming_state.as_deref(),
    );

    let render_depth_stack = tile_layer_debug_state.show_depth_stack;
    let rendered_z_levels = if render_depth_stack {
        z_levels_to_render(view_z.current)
    } else {
        vec![view_z.current]
    };

    // Compute the set of chunks that need rebuilding: those that are both stale and visible.
    let mut to_rebuild: HashSet<(IVec2, i32, TileLayer)> = HashSet::new();
    if invalidation.view_invalidated() {
        // Full view invalidation: rebuild all visible chunks.
        // On startup, viewport may not be ready yet, so fall back to all active chunks.
        let chunks_to_rebuild = if !invalidation.visible_chunks_xy.is_empty() {
            invalidation.visible_chunks_xy.clone()
        } else {
            active_chunks_xy.clone()
        };
        // Always use rendered_z_levels (computed from current view_z) rather than
        // invalidation.visible_z_levels, which is stale from PreUpdate when view_z changes.
        let z_levels = &rendered_z_levels;

        for &chunk_xy in &chunks_to_rebuild {
            for &z in z_levels {
                if tile_layer_debug_state.show_floor {
                    to_rebuild.insert((chunk_xy, z, TileLayer::Floor));
                }
                if tile_layer_debug_state.show_edge_shadow {
                    to_rebuild.insert((chunk_xy, z, TileLayer::EdgeShadow));
                }
                if tile_layer_debug_state.show_ceiling_shadow && z == view_z.current {
                    to_rebuild.insert((chunk_xy, z, TileLayer::CeilingShadow));
                }
                if entity_mode && tile_layer_debug_state.show_fog_shadow {
                    to_rebuild.insert((chunk_xy, z, TileLayer::FogShadow));
                }
            }
        }
    } else {
        // Partial invalidation: drain visible dirty entries
        // Create a temporary viewport struct for drain_visible_into
        let mut viewport = RenderViewport::default();
        viewport.visible_chunks_xy = invalidation.visible_chunks_xy.clone();
        viewport.visible_z_levels = invalidation.visible_z_levels.clone();
        invalidation.drain_visible_into(&viewport, &mut to_rebuild);
    }

    // Newly-visible chunks (entered viewport this frame): mark all layers.
    if invalidation.viewport_changed {
        for &chunk_xy in &invalidation.newly_visible_chunks_xy {
            for &z in &rendered_z_levels {
                if tile_layer_debug_state.show_floor {
                    to_rebuild.insert((chunk_xy, z, TileLayer::Floor));
                }
                if tile_layer_debug_state.show_edge_shadow {
                    to_rebuild.insert((chunk_xy, z, TileLayer::EdgeShadow));
                }
                if tile_layer_debug_state.show_ceiling_shadow && z == view_z.current {
                    to_rebuild.insert((chunk_xy, z, TileLayer::CeilingShadow));
                }
                if entity_mode && tile_layer_debug_state.show_fog_shadow {
                    to_rebuild.insert((chunk_xy, z, TileLayer::FogShadow));
                }
            }
        }
    }

    let render_blocks = if entity_mode {
        &terrain.blocks
    } else {
        terrain.source_blocks.as_ref()
    };

    let render_floor = tile_layer_debug_state.show_floor;
    let render_edge_shadow = tile_layer_debug_state.show_edge_shadow;
    let render_ceiling_shadow = tile_layer_debug_state.show_ceiling_shadow;
    let render_fog_shadow = entity_mode && tile_layer_debug_state.show_fog_shadow;

    // Update existing chunks.
    let half_tile = f32::from(crate::domain::visuals::TILE_SIZE_IN_PX) / 2.0;
    let mut non_empty_tile_count = 0usize;
    let mut rebuilt_keys = Vec::new();
    for (world_chunk, mut chunk_data, mut transform) in &mut chunk_query {
        // Respect per-layer render-enabled flag (still skip layers the user disabled).
        let layer_render_enabled = match world_chunk.layer {
            TileLayer::Floor => render_floor,
            TileLayer::EdgeShadow => render_edge_shadow,
            TileLayer::CeilingShadow => render_ceiling_shadow,
            TileLayer::FogShadow => render_fog_shadow,
        };
        if !layer_render_enabled {
            continue;
        }

        // to_rebuild is the authoritative source of truth for what needs rebuilding.
        if !to_rebuild.contains(&(world_chunk.chunk_xy, world_chunk.world_z, world_chunk.layer)) {
            continue;
        }

        let z_off = world_chunk.world_z - view_z.current;
        let sprite_z = calculate_sprite_z(z_off, world_chunk.layer);
        let base_translation =
            chunk_world_translation_xy(world_chunk.chunk_xy, chunk_edge, sprite_z);
        *transform = Transform::from_translation(
            if matches!(
                world_chunk.layer,
                TileLayer::EdgeShadow | TileLayer::CeilingShadow
            ) {
                base_translation + Vec3::new(half_tile, half_tile, 0.0)
            } else {
                base_translation
            },
        );

        let tile_data = match world_chunk.layer {
            TileLayer::Floor => build_chunk_tile_data(
                world_chunk.chunk_xy,
                world_chunk.world_z,
                view_z.current,
                chunk_edge,
                render_blocks,
                z_off,
                render_depth_stack,
            ),
            TileLayer::EdgeShadow => build_edge_shadow_tile_data(
                world_chunk.chunk_xy,
                world_chunk.world_z,
                view_z.current,
                chunk_edge,
                render_blocks,
                entity_mode,
            ),
            TileLayer::CeilingShadow => build_ceiling_shadow_tile_data(
                world_chunk.chunk_xy,
                world_chunk.world_z,
                view_z.current,
                chunk_edge,
                render_blocks,
                entity_mode,
            ),
            TileLayer::FogShadow => build_fog_tile_data(
                world_chunk.chunk_xy,
                world_chunk.world_z,
                view_z.current,
                chunk_edge,
                render_blocks,
                &fog_data,
            ),
        };
        non_empty_tile_count = non_empty_tile_count
            .saturating_add(tile_data.iter().filter(|tile| tile.is_some()).count());
        chunk_data.0 = tile_data;
        rebuilt_keys.push((world_chunk.chunk_xy, world_chunk.world_z, world_chunk.layer));
    }

    tilemap_render_metrics.chunk_count = to_rebuild.len();
    tilemap_render_metrics.non_empty_tile_count = non_empty_tile_count;
    #[cfg(not(target_arch = "wasm32"))]
    {
        tilemap_render_metrics.last_rebuild_micros = start.elapsed().as_micros();
        tilemap_render_metrics.rebuild_count =
            tilemap_render_metrics.rebuild_count.saturating_add(1);
        if tilemap_render_metrics.last_rebuild_micros > 8_000 {
            warn!(
                "Tilemap rebuild slow: {}us across {} chunks and {} non-empty tiles",
                tilemap_render_metrics.last_rebuild_micros,
                tilemap_render_metrics.chunk_count,
                tilemap_render_metrics.non_empty_tile_count
            );
        }
    }
    if invalidation.view_invalidated() {
        invalidation.clear_view_invalidated();
    }
    invalidation.viewport_changed = false;
    // Remove the entries we just rebuilt from the invalidation set.
    for (chunk_xy, z, layer) in rebuilt_keys {
        invalidation.remove(chunk_xy, z, layer);
    }
}
