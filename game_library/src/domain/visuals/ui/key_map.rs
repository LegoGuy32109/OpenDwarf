use bevy::prelude::*;

type Keys = Vec<KeyCode>;

#[derive(Resource, Debug)]
pub struct KeyMap {
    pub move_up: Keys,
    pub move_down: Keys,
    pub move_left: Keys,
    pub move_right: Keys,
    // pub reach_up: Keys,
    // pub reach_down: Keys,
    // pub reach_left: Keys,
    // pub reach_right: Keys,
    pub escape_menu: Keys,
    pub return_key: Keys,
    pub debug_menu: Keys,
    pub preform_action: Keys,
}

impl KeyMap {
    pub fn get_keys<'a>(keyboard_input: &'a Res<'a, ButtonInput<KeyCode>>) -> KeyMapChecker<'a> {
        KeyMapChecker { keyboard_input }
    }

    pub fn get_movement_keys(&self) -> Keys {
        vec![
            self.move_up.clone(),
            self.move_down.clone(),
            self.move_left.clone(),
            self.move_right.clone(),
        ]
        .concat()
    }

    pub fn get_ui_confirm_keys(&self) -> Keys {
        vec![self.return_key.clone(), self.preform_action.clone()].concat()
    }
}

impl Default for KeyMap {
    fn default() -> Self {
        Self {
            move_up: vec![KeyCode::KeyE],
            move_down: vec![KeyCode::KeyD],
            move_left: vec![KeyCode::KeyS],
            move_right: vec![KeyCode::KeyF],
            // reach_up: vec![KeyCode::KeyI],
            // reach_down: vec![KeyCode::KeyK],
            // reach_left: vec![KeyCode::KeyL],
            // reach_right: vec![KeyCode::KeyJ],
            escape_menu: vec![KeyCode::KeyQ, KeyCode::Escape],
            return_key: vec![KeyCode::Enter],
            debug_menu: vec![KeyCode::F1],
            preform_action: vec![KeyCode::Space],
        }
    }
}

pub struct KeyMapChecker<'a> {
    keyboard_input: &'a Res<'a, ButtonInput<KeyCode>>,
}

impl KeyMapChecker<'_> {
    pub fn just_pressed(&self, codes: &Keys) -> bool {
        self.keyboard_input
            .get_just_pressed()
            .into_iter()
            .any(|k| codes.contains(&k))
    }
}
