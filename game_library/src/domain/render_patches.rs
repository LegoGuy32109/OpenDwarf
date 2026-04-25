use bevy::prelude::*;
use bevy::sprite_render::{TileData, TilemapChunk, TilemapChunkTileData};
use std::collections::{HashMap, HashSet};
use world_runtime::{ChunkKey, LayerId};

use crate::domain::runtime_cache::{ChunkLayerCacheMap, ChunkLayerKey, RuntimeViewportIntentState};
use crate::domain::simulation::{TerrainConfig, TileLayer, TileLayerDebugState, WorldTileChunk};
use crate::domain::visuals::{
    CeilingShadowAtlas, EdgeShadowAtlas, FogShadowAtlas, TILE_SIZE_IN_PX, TilemapAssets,
};
use crate::resources::view_z_level::ViewZLevel;

const Z_LEVELS_BELOW_RENDERED: i32 = 5;
const REMEMBERED_FOG_RGBA: [f32; 4] = [0.7, 0.7, 0.2, 0.05];
const GLOBAL_MEMORY_OVERLAY_SPRITE_Z: f32 = 2.0;

#[derive(Resource, Debug, Clone, Copy, Default)]
pub struct CutoverFlag {
    pub enabled: bool,
}

#[derive(Resource, Default)]
pub struct ChunkLayerRenderEntities {
    pub entities: HashMap<ChunkLayerKey, Entity>,
}

#[derive(Component)]
pub struct RuntimeRenderedChunk;

pub fn toggle_runtime_cutover(input: Res<ButtonInput<KeyCode>>, mut flag: ResMut<CutoverFlag>) {
    if input.just_pressed(KeyCode::F9) {
        flag.enabled = !flag.enabled;
        info!(
            "Runtime patch renderer {}",
            if flag.enabled { "enabled" } else { "hidden" }
        );
    }
}

pub fn runtime_cutover_disabled(flag: Res<CutoverFlag>) -> bool {
    !flag.enabled
}

pub fn despawn_legacy_tile_chunks_on_cutover(
    cutover: Res<CutoverFlag>,
    mut commands: Commands,
    legacy_chunks: Query<Entity, (With<WorldTileChunk>, Without<RuntimeRenderedChunk>)>,
) {
    if !cutover.enabled || !cutover.is_changed() {
        return;
    }
    for entity in &legacy_chunks {
        commands.entity(entity).despawn();
    }
}

pub fn apply_runtime_chunk_patches(
    mut commands: Commands,
    cutover: Res<CutoverFlag>,
    viewport_state: Res<RuntimeViewportIntentState>,
    view_z: Res<ViewZLevel>,
    tile_layer_debug_state: Res<TileLayerDebugState>,
    tilemap_assets: Res<TilemapAssets>,
    edge_atlas: Res<EdgeShadowAtlas>,
    ceiling_atlas: Res<CeilingShadowAtlas>,
    fog_atlas: Res<FogShadowAtlas>,
    config: Res<TerrainConfig>,
    mut chunk_layer_cache: ResMut<ChunkLayerCacheMap>,
    mut render_entities: ResMut<ChunkLayerRenderEntities>,
    mut chunk_query: Query<
        (
            Entity,
            &WorldTileChunk,
            &mut TilemapChunkTileData,
            &mut Transform,
            &mut Visibility,
        ),
        With<RuntimeRenderedChunk>,
    >,
) {
    let Some(viewport) = viewport_state.current else {
        return;
    };

    let chunk_edge = config.chunk_edge.max(1);
    let rendered_z_levels =
        rendered_z_levels(view_z.current, tile_layer_debug_state.show_depth_stack);
    let active_layers = active_layers(&tile_layer_debug_state);
    let active_runtime_keys =
        active_runtime_keys(&viewport, chunk_edge, &rendered_z_levels, &active_layers);
    let desired_visibility = if cutover.enabled {
        Visibility::Visible
    } else {
        Visibility::Hidden
    };

    for (entity, world_chunk, _, _, _) in &mut chunk_query {
        let key = ChunkLayerKey::new(
            ChunkKey::new(
                world_chunk.chunk_xy.x,
                world_chunk.chunk_xy.y,
                world_chunk.world_z,
            ),
            layer_to_runtime(world_chunk.layer),
        );
        if !active_runtime_keys.contains(&key) {
            commands.entity(entity).despawn();
            render_entities.entities.remove(&key);
        }
    }

    let mut existing: HashMap<ChunkLayerKey, Entity> = chunk_query
        .iter()
        .map(|(entity, world_chunk, _, _, _)| {
            (
                ChunkLayerKey::new(
                    ChunkKey::new(
                        world_chunk.chunk_xy.x,
                        world_chunk.chunk_xy.y,
                        world_chunk.world_z,
                    ),
                    layer_to_runtime(world_chunk.layer),
                ),
                entity,
            )
        })
        .collect();

    for (key, entry) in chunk_layer_cache.entries_mut() {
        if !active_runtime_keys.contains(key) {
            continue;
        }
        if !entry.dirty && !cutover.is_changed() {
            continue;
        }

        let Ok((tile_indices, _)) = bincode::serde::decode_from_slice::<Vec<Option<u16>>, _>(
            &entry.payload,
            bincode::config::standard(),
        ) else {
            warn!(
                "Failed to decode runtime tile payload for chunk {:?} layer {:?}",
                key.chunk, key.layer
            );
            entry.dirty = false;
            continue;
        };

        let layer = runtime_to_layer(key.layer);
        let tile_data = tile_indices_to_tile_data(
            tile_indices,
            layer,
            key.chunk.z - view_z.current,
            tile_layer_debug_state.show_depth_stack,
        );
        let transform = chunk_transform(
            key.chunk,
            layer,
            tilemap_assets.tile_display_size.x,
            view_z.current,
        );

        if let Some(entity) = existing
            .get(&key)
            .copied()
            .or_else(|| render_entities.entities.get(key).copied())
        {
            if let Ok((_, _, mut chunk_data, mut existing_transform, mut visibility)) =
                chunk_query.get_mut(entity)
            {
                chunk_data.0 = tile_data;
                *existing_transform = transform;
                *visibility = desired_visibility;
            }
        } else {
            let entity = spawn_runtime_chunk(
                &mut commands,
                key,
                layer,
                tile_data,
                transform,
                desired_visibility,
                tilemap_assets.as_ref(),
                edge_atlas.as_ref(),
                ceiling_atlas.as_ref(),
                fog_atlas.as_ref(),
                chunk_edge,
            );
            existing.insert(key.clone(), entity);
            render_entities.entities.insert(key.clone(), entity);
        }

        entry.materialized = true;
        entry.dirty = false;
    }
}

