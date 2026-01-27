use bevy::prelude::*;

use crate::resources::player_focus_state::PlayerFocusState;

#[derive(Component, Debug, Clone, Copy)]
pub enum MenuAction {
    CloseCurrentMenu,
    OpenOptions,
}

#[derive(Message, Debug, Clone, Copy)]
pub enum MenuEvent {
    CloseCurrentMenu,
    OpenOptionsMenu,
    ClearAllMenus,
}

pub fn menu_event_manager(
    mut commands: Commands,
    mut player_focus_state: ResMut<PlayerFocusState>,
    mut menu_events: MessageReader<MenuEvent>,
) {
    for event in menu_events.read() {
        match event {
            MenuEvent::CloseCurrentMenu => {
                if let Some(current) = player_focus_state.pop_current_menu() {
                    commands.entity(current).despawn();
                }
                if player_focus_state.menu_stack.is_empty() {
                    player_focus_state.within_system_menu = false;
                }
            }
            MenuEvent::OpenOptionsMenu => {
                let options_menu = super::options_menu::spawn_options_menu(&mut commands);
                player_focus_state.push_new_menu(options_menu);
                player_focus_state.within_system_menu = true;
            }
            MenuEvent::ClearAllMenus => {
                for entity in player_focus_state.menu_stack.drain(..) {
                    commands.entity(entity).despawn();
                }
                player_focus_state.within_system_menu = false;
                player_focus_state.typing = false;
            }
        }
    }
}
