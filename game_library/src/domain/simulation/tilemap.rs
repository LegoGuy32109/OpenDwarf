use bevy::platform::collections::HashSet;
use bevy::prelude::*;
use bevy::sprite_render::{TilemapChunk, TilemapChunkTileData};

use super::coords::*;
use super::tile_builders::{
    build_ceiling_shadow_geometry, build_edge_shadow_geometry, build_floor_geometry,
    build_fog_geometry, build_topmost_cache, floor_tile_data_from_geometry,
    fog_tile_data_from_cache, shadow_tile_data_from_geometry,
};
use super::{
    ChunkStreamingState, FogData, ReplayMode, TerrainConfig, TerrainData, TileDataCache, TileLayer,
    TileLayerDebugState, TilemapRenderMetrics, WorldTileChunk,
};
use crate::domain::visuals::TilemapAssets;
use crate::resources::render_viewport::RenderViewport;
use crate::resources::view_mode::ViewMode;
use crate::resources::view_z_level::ViewZLevel;

/// Max (chunk_xy, z, layer) entries rebuilt per frame. Spreading the work prevents
/// single-frame stalls on WASM where all work runs on one thread.
const REBUILD_BUDGET_PER_FRAME: usize = 128;

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
        z_levels_to_render(view_z.current, config.z_levels_below_rendered)
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

    // Spawn entities only for camera-visible chunks to avoid GPU overhead for off-screen tiles.
    // Fall back to active_chunks_xy when the viewport hasn't been computed yet (first frame).
    let spawn_chunks_xy: HashSet<IVec2> = if !invalidation.visible_chunks_xy.is_empty() {
        invalidation.visible_chunks_xy.clone()
    } else {
        active_chunks_xy.clone()
    };

    for &chunk_xy in &spawn_chunks_xy {
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
    mut tile_cache: ResMut<TileDataCache>,
) {
    // Cross-platform frame timing: std::time::Instant panics on WASM.
    #[cfg(not(target_arch = "wasm32"))]
    let start = std::time::Instant::now();
    #[cfg(target_arch = "wasm32")]
    let start_ms = js_sys::Date::now();

    // Any of these changes means rendered tiles need new data (depth tint, mode, etc.).
    // Prune dirty entries for z-levels no longer in the rendered window BEFORE expanding,
    // so stale entries from previous z-level steps don't accumulate in the dirty set.
    if view_z.is_changed() || view_mode.is_changed() || tile_layer_debug_state.is_changed() {
        let rendered_z_levels_now = if tile_layer_debug_state.show_depth_stack {
            z_levels_to_render(view_z.current, config.z_levels_below_rendered)
        } else {
            vec![view_z.current]
        };
        invalidation.retain_z_levels(&rendered_z_levels_now);
        invalidation.invalidate_view();
        // View mode change: block-to-blocks mapping changes (entity uses filtered blocks),
        // so geometry cache is no longer valid for the new mode.
        if view_mode.is_changed() {
            tile_cache.geometry.clear();
            tile_cache.fog.clear();
        }
    }

    if invalidation.is_empty() && !invalidation.viewport_changed {
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
        z_levels_to_render(view_z.current, config.z_levels_below_rendered)
    } else {
        vec![view_z.current]
    };

    // Full view invalidation: expand into per-chunk dirty entries so the budget system
    // can process them incrementally rather than stalling a single frame.
    if invalidation.view_invalidated() {
        let chunks_to_invalidate = if !invalidation.visible_chunks_xy.is_empty() {
            invalidation.visible_chunks_xy.clone()
        } else {
            active_chunks_xy.clone()
        };
        let z_levels = &rendered_z_levels;

        for &chunk_xy in &chunks_to_invalidate {
            for &z in z_levels {
                if tile_layer_debug_state.show_floor {
                    invalidation.mark(chunk_xy, z, TileLayer::Floor);
                }
                if tile_layer_debug_state.show_edge_shadow {
                    invalidation.mark(chunk_xy, z, TileLayer::EdgeShadow);
                }
                if tile_layer_debug_state.show_ceiling_shadow && z == view_z.current {
                    invalidation.mark(chunk_xy, z, TileLayer::CeilingShadow);
                }
                if entity_mode && tile_layer_debug_state.show_fog_shadow {
                    invalidation.mark(chunk_xy, z, TileLayer::FogShadow);
                }
            }
        }
        invalidation.clear_view_invalidated();
    }

    // Priority 1: newly visible chunks (camera scroll) — always rebuild immediately so
    // the player never sees blank tiles when panning.
    let mut to_rebuild: HashSet<(IVec2, i32, TileLayer)> = HashSet::new();
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
        invalidation.viewport_changed = false;
    }

    // Priority 2: dirty set — drain up to remaining budget.
    let remaining_budget = REBUILD_BUDGET_PER_FRAME.saturating_sub(to_rebuild.len());
    if remaining_budget > 0 {
        let mut viewport = RenderViewport::default();
        viewport.visible_chunks_xy = invalidation.visible_chunks_xy.clone();
        viewport.visible_z_levels = invalidation.visible_z_levels.clone();
        let mut dirty_this_frame: HashSet<(IVec2, i32, TileLayer)> = HashSet::new();
        invalidation.drain_visible_into(&viewport, &mut dirty_this_frame);
        to_rebuild.extend(dirty_this_frame.into_iter().take(remaining_budget));
    }

    if to_rebuild.is_empty() {
        return;
    }

    let render_blocks = if entity_mode {
        &terrain.blocks
    } else {
        terrain.source_blocks.as_ref()
    };

    // Collect unique chunk XY positions in this frame's rebuild set.
    let rebuild_chunk_xys: HashSet<IVec2> = to_rebuild.iter().map(|&(c, _, _)| c).collect();

    // Pre-scan to determine which topmost caches are actually needed.
    // Geometry caches store per-tile indices for static layers; fog cache stores RGBA per tile.
    // We skip building the (expensive) topmost cache entirely when all dirty entries hit the cache.
    let needs_false_topmost = to_rebuild.iter().any(|&(c, z, l)| match l {
        TileLayer::Floor => !tile_cache.geometry.contains_key(&(c, z, TileLayer::Floor)),
        TileLayer::EdgeShadow => false,    // uses true cache
        TileLayer::CeilingShadow => false, // uses true cache
        TileLayer::FogShadow => !tile_cache.fog.contains_key(&(c, z)),
    });
    let needs_true_topmost = entity_mode
        && to_rebuild.iter().any(|&(c, z, l)| match l {
            TileLayer::EdgeShadow => {
                !tile_cache
                    .geometry
                    .contains_key(&(c, z, TileLayer::EdgeShadow))
            }
            TileLayer::CeilingShadow => {
                !tile_cache
                    .geometry
                    .contains_key(&(c, z, TileLayer::CeilingShadow))
            }
            _ => false,
        });

    let topmost_cache_false = if needs_false_topmost {
        Some(build_topmost_cache(
            rebuild_chunk_xys.iter().copied(),
            view_z.current,
            chunk_edge,
            render_blocks,
            false,
            config.z_levels_below_rendered,
        ))
    } else {
        None
    };
    let topmost_cache_true = if needs_true_topmost {
        Some(build_topmost_cache(
            rebuild_chunk_xys.iter().copied(),
            view_z.current,
            chunk_edge,
            render_blocks,
            true,
            config.z_levels_below_rendered,
        ))
    } else if !entity_mode && needs_false_topmost {
        // In master mode, edge/ceiling shadow use the same (false) cache.
        topmost_cache_false.clone()
    } else {
        None
    };

    let render_floor = tile_layer_debug_state.show_floor;
    let render_edge_shadow = tile_layer_debug_state.show_edge_shadow;
    let render_ceiling_shadow = tile_layer_debug_state.show_ceiling_shadow;
    let render_fog_shadow = entity_mode && tile_layer_debug_state.show_fog_shadow;

    let half_tile = f32::from(crate::domain::visuals::TILE_SIZE_IN_PX) / 2.0;
    let mut non_empty_tile_count = 0usize;
    let mut rebuilt_keys = Vec::new();
    for (world_chunk, mut chunk_data, mut transform) in &mut chunk_query {
        let layer_render_enabled = match world_chunk.layer {
            TileLayer::Floor => render_floor,
            TileLayer::EdgeShadow => render_edge_shadow,
            TileLayer::CeilingShadow => render_ceiling_shadow,
            TileLayer::FogShadow => render_fog_shadow,
        };
        if !layer_render_enabled {
            continue;
        }

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
            TileLayer::Floor => {
                let key = (world_chunk.chunk_xy, world_chunk.world_z, TileLayer::Floor);
                if let Some(geom) = tile_cache.geometry.get(&key) {
                    floor_tile_data_from_geometry(geom, z_off, render_depth_stack)
                } else {
                    let topmost = topmost_cache_false.as_ref().expect("topmost_false needed");
                    let geom = build_floor_geometry(
                        world_chunk.chunk_xy,
                        world_chunk.world_z,
                        chunk_edge,
                        topmost,
                    );
                    let td = floor_tile_data_from_geometry(&geom, z_off, render_depth_stack);
                    tile_cache.geometry.insert(key, geom);
                    td
                }
            }
            TileLayer::EdgeShadow => {
                let key = (
                    world_chunk.chunk_xy,
                    world_chunk.world_z,
                    TileLayer::EdgeShadow,
                );
                if let Some(geom) = tile_cache.geometry.get(&key) {
                    shadow_tile_data_from_geometry(geom)
                } else {
                    let topmost = topmost_cache_true
                        .as_ref()
                        .or(topmost_cache_false.as_ref())
                        .expect("topmost needed for edge shadow");
                    let geom = build_edge_shadow_geometry(
                        world_chunk.chunk_xy,
                        world_chunk.world_z,
                        chunk_edge,
                        topmost,
                    );
                    let td = shadow_tile_data_from_geometry(&geom);
                    tile_cache.geometry.insert(key, geom);
                    td
                }
            }
            TileLayer::CeilingShadow => {
                let key = (
                    world_chunk.chunk_xy,
                    world_chunk.world_z,
                    TileLayer::CeilingShadow,
                );
                if let Some(geom) = tile_cache.geometry.get(&key) {
                    shadow_tile_data_from_geometry(geom)
                } else {
                    let topmost = topmost_cache_true
                        .as_ref()
                        .or(topmost_cache_false.as_ref())
                        .expect("topmost needed for ceiling shadow");
                    let geom = build_ceiling_shadow_geometry(
                        world_chunk.chunk_xy,
                        world_chunk.world_z,
                        chunk_edge,
                        render_blocks,
                        entity_mode,
                        topmost,
                    );
                    let td = shadow_tile_data_from_geometry(&geom);
                    tile_cache.geometry.insert(key, geom);
                    td
                }
            }
            TileLayer::FogShadow => {
                let fog_key = (world_chunk.chunk_xy, world_chunk.world_z);
                if let Some(fog_geom) = tile_cache.fog.get(&fog_key) {
                    fog_tile_data_from_cache(fog_geom)
                } else {
                    let topmost = topmost_cache_false.as_ref().expect("topmost_false needed");
                    let fog_geom = build_fog_geometry(
                        world_chunk.chunk_xy,
                        world_chunk.world_z,
                        chunk_edge,
                        topmost,
                        &fog_data,
                    );
                    let td = fog_tile_data_from_cache(&fog_geom);
                    tile_cache.fog.insert(fog_key, fog_geom);
                    td
                }
            }
        };
        non_empty_tile_count = non_empty_tile_count
            .saturating_add(tile_data.iter().filter(|tile| tile.is_some()).count());
        chunk_data.0 = tile_data;
        rebuilt_keys.push((world_chunk.chunk_xy, world_chunk.world_z, world_chunk.layer));
    }

    tilemap_render_metrics.chunk_count = to_rebuild.len();
    tilemap_render_metrics.non_empty_tile_count = non_empty_tile_count;

    // Cross-platform timing + slow-rebuild warning.
    #[cfg(not(target_arch = "wasm32"))]
    let elapsed_us = start.elapsed().as_micros();
    #[cfg(target_arch = "wasm32")]
    let elapsed_us = ((js_sys::Date::now() - start_ms) * 1000.0) as u128;

    tilemap_render_metrics.last_rebuild_micros = elapsed_us;
    tilemap_render_metrics.rebuild_count = tilemap_render_metrics.rebuild_count.saturating_add(1);
    if elapsed_us > 8_000 {
        warn!(
            "Tilemap rebuild slow: {}us across {} chunks ({} pending) and {} non-empty tiles",
            elapsed_us,
            tilemap_render_metrics.chunk_count,
            invalidation.pending_count(),
            tilemap_render_metrics.non_empty_tile_count,
        );
    }

    for (chunk_xy, z, layer) in rebuilt_keys {
        invalidation.remove(chunk_xy, z, layer);
    }
}

