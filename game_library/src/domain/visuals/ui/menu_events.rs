use bevy::prelude::*;

use crate::resources::game_mode::GameMode;
use crate::resources::player_focus_state::PlayerFocusState;

#[derive(Component, Debug, Clone, Copy)]
pub enum MenuAction {
    CloseCurrentMenu,
    OpenOptions,
    OpenMultiplayer,
}

#[derive(Message, Debug, Clone, Copy)]
pub enum MenuEvent {
    CloseCurrentMenu,
    OpenOptionsMenu,
    OpenMultiplayerMenu,
    ClearAllMenus,
}

pub fn menu_event_manager(
    mut commands: Commands,
    mut player_focus_state: ResMut<PlayerFocusState>,
    mut next_state: ResMut<NextState<GameMode>>,
    mut menu_events: MessageReader<MenuEvent>,
) {
    for event in menu_events.read() {
        match event {
            MenuEvent::CloseCurrentMenu => {
                if let Some(current) = player_focus_state.pop_current_menu() {
                    commands.entity(current).despawn();
                }
                if player_focus_state.menu_stack.is_empty() {
                    next_state.set(GameMode::World);
                }
            }
            MenuEvent::OpenOptionsMenu => {
                let options_menu = super::options_menu::spawn_options_menu(&mut commands);
                player_focus_state.push_new_menu(options_menu);
                next_state.set(GameMode::InMenu);
            }
            MenuEvent::OpenMultiplayerMenu => {
                let multiplayer_menu =
                    super::multiplayer_menu::spawn_multiplayer_menu(&mut commands);
                player_focus_state.push_new_menu(multiplayer_menu);
                next_state.set(GameMode::InMenu);
            }
            MenuEvent::ClearAllMenus => {
                for entity in player_focus_state.menu_stack.drain(..) {
                    commands.entity(entity).despawn();
                }
                next_state.set(GameMode::World);
            }
        }
    }
}
