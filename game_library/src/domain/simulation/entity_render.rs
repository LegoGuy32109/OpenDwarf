use bevy::prelude::*;

use super::coords::{
    get_depth_tint_sprite_color, terrain_block_for_shadow, world_to_pixel_translation,
    world_to_pixel_translation_f32,
};
use super::{ChunkBorderDebugState, RenderEntityData, TerrainConfig, TerrainData};
use crate::domain::visuals::{Player, PlayerRenderTarget, TilemapAssets};
use crate::resources::view_mode::ViewMode;
use crate::resources::view_z_level::ViewZLevel;
use world_sim::bevy_app::PrimarySimulationEntityId;
use world_sim::world_api::{BlockType, Vec3i};

pub fn draw_entity_occupancy_boxes(
    chunk_border_debug_state: Res<ChunkBorderDebugState>,
    tilemap_assets: Res<TilemapAssets>,
    entity_data: Res<RenderEntityData>,
    mut gizmos: Gizmos,
) {
    if !chunk_border_debug_state.visible {
        return;
    }

    let tile_size = tilemap_assets.tile_display_size.x as f32;
    let occupancy_color = Color::srgba(1.0, 0.72, 0.16, 0.95);

    for entity in entity_data.entities.values() {
        let mut occupied_tiles = Vec::new();
        if let Some(movement) = entity.movement {
            if movement.progress_percent < 75 {
                occupied_tiles.push(movement.origin);
            }
            if movement.progress_percent >= 25 {
                occupied_tiles.push(movement.target);
            }
        } else {
            occupied_tiles.push(entity.position);
        }

        for world_position in occupied_tiles {
            gizmos.rect_2d(
                Isometry2d::from_translation(
                    world_to_pixel_translation(world_position, tile_size).truncate(),
                ),
                Vec2::splat(tile_size),
                occupancy_color,
            );
        }
    }
}

pub fn project_world_entities_to_sprites(
    terrain: Res<TerrainData>,
    config: Res<TerrainConfig>,
    mut entity_data: ResMut<RenderEntityData>,
    primary_entity_id: Res<PrimarySimulationEntityId>,
    view_mode: Res<ViewMode>,
    view_z: Res<ViewZLevel>,
    tilemap_assets: Res<TilemapAssets>,
    mut player_query: Query<(&mut Sprite, &mut Visibility, &mut PlayerRenderTarget), With<Player>>,
) {
    if !entity_data.dirty {
        return;
    }

    let Some(entity_id) = primary_entity_id.0 else {
        return;
    };

    let Some(player_world_position) = entity_data.entities.get(&entity_id).copied() else {
        return;
    };
    let entity_mode = *view_mode == ViewMode::Entity;
    let render_blocks = if entity_mode {
        &terrain.blocks
    } else {
        terrain.source_blocks.as_ref()
    };

    if let Ok((mut sprite, mut visibility, mut render_target)) = player_query.single_mut() {
        let tile_size = tilemap_assets.tile_display_size.x as f32;
        let render_world_position = if let Some(movement) = player_world_position.movement {
            let start = world_to_pixel_translation_f32(movement.start_position, tile_size);
            let end = world_to_pixel_translation(movement.target, tile_size);
            start.lerp(end, f32::from(movement.progress_percent) / 100.0)
        } else {
            world_to_pixel_translation(player_world_position.position, tile_size)
        };
        render_target.0 = render_world_position;
        sprite.flip_x = player_world_position.facing_left;
        let z_offset = player_world_position.position.z - view_z.current;
        sprite.color = get_depth_tint_sprite_color(z_offset);

        // Below the camera plane is bounded by the depth stack; above is unbounded
        // because the player is looking down through clear air.
        let in_z_range = z_offset >= -config.z_levels_below_rendered;
        let occluded = if z_offset != 0 {
            let (lo, hi) = if z_offset < 0 {
                // Entity below view: check column from entity+1 up to view_z (inclusive).
                (player_world_position.position.z + 1, view_z.current)
            } else {
                // Entity above view: check column from view_z+1 up to entity (inclusive).
                (view_z.current + 1, player_world_position.position.z)
            };
            (lo..=hi).any(|check_z| {
                terrain_block_for_shadow(
                    Vec3i::new(
                        player_world_position.position.x,
                        player_world_position.position.y,
                        check_z,
                    ),
                    render_blocks,
                    entity_mode,
                ) == BlockType::SolidStone
            })
        } else {
            false
        };

        if in_z_range && !occluded {
            *visibility = Visibility::Visible;
        } else {
            *visibility = Visibility::Hidden;
        }
    }

    entity_data.dirty = false;
}

pub fn smooth_player_render_transform(
    time: Res<Time>,
    mut player_query: Query<(&mut Transform, &PlayerRenderTarget), With<Player>>,
) {
    let Ok((mut transform, render_target)) = player_query.single_mut() else {
        return;
    };

    let target = render_target.0;
    let delta = time.delta_secs();
    let smoothing = 1.0 - (-10.0 * delta).exp();
    let distance = transform.translation.distance(target);

    if distance <= 0.01 || smoothing >= 0.999 {
        transform.translation = target;
        return;
    }

    transform.translation = transform.translation.lerp(target, smoothing);
}
