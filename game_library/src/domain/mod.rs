use bevy::asset::AssetMetaCheck;
use bevy::prelude::*;
use bevy::render::RenderApp;
use bevy::render::batching::gpu_preprocessing::{GpuPreprocessingMode, GpuPreprocessingSupport};

pub mod messaging;
pub mod movement;
pub mod visuals;

use messaging::process_game_messages;
use movement::{consume_action, keyboard_movement};
use visuals::debug_menu::debug_menu;
use visuals::{setup, update_tileset_image};

pub struct OpenDwarfPlugins;

impl Plugin for OpenDwarfPlugins {
    fn build(&self, app: &mut App) {
        app.add_plugins(define_defaults())
            .add_systems(Startup, setup)
            .add_systems(Update, (update_tileset_image, consume_action))
            .add_systems(Update, process_game_messages)
            .add_systems(FixedUpdate, keyboard_movement)
            // debug systems
            .add_systems(Update, debug_menu)
            .sub_app_mut(RenderApp)
            .insert_resource(GpuPreprocessingSupport {
                max_supported_mode: GpuPreprocessingMode::None,
            });
    }
}

fn define_defaults() -> impl PluginGroup {
    DefaultPlugins
        .set(ImagePlugin::default_nearest())
        .set(WindowPlugin {
            primary_window: Some(Window {
                // fill entire browser window
                fit_canvas_to_parent: true,
                // don't hijack keyboard shortcuts
                prevent_default_event_handling: false,
                canvas: Some("#game-canvas".to_string()),
                ..default()
            }),
            ..default()
        })
        .set(AssetPlugin {
            // server won't check for meta files won't clog with 404s
            // if needed in future try AssetMetaCheck::Paths(...)
            meta_check: AssetMetaCheck::Never,
            ..default()
        })
}
