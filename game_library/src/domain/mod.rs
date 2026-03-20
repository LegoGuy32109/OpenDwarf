use bevy::asset::AssetMetaCheck;
use bevy::prelude::*;
use bevy::render::RenderApp;
use bevy::render::batching::gpu_preprocessing::{GpuPreprocessingMode, GpuPreprocessingSupport};

use crate::resources::input_state::{InputState, update_input_state};
use crate::resources::player_focus_state::PlayerFocusState;

pub mod messaging;
pub mod simulation;
pub mod visuals;

use crate::domain::messaging::webrtc::MultiplayerController;
#[cfg(not(target_arch = "wasm32"))]
use simulation::drive_replay_playback;
use simulation::{
    draw_chunk_borders, follow_player_camera, project_world_entities_to_sprites,
    project_world_to_tilemap, queue_world_commands_from_input, setup_simulation_state,
    smooth_player_render_transform, stream_chunks_around_player, sync_render_world_from_snapshot,
    toggle_chunk_borders,
};
use visuals::chat_bubbles::ChatBubblePlugin;
use visuals::debug_menu::{debug_menu, replay_debug_overlay};
use visuals::ui::chat_menu::ChatMenuPlugin;
use visuals::ui::escape_menu::handle_escape_menu;
use visuals::ui::menu_events::{MenuEvent, menu_event_manager};
#[cfg(not(target_arch = "wasm32"))]
use visuals::ui::multiplayer_menu::drive_native_webrtc;
use visuals::ui::multiplayer_menu::{
    handle_multiplayer_menu, scan_multiplayer_clipboard_on_focus, tick_multiplayer_clipboard_scan,
};
use visuals::ui::options_menu::handle_options_menu;
use visuals::{setup, update_tileset_image};
use world_sim::bevy_app::{WorldSimSettings, WorldSimulationPlugin};
use world_sim::world_api::Vec3u;
use world_sim::world_core::WorldConfig;

pub struct OpenDwarfPlugins;

impl Plugin for OpenDwarfPlugins {
    fn build(&self, app: &mut App) {
        app.add_plugins(define_defaults())
            .insert_resource(bevy::time::Time::<bevy::time::Fixed>::from_hz(20.0))
            .add_plugins(WorldSimulationPlugin {
                settings: WorldSimSettings {
                    config: WorldConfig {
                        world_chunks: Vec3u::new(16, 16, 1),
                        ..WorldConfig::default()
                    },
                    spawn_default_player: true,
                },
            })
            .add_systems(Startup, setup_simulation_state)
            .add_systems(Startup, setup)
            .add_systems(PreUpdate, update_input_state)
            .add_systems(Update, update_tileset_image)
            .add_systems(
                Update,
                (
                    toggle_chunk_borders,
                    queue_world_commands_from_input,
                    sync_render_world_from_snapshot,
                    stream_chunks_around_player,
                    project_world_to_tilemap,
                    draw_chunk_borders,
                    project_world_entities_to_sprites,
                    smooth_player_render_transform,
                    follow_player_camera,
                )
                    .chain(),
            )
            .add_systems(
                Update,
                (
                    handle_escape_menu,
                    handle_options_menu,
                    handle_multiplayer_menu,
                    menu_event_manager,
                    tick_multiplayer_clipboard_scan,
                    scan_multiplayer_clipboard_on_focus,
                    ApplyDeferred,
                ),
            )
            .add_plugins(ChatMenuPlugin)
            .add_plugins(ChatBubblePlugin)
            .add_message::<MenuEvent>()
            .init_resource::<InputState>()
            .init_resource::<PlayerFocusState>()
            .insert_non_send_resource(MultiplayerController::default())
            // debug systems
            .add_systems(Update, (debug_menu, replay_debug_overlay))
            .sub_app_mut(RenderApp)
            .insert_resource(GpuPreprocessingSupport {
                max_supported_mode: GpuPreprocessingMode::None,
            });

        #[cfg(not(target_arch = "wasm32"))]
        {
            app.add_systems(Update, (drive_native_webrtc, drive_replay_playback));
        }
    }
}

fn define_defaults() -> impl PluginGroup {
    DefaultPlugins
        .set(ImagePlugin::default_nearest())
        .set(WindowPlugin {
            primary_window: Some(Window {
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
