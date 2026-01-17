use bevy::prelude::*;

#[derive(Resource, Debug)]
pub struct KeyMap {
    pub move_up: Vec<KeyCode>,
    pub move_down: Vec<KeyCode>,
    pub move_left: Vec<KeyCode>,
    pub move_right: Vec<KeyCode>,
    // pub reach_up: Vec<KeyCode>,
    // pub reach_down: Vec<KeyCode>,
    // pub reach_left: Vec<KeyCode>,
    // pub reach_right: Vec<KeyCode>,
    pub escape_menu: Vec<KeyCode>,
    // pub return_key: Vec<KeyCode>,
    pub debug_menu: Vec<KeyCode>,
    // pub preform_action: Vec<KeyCode>,
}

impl KeyMap {
    pub fn get_keys<'a>(keyboard_input: &'a Res<'a, ButtonInput<KeyCode>>) -> KeyMapChecker<'a> {
        KeyMapChecker { keyboard_input }
    }

    pub fn get_movement_keys(&self) -> Vec<KeyCode> {
        vec![
            self.move_up.clone(),
            self.move_down.clone(),
            self.move_left.clone(),
            self.move_right.clone(),
        ]
        .concat()
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
            // return_key: vec![KeyCode::Enter],
            debug_menu: vec![KeyCode::F1],
            // preform_action: vec![KeyCode::Space],
        }
    }
}

pub struct KeyMapChecker<'a> {
    keyboard_input: &'a Res<'a, ButtonInput<KeyCode>>,
}

impl KeyMapChecker<'_> {
    pub fn just_pressed(&self, codes: &Vec<KeyCode>) -> bool {
        self.keyboard_input
            .get_just_pressed()
            .into_iter()
            .any(|k| codes.contains(&k))
    }
}
