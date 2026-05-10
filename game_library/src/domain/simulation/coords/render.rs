use bevy::prelude::*;

use crate::domain::simulation::{
    GLOBAL_MEMORY_OVERLAY_SPRITE_Z, RenderEntityMovementState, TileLayer,
};
use crate::domain::visuals::TILE_SIZE_IN_PX;
use world_sim::world_api::{EntityMovementSnapshot, Vec3i};

pub(crate) fn calculate_sprite_z(z_offset: i32, layer: TileLayer) -> f32 {
    let base = (z_offset.clamp(-5, 0) * 2) as f32;

    match layer {
        TileLayer::Floor => base,
        TileLayer::EdgeShadow => base + 0.5,
        TileLayer::CeilingShadow => base + 0.75,
        TileLayer::FogShadow => GLOBAL_MEMORY_OVERLAY_SPRITE_Z,
    }
}

pub(crate) fn get_depth_tint_tile_color(z_offset: i32) -> Color {
    match z_offset {
        0 => Color::WHITE,
        -1 => Color::srgb(0.75, 0.75, 0.75),
        -2 => Color::srgb(0.47, 0.49, 0.49),
        -3 => Color::srgb(0.33, 0.35, 0.61),
        -4 => Color::srgb(0.22, 0.24, 0.61),
        -5 => Color::srgb(0.12, 0.15, 0.43),
        _ => Color::srgb(0.02, 0.05, 0.43),
    }
}

pub(crate) fn get_depth_tint_sprite_color(z_offset: i32) -> Color {
    match z_offset.abs() {
        0 => Color::WHITE,
        1 => Color::srgb(0.75, 0.75, 0.75),
        2 => Color::srgb(0.47, 0.49, 0.49),
        3 => Color::srgb(0.33, 0.35, 0.61),
        4 => Color::srgb(0.22, 0.24, 0.61),
        5 => Color::srgb(0.12, 0.15, 0.43),
        _ => Color::srgb(0.02, 0.05, 0.43),
    }
}

pub(crate) fn chunk_world_translation_xy(chunk_xy: IVec2, chunk_edge: u32, sprite_z: f32) -> Vec3 {
    let edge = chunk_edge as f32;
    let tile_size = f32::from(TILE_SIZE_IN_PX);
    Vec3::new(
        (chunk_xy.x as f32) * edge * tile_size,
        (chunk_xy.y as f32) * edge * tile_size,
        sprite_z,
    )
}

pub(crate) fn world_to_pixel_translation(world_position: Vec3i, tile_size: f32) -> Vec3 {
    Vec3::new(
        ((world_position.x as f32) + 0.5) * tile_size,
        ((world_position.y as f32) + 0.5) * tile_size,
        1.0,
    )
}

pub(crate) fn world_to_pixel_translation_f32(world_position: Vec3, tile_size: f32) -> Vec3 {
    Vec3::new(
        (world_position.x + 0.5) * tile_size,
        (world_position.y + 0.5) * tile_size,
        1.0,
    )
}

pub(crate) fn render_movement_state(movement: EntityMovementSnapshot) -> RenderEntityMovementState {
    RenderEntityMovementState {
        start_position: Vec3::new(
            movement.start_position[0],
            movement.start_position[1],
            movement.start_position[2],
        ),
        origin: movement.origin,
        target: movement.target,
        progress_percent: movement.progress_percent,
    }
}

pub(crate) fn render_movement_direction(movement: RenderEntityMovementState) -> IVec3 {
    IVec3::new(
        (movement.target.x - movement.origin.x).signum(),
        (movement.target.y - movement.origin.y).signum(),
        (movement.target.z - movement.origin.z).signum(),
    )
}
