use bevy::prelude::Resource;

/// Tracks the current z-level being viewed by the camera.
/// The camera is observer-only — it does not affect player position.
/// Controlled by R (increase) and V (decrease) keys.
#[derive(Resource, Debug, Clone, Copy)]
pub struct ViewZLevel {
    pub current: i32,
    pub initialized: bool,
}

impl Default for ViewZLevel {
    fn default() -> Self {
        Self {
            current: 0,
            initialized: false,
        }
    }
}
