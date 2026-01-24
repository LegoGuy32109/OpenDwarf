use bevy::platform::collections::HashSet;
use bevy::prelude::*;

pub type Keys = HashSet<KeyCode>;

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
        self.movement_keys.clear();
        self.movement_keys.extend(self.move_up.iter().copied());
        self.movement_keys.extend(self.move_down.iter().copied());
        self.movement_keys.extend(self.move_left.iter().copied());
        self.movement_keys.extend(self.move_right.iter().copied());

        self.ui_confirm_keys.clear();
        self.ui_confirm_keys.extend(self.return_key.iter().copied());
        self.ui_confirm_keys
            .extend(self.preform_action.iter().copied());
    }

    pub fn just_pressed(&self, codes: &Keys) -> bool {
        !self.just_pressed_keys.is_disjoint(codes)
    }

    pub fn just_pressed_keys(&self) -> &HashSet<KeyCode> {
        &self.just_pressed_keys
    }
}

impl Default for InputState {
    fn default() -> Self {
        let mut state = Self {
            move_up: HashSet::from([KeyCode::KeyE]),
            move_down: HashSet::from([KeyCode::KeyD]),
            move_left: HashSet::from([KeyCode::KeyS]),
            move_right: HashSet::from([KeyCode::KeyF]),
            reach_up: HashSet::from([KeyCode::KeyI]),
            reach_down: HashSet::from([KeyCode::KeyK]),
            reach_left: HashSet::from([KeyCode::KeyJ]),
            reach_right: HashSet::from([KeyCode::KeyL]),
            exit_menu: HashSet::from([KeyCode::KeyQ, KeyCode::Escape]),
            return_key: HashSet::from([KeyCode::Enter]),
            debug_menu: HashSet::from([KeyCode::F1]),
            preform_action: HashSet::from([KeyCode::Space]),
            movement_keys: HashSet::new(),
            ui_confirm_keys: HashSet::new(),
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
