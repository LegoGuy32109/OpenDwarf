use bevy::prelude::*;
use bevy::sprite_render::{AlphaMode2d, TileData, TilemapChunk, TilemapChunkTileData};

use crate::components::map_coordinates::MapCoordinates;

pub mod chat_bubbles;
pub mod debug_menu;
pub mod rock_tiles;
pub mod ui;
pub mod visual_utils;

const TILE_SIZE_IN_PX: u16 = 64;

const TILE_MAP_PATH: &str = "sprites/StackedTextures.png";
// WARN: CANNOT BE A MULTIPLE OF 6
const NUM_TILES_IN_MAP: u16 = 31;

#[derive(Component)]
pub struct Player;

pub fn update_tileset_image(
    chunk_query: Single<&TilemapChunk>,
    mut events: MessageReader<AssetEvent<Image>>,
    mut images: ResMut<Assets<Image>>,
) {
    let tileset_image_handle = &chunk_query.tileset;
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

    let chunk_size = UVec2::splat(16);
    let tile_display_size = UVec2::splat(TILE_SIZE_IN_PX.into());

    // INFO: Determine data for tile map
    // let mut rng = ChaCha8Rng::seed_from_u64(42);
    // let tile_data: Vec<Option<TileData>> = (0..chunk_size.element_product())
    //     // range of stone variations
    //     .map(|_| rng.random_range(1..=6))
    //     .enumerate()
    //     .map(|(i, texture_index)| {
    //         if (i + 11) % 31 == 0 {
    //             return Some(TileData::from_tileset_index(13));
    //         } else if (i + 18) % 43 == 0 {
    //             return Some(TileData::from_tileset_index(14));
    //         } else if (i + 4) % 62 == 0 {
    //             return Some(TileData::from_tileset_index(11));
    //         } else if (i + 6) % 23 == 0 {
    //             return Some(TileData::from_tileset_index(16));
    //         }
    //         Some(TileData::from_tileset_index(texture_index))
    //     })
    //     .collect();

    let tile_data = vec![
        Some(TileData::from_tileset_index(2));
        usize::try_from(chunk_size.element_product())
            .expect("chunk tile count too large")
    ];

    let chunk_data = TilemapChunkTileData(tile_data);
    let chunk = TilemapChunk {
        chunk_size,
        tile_display_size,
        tileset: tile_textures,
        alpha_mode: AlphaMode2d::Opaque,
    };

    // Load a sprite for the player; you must have an image at "assets/Dwarf.png"
    let dwarf_texture = asset_server.load("sprites/Dwarf.png");
    let dwarf_coordinates = MapCoordinates::new(IVec3::ZERO, uvec3(chunk_size.x, chunk_size.y, 1));
    let dwarf_transform = chunk.calculate_tile_transform(dwarf_coordinates.as_uvec2());

    commands.spawn((chunk, chunk_data));
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
