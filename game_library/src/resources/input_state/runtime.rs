use bevy::input::keyboard::KeyboardInput;
use bevy::prelude::*;

use crate::resources::game_mode::GameMode;

use super::state::InputState;

pub fn update_input_state(
    mut key_events: MessageReader<KeyboardInput>,
    mut input_state: ResMut<InputState>,
    game_mode: Res<State<GameMode>>,
) {
    input_state.apply_key_events(key_events.read().cloned(), *game_mode == GameMode::Typing);
}
