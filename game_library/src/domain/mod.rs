use bevy::asset::AssetMetaCheck;
use bevy::prelude::*;
use bevy::render::RenderApp;
use bevy::render::batching::gpu_preprocessing::{GpuPreprocessingMode, GpuPreprocessingSupport};

use crate::resources::input_state::{InputState, update_input_state};
use crate::resources::player_focus_state::PlayerFocusState;

pub mod messaging;
pub mod movement;
pub mod visuals;

use crate::domain::messaging::webrtc::MultiplayerController;
use movement::{consume_action, keyboard_movement};
use visuals::chat_bubbles::ChatBubblePlugin;
use visuals::debug_menu::debug_menu;
use visuals::ui::chat_menu::ChatMenuPlugin;
use visuals::ui::escape_menu::handle_escape_menu;
use visuals::ui::menu_events::{MenuEvent, menu_event_manager};
#[cfg(not(target_arch = "wasm32"))]
use visuals::ui::multiplayer_menu::drive_native_webrtc;
use visuals::ui::multiplayer_menu::handle_multiplayer_menu;
use visuals::ui::options_menu::handle_options_menu;
use visuals::{setup, update_tileset_image};

pub struct OpenDwarfPlugins;

impl Plugin for OpenDwarfPlugins {
    fn build(&self, app: &mut App) {
        app.add_plugins(define_defaults())
            .add_systems(Startup, setup)
            .add_systems(PreUpdate, update_input_state)
            .add_systems(Update, (update_tileset_image, consume_action))
            .add_systems(Update, keyboard_movement)
            .add_systems(
                Update,
                (
                    handle_escape_menu,
                    handle_options_menu,
                    handle_multiplayer_menu,
                    menu_event_manager,
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
            .add_systems(Update, debug_menu)
            .sub_app_mut(RenderApp)
            .insert_resource(GpuPreprocessingSupport {
                max_supported_mode: GpuPreprocessingMode::None,
            });

        #[cfg(not(target_arch = "wasm32"))]
        {
            app.add_systems(Update, drive_native_webrtc);
        }
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
