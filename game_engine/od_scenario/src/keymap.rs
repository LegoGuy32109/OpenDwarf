//! Keymap profiles for Scenario direction / Shell lowering (browser Stage B).

use od_core::world::Dir;

/// Default profile id (ESDF movement).
pub const DEFAULT_KEYMAP_PROFILE: &str = "esdf";

/// Maps abstract directions (and Shell actions) to DOM `code` strings / sequences.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeymapProfile {
    pub id: &'static str,
    pub north: &'static str,
    pub south: &'static str,
    pub east: &'static str,
    pub west: &'static str,
    pub open_shell: &'static str,
    /// After shell is open at root: FocusNext + Activate → Settings (matches UI).
    pub open_settings: &'static [&'static str],
    pub close_shell: &'static str,
}

impl KeymapProfile {
    #[must_use]
    pub fn codes_for_dir(&self, dir: Dir) -> Vec<&'static str> {
        match dir {
            Dir::N => vec![self.north],
            Dir::NE => vec![self.north, self.east],
            Dir::E => vec![self.east],
            Dir::SE => vec![self.south, self.east],
            Dir::S => vec![self.south],
            Dir::SW => vec![self.south, self.west],
            Dir::W => vec![self.west],
            Dir::NW => vec![self.north, self.west],
        }
    }
}

const ESDF: KeymapProfile = KeymapProfile {
    id: DEFAULT_KEYMAP_PROFILE,
    north: "KeyE",
    south: "KeyD",
    east: "KeyF",
    west: "KeyS",
    open_shell: "Escape",
    open_settings: &["KeyK", "Enter"],
    close_shell: "Escape",
};

/// Look up a named keymap profile.
#[must_use]
pub fn keymap_profile(id: &str) -> Option<&'static KeymapProfile> {
    match id {
        DEFAULT_KEYMAP_PROFILE | "default" => Some(&ESDF),
        _ => None,
    }
}