fn active_layers(tile_layer_debug_state: &TileLayerDebugState) -> Vec<LayerId> {
    let mut layers = Vec::new();
    if tile_layer_debug_state.show_floor {
        layers.push(LayerId::Floor);
    }
    if tile_layer_debug_state.show_edge_shadow {
        layers.push(LayerId::EdgeShadow);
    }
    if tile_layer_debug_state.show_ceiling_shadow {
        layers.push(LayerId::CeilingShadow);
    }
    if tile_layer_debug_state.show_fog_shadow {
        layers.push(LayerId::Fog);
    }
    layers
}

fn rendered_z_levels(current_z: i32, depth_stack: bool) -> HashSet<i32> {
    if depth_stack {
        (0..=Z_LEVELS_BELOW_RENDERED)
            .map(|offset| current_z - offset)
            .collect()
    } else {
        HashSet::from([current_z])
    }
}

fn active_runtime_keys(
    viewport: &world_runtime::ViewportIntent,
    chunk_edge: u32,
    rendered_z_levels: &HashSet<i32>,
    active_layers: &[LayerId],
) -> HashSet<ChunkLayerKey> {
    let mut keys = HashSet::new();
    let edge = i32::try_from(chunk_edge.max(1)).expect("chunk edge should fit in i32");
    let half = edge / 2;
    let min_x = (viewport.desired_bounds_min.x + half).div_euclid(edge);
    let max_x = (viewport.desired_bounds_max.x + half).div_euclid(edge);
    let min_y = (viewport.desired_bounds_min.y + half).div_euclid(edge);
    let max_y = (viewport.desired_bounds_max.y + half).div_euclid(edge);
    for &world_z in rendered_z_levels {
        for x in min_x..=max_x {
            for y in min_y..=max_y {
                for &layer in active_layers {
                    if layer == LayerId::CeilingShadow && world_z != viewport.camera_center.z {
                        continue;
                    }
                    keys.insert(ChunkLayerKey::new(ChunkKey::new(x, y, world_z), layer));
                }
            }
        }
    }
    keys
}

fn runtime_to_layer(layer: LayerId) -> TileLayer {
    match layer {
        LayerId::Floor => TileLayer::Floor,
        LayerId::EdgeShadow => TileLayer::EdgeShadow,
        LayerId::CeilingShadow => TileLayer::CeilingShadow,
        LayerId::Fog => TileLayer::FogShadow,
    }
}

