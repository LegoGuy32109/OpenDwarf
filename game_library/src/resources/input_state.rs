use bevy::input::ButtonState;
use bevy::input::keyboard::{Key, KeyboardInput};
use bevy::platform::collections::HashSet;
use bevy::prelude::*;

use crate::resources::player_focus_state::PlayerFocusState;

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
    pub clear_menu: Keys,
    pub chat_open: Keys,
    pub chat_cancel: Keys,
    pub clear_all_menus_command: bool,
    pub chat_open_command: bool,
    pub groups: InputStateGroups,
    just_pressed_keys: HashSet<KeyCode>,
    pressed_keys: HashSet<KeyCode>,
    key_events: Vec<KeyboardInput>,
}

#[derive(Debug, Default)]
pub struct InputStateGroups {
    pub movement: Keys,
    pub reach: Keys,
    pub ui_confirm: Keys,
    pub system_up: Keys,
    pub system_down: Keys,
    pub system_left: Keys,
    pub system_right: Keys,
}

#[derive(Copy, Clone)]
enum Dir {
    Up,
    Down,
    Left,
    Right,
}

impl Dir {
    const ALL: [Dir; 4] = [Dir::Up, Dir::Down, Dir::Left, Dir::Right];
}

impl InputState {
    fn rebuild_group(target: &mut Keys, sources: &[&Keys]) {
        target.clear();
        for source in sources {
            target.extend(source.iter().copied());
        }
    }

    /// Recomputes derived groups of [`InputState`].
    /// Call after bindings change
    pub fn refresh_groups(&mut self) {
        Self::rebuild_group(
            &mut self.groups.movement,
            &[
                &self.move_up,
                &self.move_down,
                &self.move_left,
                &self.move_right,
            ],
        );

        Self::rebuild_group(
            &mut self.groups.reach,
            &[
                &self.reach_up,
                &self.reach_down,
                &self.reach_left,
                &self.reach_right,
            ],
        );

        Self::rebuild_group(
            &mut self.groups.ui_confirm,
            &[&self.return_key, &self.preform_action],
        );

        for dir in Dir::ALL {
            let (movement, reach) = match dir {
                Dir::Up => (&self.move_up, &self.reach_up),
                Dir::Down => (&self.move_down, &self.reach_down),
                Dir::Left => (&self.move_left, &self.reach_left),
                Dir::Right => (&self.move_right, &self.reach_right),
            };
            let target = match dir {
                Dir::Up => &mut self.groups.system_up,
                Dir::Down => &mut self.groups.system_down,
                Dir::Left => &mut self.groups.system_left,
                Dir::Right => &mut self.groups.system_right,
            };
            Self::rebuild_group(target, &[movement, reach]);
        }
    }

    pub fn just_pressed(&self, codes: &Keys) -> bool {
        !self.just_pressed_keys.is_disjoint(codes)
    }

    pub fn pressed_key(&self, key: KeyCode) -> bool {
        self.pressed_keys.contains(&key)
    }

    pub fn shift_pressed(&self) -> bool {
        self.pressed_key(KeyCode::ShiftLeft) || self.pressed_key(KeyCode::ShiftRight)
    }

    pub fn ctrl_pressed(&self) -> bool {
        self.pressed_key(KeyCode::ControlLeft) || self.pressed_key(KeyCode::ControlRight)
    }

    pub fn key_events(&self) -> &[KeyboardInput] {
        &self.key_events
    }

    pub fn clear_all_menus_triggered(&self) -> bool {
        self.clear_all_menus_command
    }

    pub fn chat_open_triggered(&self) -> bool {
        self.chat_open_command
    }

    pub fn get_first_two_just_pressed(&self, codes: &Keys) -> (Option<KeyCode>, Option<KeyCode>) {
        let mut keys_just_pressed: Vec<KeyCode> = self
            .just_pressed_keys
            .iter()
            .filter(|key| codes.contains(*key))
            .copied()
            .collect();
        keys_just_pressed.sort();
        let mut maybe_keys = keys_just_pressed.into_iter();
        (maybe_keys.next(), maybe_keys.next())
    }

    pub fn movement_direction(&self, key: KeyCode) -> IVec3 {
        if self.move_up.contains(&key) {
            return ivec3(0, 1, 0);
        }
        if self.move_down.contains(&key) {
            return ivec3(0, -1, 0);
        }
        if self.move_left.contains(&key) {
            return ivec3(-1, 0, 0);
        }
        if self.move_right.contains(&key) {
            return ivec3(1, 0, 0);
        }
        IVec3::ZERO
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
            clear_menu: HashSet::from([KeyCode::KeyQ]),
            chat_open: HashSet::from([KeyCode::KeyT]),
            chat_cancel: HashSet::from([KeyCode::Escape]),
            clear_all_menus_command: false,
            chat_open_command: false,
            groups: InputStateGroups::default(),
            just_pressed_keys: HashSet::new(),
            pressed_keys: HashSet::new(),
            key_events: Vec::new(),
        };
        state.refresh_groups();
        state
    }
}

pub fn update_input_state(
    mut key_events: MessageReader<KeyboardInput>,
    mut input_state: ResMut<InputState>,
    player_focus_state: Res<PlayerFocusState>,
) {
    let clear_menu = input_state.clear_menu.clone();
    let chat_open = input_state.chat_open.clone();
    let prev_pressed = input_state.pressed_keys.clone();
    let mut next_pressed = prev_pressed.clone();
    let mut next_just_pressed = HashSet::new();
    let mut filtered_events = Vec::new();
    let mut clear_all_menus_command = false;
    let mut chat_open_command = false;

    for event in key_events.read().cloned() {
        match event.state {
            ButtonState::Pressed => {
                let was_pressed = next_pressed.contains(&event.key_code);
                next_pressed.insert(event.key_code);
                if !was_pressed && !event.repeat {
                    next_just_pressed.insert(event.key_code);
                }
            }
            ButtonState::Released => {
                next_pressed.remove(&event.key_code);
            }
        }

        let ctrl_pressed = next_pressed.contains(&KeyCode::ControlLeft)
            || next_pressed.contains(&KeyCode::ControlRight);
        let clear_menu_pressed = event.state == ButtonState::Pressed
            && clear_menu.contains(&event.key_code)
            && ctrl_pressed;

        if clear_menu_pressed {
            clear_all_menus_command = true;
            continue;
        }

        if clear_all_menus_command
            && matches!(
                &event.logical_key,
                Key::Character(value) if value.eq_ignore_ascii_case("q")
            )
        {
            continue;
        }

        if event.state == ButtonState::Pressed
            && chat_open.contains(&event.key_code)
            && matches!(
                &event.logical_key,
                Key::Character(value) if value.eq_ignore_ascii_case("t")
            )
            && !player_focus_state.typing
        {
            chat_open_command = true;
            continue;
        }

        filtered_events.push(event);
    }

    if clear_all_menus_command {
        next_pressed.retain(|key| !clear_menu.contains(key));
        next_just_pressed.retain(|key| !clear_menu.contains(key));
    }
    if chat_open_command {
        next_just_pressed.retain(|key| !chat_open.contains(key));
    }

    input_state.clear_all_menus_command = clear_all_menus_command;
    input_state.chat_open_command = chat_open_command;
    input_state.just_pressed_keys = next_just_pressed;
    input_state.pressed_keys = next_pressed;
    input_state.key_events = filtered_events;
}
