use bevy::prelude::*;

/// View mode for rendering: Master (god view) or Entity (observer perspective).
#[derive(Resource, Default, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ViewMode {
    /// Master mode: all tiles visible at current z-level, no FOV restrictions.
    /// Used for development and panoramic navigation.
    Master,
    /// Entity mode: observer-dependent visibility with FOV, three-state fog overlay.
    /// The player sees only what their entity can see or has previously seen.
    #[default]
    Entity,
}