/// Maximum geometry entries to pre-build per frame when the system is idle.
/// Low budget so this doesn't compete with the active rebuild budget.
const PRE_BUILD_BUDGET: usize = 16;

/// When there is no pending dirty work, proactively populate the geometry cache for
/// z-levels adjacent to the current view. This makes R/V z-scrolling instant after
/// the first visit because subsequent view_z changes find cache hits and do zero
/// block lookups.
pub fn pre_build_adjacent_z_levels(
    invalidation: Res<crate::domain::tilemap_invalidation::TilemapInvalidation>,
    view_z: Res<ViewZLevel>,
    config: Res<TerrainConfig>,
    terrain: Res<TerrainData>,
    view_mode: Res<ViewMode>,
    tile_layer_debug_state: Res<TileLayerDebugState>,
    mut tile_cache: ResMut<TileDataCache>,
) {
    // Only pre-build when idle (nothing pending and no viewport changes).
    if !invalidation.is_empty() || invalidation.viewport_changed {
        return;
    }
    let chunk_edge = config.chunk_edge;
    if chunk_edge == 0 {
        return;
    }

    let entity_mode = *view_mode == ViewMode::Entity;
    let render_blocks: &std::collections::HashMap<_, _> = if entity_mode {
        &terrain.blocks
    } else {
        terrain.source_blocks.as_ref()
    };

    // Candidate z-levels the player might scroll to next (±1 and ±2).
    let upcoming = [
        view_z.current + 1,
        view_z.current - 1,
        view_z.current + 2,
        view_z.current - 2,
    ];

    let visible_chunks: Vec<IVec2> = invalidation.visible_chunks_xy.iter().copied().collect();
    if visible_chunks.is_empty() {
        return;
    }

    let geometry_layers = [
        TileLayer::Floor,
        TileLayer::EdgeShadow,
        TileLayer::CeilingShadow,
    ];
    let mut built = 0;

    'outer: for &z in &upcoming {
        // Check if any geometry cache misses exist for this z-level.
        let miss_chunks: Vec<IVec2> = visible_chunks
            .iter()
            .copied()
            .filter(|&c| {
                geometry_layers
                    .iter()
                    .any(|&l| !tile_cache.geometry.contains_key(&(c, z, l)))
            })
            .collect();

        if miss_chunks.is_empty() {
            continue;
        }

        // Build topmost cache for the miss chunks at this z.
        let topmost_false = build_topmost_cache(
            miss_chunks.iter().copied(),
            z,
            chunk_edge,
            render_blocks,
            false,
            config.z_levels_below_rendered,
        );
        let topmost_true = if entity_mode {
            build_topmost_cache(
                miss_chunks.iter().copied(),
                z,
                chunk_edge,
                render_blocks,
                true,
                config.z_levels_below_rendered,
            )
        } else {
            topmost_false.clone()
        };

        for &chunk_xy in &miss_chunks {
            if tile_layer_debug_state.show_floor
                && !tile_cache
                    .geometry
                    .contains_key(&(chunk_xy, z, TileLayer::Floor))
            {
                if built >= PRE_BUILD_BUDGET {
                    break 'outer;
                }
                let geom = build_floor_geometry(chunk_xy, z, chunk_edge, &topmost_false);
                tile_cache
                    .geometry
                    .insert((chunk_xy, z, TileLayer::Floor), geom);
                built += 1;
            }
            if tile_layer_debug_state.show_edge_shadow
                && !tile_cache
                    .geometry
                    .contains_key(&(chunk_xy, z, TileLayer::EdgeShadow))
            {
                if built >= PRE_BUILD_BUDGET {
                    break 'outer;
                }
                let geom = build_edge_shadow_geometry(chunk_xy, z, chunk_edge, &topmost_true);
                tile_cache
                    .geometry
                    .insert((chunk_xy, z, TileLayer::EdgeShadow), geom);
                built += 1;
            }
            if tile_layer_debug_state.show_ceiling_shadow
                && !tile_cache
                    .geometry
                    .contains_key(&(chunk_xy, z, TileLayer::CeilingShadow))
            {
                if built >= PRE_BUILD_BUDGET {
                    break 'outer;
                }
                let geom = build_ceiling_shadow_geometry(
                    chunk_xy,
                    z,
                    chunk_edge,
                    render_blocks,
                    entity_mode,
                    &topmost_true,
                );
                tile_cache
                    .geometry
                    .insert((chunk_xy, z, TileLayer::CeilingShadow), geom);
                built += 1;
            }
        }
    }
}
