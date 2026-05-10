use std::collections::HashSet;

use bevy::math::IVec2;
use bevy::prelude::*;
use world_sim::world_api::Vec3i;

use crate::domain::simulation::{TileLayer, TileLayerDebugState};
use crate::resources::render_viewport::RenderViewport;
use crate::resources::view_mode::ViewMode;

#[derive(Resource)]
pub struct TilemapInvalidation {
    dirty: HashSet<(IVec2, i32, TileLayer)>,
    view_invalidated: bool,
    pub visible_chunks_xy: HashSet<IVec2>,
    pub visible_z_levels: Vec<i32>,
    pub viewport_changed: bool,
    pub newly_visible_chunks_xy: HashSet<IVec2>,
}

impl Default for TilemapInvalidation {
    fn default() -> Self {
        Self {
            dirty: HashSet::new(),
            view_invalidated: false,
            visible_chunks_xy: HashSet::new(),
            visible_z_levels: Vec::new(),
            viewport_changed: false,
            newly_visible_chunks_xy: HashSet::new(),
        }
    }
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
        tile_layer_debug_state: &TileLayerDebugState,
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

    /// Mark all chunks affected by a single block change at world position `p`.
    /// Also marks z-1 because EdgeShadow/CeilingShadow at z-1 read block data at z.
    /// Marks neighboring chunks when `p` sits on or near a chunk boundary.
    pub fn mark_block_change(
        &mut self,
        p: Vec3i,
        chunk_edge: u32,
        view_mode: ViewMode,
        layers: &TileLayerDebugState,
    ) {
        let c = chunk_of_xy(p, chunk_edge);
        self.mark_layers_for_chunk_z(c, p.z, view_mode, layers);
        // CeilingShadow at z-1 reads block data at z; EdgeShadow at z-1 reads has_edge_above from z.
        self.mark_layers_for_chunk_z(c, p.z - 1, view_mode, layers);

        // Boundary: if any ±1 x/y neighbor falls in a different chunk, mark that chunk too.
        for (dx, dy) in [
            (1, 0),
            (-1, 0),
            (0, 1),
            (0, -1),
            (1, 1),
            (1, -1),
            (-1, 1),
            (-1, -1),
        ] {
            let neighbor = Vec3i::new(p.x + dx, p.y + dy, p.z);
            let nc = chunk_of_xy(neighbor, chunk_edge);
            if nc != c {
                self.mark_layers_for_chunk_z(nc, p.z, view_mode, layers);
                self.mark_layers_for_chunk_z(nc, p.z - 1, view_mode, layers);
            }
        }
    }

    fn mark_layers_for_chunk_z(
        &mut self,
        c: IVec2,
        z: i32,
        view_mode: ViewMode,
        layers: &TileLayerDebugState,
    ) {
        if layers.show_floor {
            self.mark(c, z, TileLayer::Floor);
        }
        if layers.show_edge_shadow {
            self.mark(c, z, TileLayer::EdgeShadow);
        }
        if layers.show_ceiling_shadow {
            self.mark(c, z, TileLayer::CeilingShadow);
        }
        if view_mode == ViewMode::Entity && layers.show_fog_shadow {
            self.mark(c, z, TileLayer::FogShadow);
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
            let (chunk_xy, z, _layer) = key;
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

/// Convert a world XY position to chunk coordinates. Inverse of `world_pos_in_chunk`.
/// Chunks are centered: chunk x covers [chunk_x*edge - half, chunk_x*edge - half + edge).
pub fn chunk_of_xy(p: Vec3i, chunk_edge: u32) -> IVec2 {
    let edge = i32::try_from(chunk_edge).expect("chunk_edge fits in i32");
    let half = edge / 2;
    IVec2::new(
        (p.x + half).div_euclid(edge),
        (p.y + half).div_euclid(edge),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reproduces world_pos_in_chunk's formula so the round-trip test is self-contained.
    fn world_pos(chunk_x: i32, chunk_y: i32, lx: u32, ly: u32, edge: u32) -> Vec3i {
        let edge_i = edge as i32;
        let half = edge_i / 2;
        Vec3i::new(
            chunk_x * edge_i + lx as i32 - half,
            chunk_y * edge_i + ly as i32 - half,
            0,
        )
    }

    #[test]
    fn chunk_of_xy_round_trips() {
        let chunk_edge: u32 = 16;
        for chunk_x in -3i32..=3 {
            for chunk_y in -3i32..=3 {
                for lx in 0..chunk_edge {
                    for ly in 0..chunk_edge {
                        let world = world_pos(chunk_x, chunk_y, lx, ly, chunk_edge);
                        let recovered = chunk_of_xy(world, chunk_edge);
                        assert_eq!(
                            recovered,
                            IVec2::new(chunk_x, chunk_y),
                            "chunk_of_xy({world:?}) should be ({chunk_x},{chunk_y}) but got {recovered}"
                        );
                    }
                }
            }
        }
    }
}
