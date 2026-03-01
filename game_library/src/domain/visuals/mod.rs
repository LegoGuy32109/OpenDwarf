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

#[derive(Component)]
pub struct Player;

#[derive(Resource, Clone)]
pub struct TilemapAssets {
    pub tileset: Handle<Image>,
    pub tile_display_size: UVec2,
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

    // Load a sprite for the player; you must have an image at "assets/Dwarf.png"
    let dwarf_texture = asset_server.load("sprites/Dwarf.png");
    let dwarf_coordinates = MapCoordinates::new(IVec3::ZERO, uvec3(16, 16, 1));
    let dwarf_transform = Transform::default();

    commands.spawn((
        Sprite {
            image: dwarf_texture,
            custom_size: Some(Vec2::splat(TILE_SIZE_IN_PX.into())),
            flip_y: false,
            ..default()
        },
        dwarf_transform,
        Player,
        dwarf_coordinates,
    ));
}
