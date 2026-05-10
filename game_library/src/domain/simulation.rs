mod coords;
mod debug;
mod entity_render;
mod input;
#[cfg(not(target_arch = "wasm32"))]
mod replay;
mod setup;
mod state;
mod streaming_camera;
mod sync;
mod tile_builders;
mod tilemap;

pub use debug::{draw_chunk_borders, draw_depth_labels, toggle_chunk_borders};
pub use entity_render::{
    draw_entity_occupancy_boxes, project_world_entities_to_sprites, smooth_player_render_transform,
};
pub use input::{queue_world_commands_from_input, toggle_tile_layers};
#[cfg(not(target_arch = "wasm32"))]
pub use replay::drive_replay_playback;
pub use setup::setup_simulation_state;
pub use state::*;
pub use streaming_camera::{
    follow_player_camera, stream_chunks_around_player, sync_camera_z_to_player,
    sync_viewport_to_invalidation, update_view_z_level,
};
pub use sync::sync_render_world_from_snapshot;
pub use tilemap::{manage_tilemap_chunk_lifecycle, project_world_to_tilemap};

#[cfg(test)]
mod tests;
