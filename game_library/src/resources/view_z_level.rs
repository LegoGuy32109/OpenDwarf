use bevy::prelude::Resource;

/// Tracks the current z-level being viewed by the camera.
/// The camera is observer-only — it does not affect player position.
/// Controlled by comma (decrease) and period (increase) keys.
#[derive(Resource, Default, Debug, Clone, Copy)]
pub struct ViewZLevel(pub i32);
