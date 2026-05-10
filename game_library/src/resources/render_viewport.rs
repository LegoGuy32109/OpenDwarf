use std::collections::HashSet;

use bevy::prelude::*;

use crate::domain::simulation::{TerrainConfig, TileLayerDebugState};
use crate::domain::visuals::TILE_SIZE_IN_PX;
use crate::resources::view_mode::ViewMode;
use crate::resources::view_z_level::ViewZLevel;

const VIEWPORT_PADDING_CHUNKS: i32 = 1;

#[derive(Resource, Default, Clone)]
pub struct RenderViewport {
    pub visible_chunks_xy: HashSet<IVec2>,
    pub visible_z_levels: Vec<i32>,
    pub view_mode: ViewMode,
    pub viewport_changed: bool,
    pub newly_visible_chunks_xy: HashSet<IVec2>,
    last_visible_chunks_xy: HashSet<IVec2>,
    last_visible_z_levels: Vec<i32>,
    last_view_mode: ViewMode,
}

impl RenderViewport {
    fn update(
        &mut self,
        camera_aabb: Rect,
        chunk_edge: f32,
        view_z: i32,
        view_mode: ViewMode,
        show_depth_stack: bool,
    ) {
        self.last_visible_chunks_xy = self.visible_chunks_xy.clone();
        self.last_visible_z_levels = self.visible_z_levels.clone();
        self.last_view_mode = self.view_mode;

        self.visible_chunks_xy = Self::chunks_from_rect(camera_aabb, chunk_edge);
        self.visible_z_levels = if show_depth_stack {
            z_levels_to_render(view_z)
        } else {
            vec![view_z]
        };
        self.view_mode = view_mode;

        self.viewport_changed = self.visible_chunks_xy != self.last_visible_chunks_xy
            || self.visible_z_levels != self.last_visible_z_levels
            || self.view_mode != self.last_view_mode;

        if self.viewport_changed {
            self.newly_visible_chunks_xy = self
                .visible_chunks_xy
                .difference(&self.last_visible_chunks_xy)
                .copied()
                .collect();
        } else {
            self.newly_visible_chunks_xy.clear();
        }
    }

    fn chunks_from_rect(rect: Rect, chunk_pixel_size: f32) -> HashSet<IVec2> {
        let mut chunks = HashSet::new();

        let min_x = (rect.min.x / chunk_pixel_size).floor() as i32;
        let max_x = (rect.max.x / chunk_pixel_size).ceil() as i32;
        let min_y = (rect.min.y / chunk_pixel_size).floor() as i32;
        let max_y = (rect.max.y / chunk_pixel_size).ceil() as i32;

        for x in (min_x - VIEWPORT_PADDING_CHUNKS)..=(max_x + VIEWPORT_PADDING_CHUNKS) {
            for y in (min_y - VIEWPORT_PADDING_CHUNKS)..=(max_y + VIEWPORT_PADDING_CHUNKS) {
                chunks.insert(IVec2::new(x, y));
            }
        }

        chunks
    }
}

pub fn update_render_viewport(
    mut viewport: ResMut<RenderViewport>,
    camera_query: Query<(&Camera, &GlobalTransform, &Projection), With<Camera2d>>,
    view_z: Res<ViewZLevel>,
    view_mode: Res<ViewMode>,
    tile_layer_debug_state: Res<TileLayerDebugState>,
    terrain_config: Res<TerrainConfig>,
) {
    let Ok((camera, camera_global_xf, projection)) = camera_query.single() else {
        return;
    };

    let _ = camera;

    let Projection::Orthographic(ortho) = projection else {
        return;
    };

    let chunk_pixel_size = f32::from(TILE_SIZE_IN_PX) * terrain_config.chunk_edge as f32;
    if chunk_pixel_size <= 0.0 {
        return;
    }

    let mut camera_rect = ortho.area;
    camera_rect.min += camera_global_xf.translation().xy();
    camera_rect.max += camera_global_xf.translation().xy();

    viewport.update(
        camera_rect,
        chunk_pixel_size,
        view_z.current,
        *view_mode,
        tile_layer_debug_state.show_depth_stack,
    );

    #[cfg(debug_assertions)]
    if viewport.viewport_changed {
        debug!(
            "viewport changed: {} chunks, z_levels: {:?}",
            viewport.visible_chunks_xy.len(),
            viewport.visible_z_levels
        );
    }
}

fn z_levels_to_render(view_z_current: i32) -> Vec<i32> {
    const Z_LEVELS_BELOW_RENDERED: i32 = 5;
    (0..=Z_LEVELS_BELOW_RENDERED)
        .map(|offset| view_z_current - offset)
        .collect()
}
