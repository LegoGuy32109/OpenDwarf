//! Keymap profiles for Scenario direction / Shell lowering (browser Stage B).

use od_core::world::Dir;

/// Default profile id (ESDF movement).
pub const DEFAULT_KEYMAP_PROFILE: &str = "esdf";

/// Maps abstract directions (and later Shell actions) to DOM `code` strings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeymapProfile {
    pub id: &'static str,
    pub north: &'static str,
    pub south: &'static str,
    pub east: &'static str,
    pub west: &'static str,
    pub open_shell: &'static str,
    pub open_settings: &'static str,
    pub close_shell: &'static str,
}

impl KeymapProfile {
    #[must_use]
    pub fn code_for_dir(&self, dir: Dir) -> &'static str {
        match dir {
            Dir::N => self.north,
            Dir::S => self.south,
            Dir::E => self.east,
            Dir::W => self.west,
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
    open_settings: "KeyO", // placeholder chord start; Stage B may refine
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