fn layer_to_runtime(layer: TileLayer) -> LayerId {
    match layer {
        TileLayer::Floor => LayerId::Floor,
        TileLayer::EdgeShadow => LayerId::EdgeShadow,
        TileLayer::CeilingShadow => LayerId::CeilingShadow,
        TileLayer::FogShadow => LayerId::Fog,
    }
}

fn tile_indices_to_tile_data(
    tile_indices: Vec<Option<u16>>,
    layer: TileLayer,
    z_offset: i32,
    depth_stack: bool,
) -> Vec<Option<TileData>> {
    tile_indices
        .into_iter()
        .map(|index| {
            index.map(|tileset_index| {
                let mut tile = TileData::from_tileset_index(tileset_index);
                match layer {
                    TileLayer::Floor if depth_stack => {
                        tile.color = depth_tint_color(z_offset);
                    }
                    TileLayer::FogShadow => {
                        tile.color = Color::srgba(
                            REMEMBERED_FOG_RGBA[0],
                            REMEMBERED_FOG_RGBA[1],
                            REMEMBERED_FOG_RGBA[2],
                            REMEMBERED_FOG_RGBA[3],
                        );
                    }
                    _ => {}
                }
                tile
            })
        })
        .collect()
}

fn spawn_runtime_chunk(
    commands: &mut Commands,
    key: &ChunkLayerKey,
    layer: TileLayer,
    tile_data: Vec<Option<TileData>>,
    transform: Transform,
    visibility: Visibility,
    tilemap_assets: &TilemapAssets,
    edge_atlas: &EdgeShadowAtlas,
    ceiling_atlas: &CeilingShadowAtlas,
    fog_atlas: &FogShadowAtlas,
    chunk_edge: u32,
) -> Entity {
    let (tileset, tile_display_size, alpha_mode) = match layer {
        TileLayer::Floor => (
            tilemap_assets.tileset.clone(),
            tilemap_assets.tile_display_size,
            bevy::sprite_render::AlphaMode2d::Opaque,
        ),
        TileLayer::EdgeShadow => (
            edge_atlas.atlas.clone(),
            UVec2::splat(64),
            bevy::sprite_render::AlphaMode2d::Blend,
        ),
        TileLayer::CeilingShadow => (
            ceiling_atlas.atlas.clone(),
            UVec2::splat(64),
            bevy::sprite_render::AlphaMode2d::Blend,
        ),
        TileLayer::FogShadow => (
            fog_atlas.atlas.clone(),
            UVec2::splat(64),
            bevy::sprite_render::AlphaMode2d::Blend,
        ),
    };

    commands
        .spawn((
            RuntimeRenderedChunk,
            WorldTileChunk {
                chunk_xy: IVec2::new(key.chunk.x, key.chunk.y),
                world_z: key.chunk.z,
                layer,
            },
            TilemapChunk {
                chunk_size: UVec2::splat(chunk_edge),
                tile_display_size,
                tileset,
                alpha_mode,
            },
            TilemapChunkTileData(tile_data),
            transform,
            GlobalTransform::default(),
            visibility,
            InheritedVisibility::default(),
            ViewVisibility::default(),
        ))
        .id()
}

fn chunk_transform(
    chunk: ChunkKey,
    layer: TileLayer,
    chunk_edge: u32,
    current_z: i32,
) -> Transform {
    let sprite_z = calculate_sprite_z(chunk.z - current_z, layer);
    let mut translation =
        chunk_world_translation_xy(IVec2::new(chunk.x, chunk.y), chunk_edge, sprite_z);
    if matches!(layer, TileLayer::EdgeShadow | TileLayer::CeilingShadow) {
        let half_tile = f32::from(TILE_SIZE_IN_PX) / 2.0;
        translation += Vec3::new(half_tile, half_tile, 0.0);
    }
    Transform::from_translation(translation)
}

fn calculate_sprite_z(z_offset: i32, layer: TileLayer) -> f32 {
    let base = (z_offset.clamp(-5, 0) * 2) as f32;
    match layer {
        TileLayer::Floor => base,
        TileLayer::EdgeShadow => base + 0.5,
        TileLayer::CeilingShadow => base + 0.75,
        TileLayer::FogShadow => GLOBAL_MEMORY_OVERLAY_SPRITE_Z,
    }
}

fn chunk_world_translation_xy(chunk_xy: IVec2, chunk_edge: u32, sprite_z: f32) -> Vec3 {
    let edge = chunk_edge as f32;
    let tile_size = f32::from(TILE_SIZE_IN_PX);
    Vec3::new(
        (chunk_xy.x as f32) * edge * tile_size,
        (chunk_xy.y as f32) * edge * tile_size,
        sprite_z,
    )
}

fn depth_tint_color(z_offset: i32) -> Color {
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
