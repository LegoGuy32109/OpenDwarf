use std::collections::HashSet;

use bevy::math::IVec2;
use bevy::prelude::*;

use crate::domain::simulation::TileLayer;
use crate::resources::render_viewport::RenderViewport;
use crate::resources::view_z_level::ViewZLevel;

#[derive(Resource, Default)]
pub struct TilemapInvalidation {
    dirty: HashSet<(IVec2, i32, TileLayer)>,
    view_invalidated: bool,
}

impl TilemapInvalidation {
    pub fn mark(&mut self, chunk_xy: IVec2, z: i32, layer: TileLayer) {
        self.dirty.insert((chunk_xy, z, layer));
    }

    pub fn mark_all_layers_at(&mut self, chunk_xy: IVec2, z: i32) {
        self.mark(chunk_xy, z, TileLayer::Floor);
        self.mark(chunk_xy, z, TileLayer::EdgeShadow);
        self.mark(chunk_xy, z, TileLayer::CeilingShadow);
        self.mark(chunk_xy, z, TileLayer::FogShadow);
    }

    pub fn mark_all_visible_layers(
        &mut self,
        viewport: &RenderViewport,
        tile_layer_debug_state: &crate::domain::simulation::TileLayerDebugState,
    ) {
        for &chunk_xy in &viewport.visible_chunks_xy {
            for &z in &viewport.visible_z_levels {
                if tile_layer_debug_state.show_floor {
                    self.mark(chunk_xy, z, TileLayer::Floor);
                }
                if tile_layer_debug_state.show_edge_shadow {
                    self.mark(chunk_xy, z, TileLayer::EdgeShadow);
                }
                if tile_layer_debug_state.show_ceiling_shadow {
                    self.mark(chunk_xy, z, TileLayer::CeilingShadow);
                }
                if tile_layer_debug_state.show_fog_shadow {
                    self.mark(chunk_xy, z, TileLayer::FogShadow);
                }
            }
        }
    }

    pub fn invalidate_view(&mut self) {
        self.view_invalidated = true;
    }

    pub fn is_empty(&self) -> bool {
        self.dirty.is_empty() && !self.view_invalidated
    }

    pub fn view_invalidated(&self) -> bool {
        self.view_invalidated
    }

    pub fn clear_view_invalidated(&mut self) {
        self.view_invalidated = false;
    }

    pub fn drain_visible_into(
        &mut self,
        viewport: &RenderViewport,
        out: &mut HashSet<(IVec2, i32, TileLayer)>,
    ) {
        for &key in &self.dirty {
            let (chunk_xy, z, layer) = key;
            if viewport.visible_chunks_xy.contains(&chunk_xy)
                && viewport.visible_z_levels.contains(&z)
            {
                out.insert(key);
            }
        }
    }

    pub fn remove(&mut self, chunk_xy: IVec2, z: i32, layer: TileLayer) {
        self.dirty.remove(&(chunk_xy, z, layer));
    }

    pub fn clear(&mut self) {
        self.dirty.clear();
        self.view_invalidated = false;
    }
}
