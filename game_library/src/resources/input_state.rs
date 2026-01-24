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
    pub groups: InputStateGroups,
    just_pressed_keys: HashSet<KeyCode>,
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
            groups: InputStateGroups::default(),
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
}
