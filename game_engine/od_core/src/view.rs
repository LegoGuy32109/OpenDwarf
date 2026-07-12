//! Local, client-owned world view state.

use serde::{Deserialize, Serialize};

use crate::world::Vec3i;

/// Discrete zoom levels shared with the legacy `/webgl` camera.
pub const WORLD_ZOOM_LEVELS: [f32; 6] = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0];

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldCamera {
    pub x: f32,
    pub y: f32,
    pub zoom: f32,
}

impl Default for WorldCamera {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            zoom: 1.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldLookOffset {
    pub x: f32,
    pub y: f32,
}

impl Default for WorldLookOffset {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0 }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorldViewMode {
    Entity,
    Master,
}

impl WorldViewMode {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Entity => "entity",
            Self::Master => "master",
        }
    }

    #[must_use]
    pub const fn as_abi_f32(self) -> f32 {
        match self {
            Self::Entity => 0.0,
            Self::Master => 1.0,
        }
    }
}

/// Local world inspection state. This is intentionally outside [`WorldSnapshot`]:
/// it is not replay-authoritative sim state, but it is the source of truth for
/// camera, z-slice, zoom, HUD counters, and future world draw view globals.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalWorldView {
    pub camera: WorldCamera,
    pub view_z: i32,
    pub view_mode: WorldViewMode,
    pub look_offset: WorldLookOffset,
    pub fps: f32,
    pub tps: f32,
    pub visible_chunks: Vec<Vec3i>,
    pub streaming_chunks: Vec<Vec3i>,
}

impl Default for LocalWorldView {
    fn default() -> Self {
        Self {
            camera: WorldCamera::default(),
            view_z: 0,
            view_mode: WorldViewMode::Entity,
            look_offset: WorldLookOffset::default(),
            fps: 0.0,
            tps: 0.0,
            visible_chunks: Vec::new(),
            streaming_chunks: Vec::new(),
        }
    }
}

impl LocalWorldView {
    #[must_use]
    pub fn zoom_index(&self) -> usize {
        WORLD_ZOOM_LEVELS
            .iter()
            .enumerate()
            .min_by(|(_, a), (_, b)| {
                let da = (*a - self.camera.zoom).abs();
                let db = (*b - self.camera.zoom).abs();
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            })
            .map_or(3, |(index, _)| index)
    }

    pub fn step_zoom(&mut self, direction: i32) {
        let index = self.zoom_index();
        let next = if direction < 0 {
            index.saturating_sub(1)
        } else if direction > 0 {
            (index + 1).min(WORLD_ZOOM_LEVELS.len() - 1)
        } else {
            index
        };
        self.camera.zoom = WORLD_ZOOM_LEVELS[next];
    }
}
