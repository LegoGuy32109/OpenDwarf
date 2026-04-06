use bevy::input::ButtonState;
use bevy::input::keyboard::{Key, KeyboardInput};
use bevy::math::CompassQuadrant;
use bevy::platform::collections::HashSet;
use bevy::prelude::*;

use crate::resources::game_mode::GameMode;

pub type Keys = HashSet<KeyCode>;

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash)]
pub enum InputCommand {
    ClearAllMenus,
    ChatOpen,
}

#[derive(Clone, Debug)]
struct CommandBinding {
    command: InputCommand,
    keys: Keys,
    require_ctrl: bool,
    require_shift: bool,
    require_alt: bool,
    require_typing: Option<bool>,
    suppress_char: Option<char>,
    suppress_keycodes: bool,
}

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
    pub chat_cancel: Keys,
    pub groups: InputStateGroups,
    command_bindings: Vec<CommandBinding>,
    just_pressed_keys: HashSet<KeyCode>,
    pressed_keys: HashSet<KeyCode>,
    key_events: Vec<KeyboardInput>,
    commands_triggered: HashSet<InputCommand>,
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

// useful const to set actions in a loop
const QUADRANTS: [CompassQuadrant; 4] = [
    CompassQuadrant::North,
    CompassQuadrant::East,
    CompassQuadrant::South,
    CompassQuadrant::West,
];

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

        for quadrant in QUADRANTS {
            let (movement, reach) = match quadrant {
                CompassQuadrant::North => (&self.move_up, &self.reach_up),
                CompassQuadrant::East => (&self.move_right, &self.reach_right),
                CompassQuadrant::South => (&self.move_down, &self.reach_down),
                CompassQuadrant::West => (&self.move_left, &self.reach_left),
            };
            let target = match quadrant {
                CompassQuadrant::North => &mut self.groups.system_up,
                CompassQuadrant::East => &mut self.groups.system_right,
                CompassQuadrant::South => &mut self.groups.system_down,
                CompassQuadrant::West => &mut self.groups.system_left,
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

    pub fn just_pressed_key(&self, key: KeyCode) -> bool {
        self.just_pressed_keys.contains(&key)
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

    pub fn command_triggered(&self, command: InputCommand) -> bool {
        self.commands_triggered.contains(&command)
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

    pub fn get_first_two_pressed(&self, codes: &Keys) -> (Option<KeyCode>, Option<KeyCode>) {
        let mut keys_pressed: Vec<KeyCode> = self
            .pressed_keys
            .iter()
            .filter(|key| codes.contains(*key))
            .copied()
            .collect();
        keys_pressed.sort();
        let mut maybe_keys = keys_pressed.into_iter();
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
            chat_cancel: HashSet::from([KeyCode::Escape]),
            groups: InputStateGroups::default(),
            command_bindings: vec![
                CommandBinding {
                    command: InputCommand::ClearAllMenus,
                    keys: HashSet::from([KeyCode::KeyQ]),
                    require_ctrl: true,
                    require_shift: false,
                    require_alt: false,
                    require_typing: None,
                    suppress_char: Some('q'),
                    suppress_keycodes: true,
                },
                CommandBinding {
                    command: InputCommand::ChatOpen,
                    keys: HashSet::from([KeyCode::KeyT]),
                    require_ctrl: false,
                    require_shift: false,
                    require_alt: false,
                    require_typing: Some(false),
                    suppress_char: Some('t'),
                    suppress_keycodes: true,
                },
            ],
            just_pressed_keys: HashSet::new(),
            pressed_keys: HashSet::new(),
            key_events: Vec::new(),
            commands_triggered: HashSet::new(),
        };
        state.refresh_groups();
        state
    }
}

pub fn update_input_state(
    mut key_events: MessageReader<KeyboardInput>,
    mut input_state: ResMut<InputState>,
    game_mode: Res<State<GameMode>>,
) {
    let bindings = input_state.command_bindings.clone();
    let prev_pressed = input_state.pressed_keys.clone();
    let mut next_pressed = prev_pressed.clone();
    let mut next_just_pressed = HashSet::new();
    let mut filtered_events = Vec::new();
    let mut commands_triggered = HashSet::new();
    let mut suppressed_keycodes = HashSet::new();
    let mut suppressed_chars = HashSet::new();

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

        let mut suppress_event = false;
        for binding in &bindings {
            if binding.matches(&event, &next_pressed, *game_mode == GameMode::Typing) {
                commands_triggered.insert(binding.command);
                if binding.suppress_keycodes {
                    suppressed_keycodes.extend(binding.keys.iter().copied());
                }
                if let Some(ch) = binding.suppress_char {
                    suppressed_chars.insert(ch.to_ascii_lowercase());
                }
                suppress_event = true;
            }
        }

        if suppress_event {
            continue;
        }

        filtered_events.push(event);
    }

    if !suppressed_keycodes.is_empty() {
        next_pressed.retain(|key| !suppressed_keycodes.contains(key));
        next_just_pressed.retain(|key| !suppressed_keycodes.contains(key));
    }
    if !suppressed_chars.is_empty() {
        filtered_events.retain(|event| {
            !matches!(
                &event.logical_key,
                Key::Character(value)
                    if value.chars().count() == 1
                        && value.chars().next().is_some_and(|ch| {
                            suppressed_chars.contains(&ch.to_ascii_lowercase())
                        })
            )
        });
    }

    input_state.commands_triggered = commands_triggered;
    input_state.just_pressed_keys = next_just_pressed;
    input_state.pressed_keys = next_pressed;
    input_state.key_events = filtered_events;
}

impl CommandBinding {
    fn matches(
        &self,
        event: &KeyboardInput,
        pressed_keys: &HashSet<KeyCode>,
        typing: bool,
    ) -> bool {
        if event.state != ButtonState::Pressed || event.repeat {
            return false;
        }
        if !self.keys.contains(&event.key_code) {
            return false;
        }
        if self.require_ctrl && !ctrl_pressed(pressed_keys) {
            return false;
        }
        if self.require_shift && !shift_pressed(pressed_keys) {
            return false;
        }
        if self.require_alt && !alt_pressed(pressed_keys) {
            return false;
        }
        if let Some(required_typing) = self.require_typing
            && typing != required_typing
        {
            return false;
        }
        true
    }
}

fn ctrl_pressed(pressed_keys: &HashSet<KeyCode>) -> bool {
    pressed_keys.contains(&KeyCode::ControlLeft) || pressed_keys.contains(&KeyCode::ControlRight)
}

fn shift_pressed(pressed_keys: &HashSet<KeyCode>) -> bool {
    pressed_keys.contains(&KeyCode::ShiftLeft) || pressed_keys.contains(&KeyCode::ShiftRight)
}

fn alt_pressed(pressed_keys: &HashSet<KeyCode>) -> bool {
    pressed_keys.contains(&KeyCode::AltLeft) || pressed_keys.contains(&KeyCode::AltRight)
}
