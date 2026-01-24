use bevy::platform::collections::HashSet;
use bevy::prelude::*;

pub type Keys = Vec<KeyCode>;

#[derive(Resource, Debug)]
pub struct InputState {
    pub move_up: Keys,
    pub move_down: Keys,
    pub move_left: Keys,
    pub move_right: Keys,
    pub reach_up: Keys,
    pub reach_down: Keys,
    pub reach_left: Keys,
    pub reach_right: Keys,
    pub exit_menu: Keys,
    pub return_key: Keys,
    pub debug_menu: Keys,
    pub preform_action: Keys,
    pub movement_keys: Keys,
    pub ui_confirm_keys: Keys,
    just_pressed_keys: HashSet<KeyCode>,
}

impl InputState {
    pub fn refresh_groups(&mut self) {
        self.movement_keys = [
            self.move_up.clone(),
            self.move_down.clone(),
            self.move_left.clone(),
            self.move_right.clone(),
        ]
        .concat();
        self.ui_confirm_keys = [self.return_key.clone(), self.preform_action.clone()].concat();
    }

    pub fn just_pressed(&self, codes: &Keys) -> bool {
        self.just_pressed_keys.iter().any(|k| codes.contains(k))
    }

    pub fn just_pressed_keys(&self) -> &HashSet<KeyCode> {
        &self.just_pressed_keys
    }
}

impl Default for InputState {
    fn default() -> Self {
        let mut state = Self {
            move_up: vec![KeyCode::KeyE],
            move_down: vec![KeyCode::KeyD],
            move_left: vec![KeyCode::KeyS],
            move_right: vec![KeyCode::KeyF],
            reach_up: vec![KeyCode::KeyI],
            reach_down: vec![KeyCode::KeyK],
            reach_left: vec![KeyCode::KeyJ],
            reach_right: vec![KeyCode::KeyL],
            exit_menu: vec![KeyCode::KeyQ, KeyCode::Escape],
            return_key: vec![KeyCode::Enter],
            debug_menu: vec![KeyCode::F1],
            preform_action: vec![KeyCode::Space],
            movement_keys: Vec::new(),
            ui_confirm_keys: Vec::new(),
            just_pressed_keys: HashSet::new(),
        };
        state.refresh_groups();
        state
    }
}

pub fn update_input_state(
    keyboard_input: Res<ButtonInput<KeyCode>>,
    mut input_state: ResMut<InputState>,
) {
    input_state.just_pressed_keys = keyboard_input.get_just_pressed().copied().collect();
    input_state.refresh_groups();
}
