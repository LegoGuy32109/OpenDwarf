use bevy::asset::RenderAssetUsages;
use bevy::prelude::*;
use bevy::render::render_resource::{
    Extent3d, TextureDimension, TextureFormat, TextureViewDescriptor, TextureViewDimension,
};

pub mod chat_bubbles;
pub mod debug_menu;
pub mod rock_tiles;
pub mod ui;
pub mod visual_utils;

pub const TILE_SIZE_IN_PX: u16 = 64;

const TILE_MAP_PATH: &str = "sprites/StackedTextures.png";
// WARN: CANNOT BE A MULTIPLE OF 6
const NUM_TILES_IN_MAP: u16 = 31;

const EDGE_SHADOW_ATLAS_PATH: &str = "atlases/ShadowAtlas.png";
// WARN: CANNOT BE A MULTIPLE OF 6 (Bevy constraint for 2D array reinterpretation)
const EDGE_SHADOW_ATLAS_FRAMES: u32 = 15;

const CEILING_SHADOW_ATLAS_PATH: &str = "atlases/ObscureAtlas.png";
// 15 frames for 4-bit dual-grid ceiling shadow (masks 1-15), indexed by mask-1
// WARN: CANNOT BE A MULTIPLE OF 6
const CEILING_SHADOW_ATLAS_FRAMES: u32 = 15;

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
pub struct EdgeShadowAtlas {
    pub atlas: Handle<Image>,
}

#[derive(Resource, Clone)]
pub struct CeilingShadowAtlas {
    pub atlas: Handle<Image>,
}

#[derive(Resource, Clone)]
pub struct FogShadowAtlas {
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
            let image = images
                .get_mut(tileset_image_handle)
                .expect("tileset image handle should be valid");
            let _ = image.reinterpret_stacked_2d_as_array(NUM_TILES_IN_MAP.into());
        }
    }
}

pub fn update_edge_shadow_atlas_image(
    shadow_assets: Res<EdgeShadowAtlas>,
    mut events: MessageReader<AssetEvent<Image>>,
    mut images: ResMut<Assets<Image>>,
) {
    let shadow_atlas_handle = &shadow_assets.atlas;
    let image_asset_id = shadow_atlas_handle.id();
    for event in events.read() {
        if event.is_loaded_with_dependencies(image_asset_id) {
            let image = images
                .get_mut(shadow_atlas_handle)
                .expect("shadow atlas image handle should be valid");
            let _ = image.reinterpret_stacked_2d_as_array(EDGE_SHADOW_ATLAS_FRAMES);
        }
    }
}

pub fn update_ceiling_shadow_atlas_image(
    obscure_assets: Res<CeilingShadowAtlas>,
    mut events: MessageReader<AssetEvent<Image>>,
    mut images: ResMut<Assets<Image>>,
) {
    let obscure_atlas_handle = &obscure_assets.atlas;
    let image_asset_id = obscure_atlas_handle.id();
    for event in events.read() {
        if event.is_loaded_with_dependencies(image_asset_id) {
            let image = images
                .get_mut(obscure_atlas_handle)
                .expect("obscure atlas image handle should be valid");
            let _ = image.reinterpret_stacked_2d_as_array(CEILING_SHADOW_ATLAS_FRAMES);
        }
    }
}

pub fn setup(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    mut images: ResMut<Assets<Image>>,
) {
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
    let shadow_atlas: Handle<Image> = asset_server.load(EDGE_SHADOW_ATLAS_PATH);
    commands.insert_resource(EdgeShadowAtlas {
        atlas: shadow_atlas,
    });

    // Load obscure atlas for ceiling occlusion shadows (dual-grid, 15 frames)
    let obscure_atlas: Handle<Image> = asset_server.load(CEILING_SHADOW_ATLAS_PATH);
    commands.insert_resource(CeilingShadowAtlas {
        atlas: obscure_atlas,
    });

    // Create a programmatic white atlas for fog shadow tinting.
    // 7 identical white frames (not a multiple of 6 — Bevy constraint).
    // depth_or_array_layers is set directly so Bevy treats this as a D2Array
    // texture from the start; texture_view_descriptor forces a D2Array view.
    const FOG_ATLAS_FRAMES: u32 = 7;
    let mut fog_image = Image::new(
        Extent3d {
            width: 64,
            height: 64,
            depth_or_array_layers: FOG_ATLAS_FRAMES,
        },
        TextureDimension::D2,
        vec![255u8; 64 * 64 * 4 * FOG_ATLAS_FRAMES as usize],
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::RENDER_WORLD,
    );
    fog_image.texture_view_descriptor = Some(TextureViewDescriptor {
        dimension: Some(TextureViewDimension::D2Array),
        ..default()
    });
    let fog_atlas_handle = images.add(fog_image);
    commands.insert_resource(FogShadowAtlas {
        atlas: fog_atlas_handle,
    });

    // Load a sprite for the player; you must have an image at "assets/Dwarf.png"
    let dwarf_texture = asset_server.load("sprites/Dwarf.png");
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
    ));
}
