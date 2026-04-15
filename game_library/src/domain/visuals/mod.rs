use bevy::prelude::*;

use crate::components::map_coordinates::MapCoordinates;

pub mod chat_bubbles;
pub mod debug_menu;
pub mod rock_tiles;
pub mod ui;
pub mod visual_utils;

pub const TILE_SIZE_IN_PX: u16 = 64;

const TILE_MAP_PATH: &str = "sprites/StackedTextures.png";
// WARN: CANNOT BE A MULTIPLE OF 6
const NUM_TILES_IN_MAP: u16 = 31;

const SHADOW_ATLAS_PATH: &str = "atlases/ShadowAtlas.png";
// WARN: CANNOT BE A MULTIPLE OF 6 (Bevy constraint for 2D array reinterpretation)
const SHADOW_ATLAS_FRAMES: u32 = 17;

#[derive(Component)]
pub struct Player;

#[derive(Component, Debug, Clone, Copy)]
pub struct PlayerRenderTarget(pub Vec3);

#[derive(Resource, Clone)]
pub struct TilemapAssets {
    pub tileset: Handle<Image>,
    pub tile_display_size: UVec2,
}

#[derive(Resource, Clone)]
pub struct ShadowAtlasAsset {
    pub atlas: Handle<Image>,
}

pub fn update_tileset_image(
    tilemap_assets: Res<TilemapAssets>,
    mut events: MessageReader<AssetEvent<Image>>,
    mut images: ResMut<Assets<Image>>,
) {
    let tileset_image_handle = &tilemap_assets.tileset;
    let image_asset_id = tileset_image_handle.id();
    for event in events.read() {
        if event.is_loaded_with_dependencies(image_asset_id) {
            let image = images.get_mut(tileset_image_handle).unwrap();
            let _ = image.reinterpret_stacked_2d_as_array(NUM_TILES_IN_MAP.into());
        }
    }
}

pub fn update_shadow_atlas_image(
    shadow_assets: Res<ShadowAtlasAsset>,
    mut events: MessageReader<AssetEvent<Image>>,
    mut images: ResMut<Assets<Image>>,
) {
    let shadow_atlas_handle = &shadow_assets.atlas;
    let image_asset_id = shadow_atlas_handle.id();
    for event in events.read() {
        if event.is_loaded_with_dependencies(image_asset_id) {
            let image = images.get_mut(shadow_atlas_handle).unwrap();
            let _ = image.reinterpret_stacked_2d_as_array(SHADOW_ATLAS_FRAMES);
        }
    }
}

pub fn setup(mut commands: Commands, asset_server: Res<AssetServer>) {
    // Camera
    commands.spawn((Camera2d, Camera::default()));

    // Load textures for tile map
    let tile_textures: Handle<Image> = asset_server.load(TILE_MAP_PATH);
    let tile_display_size = UVec2::splat(TILE_SIZE_IN_PX.into());
    commands.insert_resource(TilemapAssets {
        tileset: tile_textures,
        tile_display_size,
    });

    // Load shadow atlas for z-level depth visualization
    let shadow_atlas: Handle<Image> = asset_server.load(SHADOW_ATLAS_PATH);
    commands.insert_resource(ShadowAtlasAsset { atlas: shadow_atlas });

    // Load a sprite for the player; you must have an image at "assets/Dwarf.png"
    let dwarf_texture = asset_server.load("sprites/Dwarf.png");
    let dwarf_coordinates = MapCoordinates::new(IVec3::ZERO, uvec3(16, 16, 1));
    let dwarf_transform = Transform::from_translation(Vec3::new(
        f32::from(TILE_SIZE_IN_PX) * 0.5,
        f32::from(TILE_SIZE_IN_PX) * 0.5,
        1.0,
    ));

    commands.spawn((
        Sprite {
            image: dwarf_texture,
            custom_size: Some(Vec2::splat(TILE_SIZE_IN_PX.into())),
            flip_y: false,
            ..default()
        },
        dwarf_transform,
        Player,
        PlayerRenderTarget(dwarf_transform.translation),
        dwarf_coordinates,
    ));
}
