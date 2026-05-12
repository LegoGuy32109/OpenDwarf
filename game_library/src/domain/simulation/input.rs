use bevy::prelude::*;

use super::coords::render_movement_direction;
use super::{HeldMovementState, RenderEntityData, ReplayMode, TileLayerDebugState};
use crate::resources::input_state::InputState;
use world_sim::bevy_app::{PrimarySimulationEntityId, WorldCommandQueue};
use world_sim::world_api::Vec3i;

pub fn toggle_tile_layers(
    input_state: Res<InputState>,
    mut tile_layer_debug_state: ResMut<TileLayerDebugState>,
    mut invalidation: ResMut<crate::domain::tilemap_invalidation::TilemapInvalidation>,
) {
    let mut changed = false;

    if input_state.just_pressed_key(KeyCode::Digit6) {
        tile_layer_debug_state.show_floor = !tile_layer_debug_state.show_floor;
        changed = true;
    }
    if input_state.just_pressed_key(KeyCode::Digit7) {
        tile_layer_debug_state.show_edge_shadow = !tile_layer_debug_state.show_edge_shadow;
        changed = true;
    }
    if input_state.just_pressed_key(KeyCode::Digit8) {
        tile_layer_debug_state.show_ceiling_shadow = !tile_layer_debug_state.show_ceiling_shadow;
        changed = true;
    }
    if input_state.just_pressed_key(KeyCode::Digit9) {
        tile_layer_debug_state.show_fog_shadow = !tile_layer_debug_state.show_fog_shadow;
        changed = true;
    }
    if input_state.just_pressed_key(KeyCode::Digit0) {
        tile_layer_debug_state.show_depth_stack = !tile_layer_debug_state.show_depth_stack;
        changed = true;
    }

    if changed {
        invalidation.invalidate_view();
    }
}

pub fn queue_world_commands_from_input(
    input_state: Res<InputState>,
    replay_mode: Res<ReplayMode>,
    primary_entity_id: Res<PrimarySimulationEntityId>,
    entity_data: Res<RenderEntityData>,
    mut held_movement_state: ResMut<HeldMovementState>,
    mut world_command_queue: ResMut<WorldCommandQueue>,
) {
    if replay_mode.active {
        held_movement_state.was_moving_last_frame = false;
        return;
    }

    let (first_movement_key, second_movement_key) =
        input_state.get_first_two_just_pressed(&input_state.groups.movement);

    let direction = match (first_movement_key, second_movement_key) {
        (Some(first), Some(second)) => {
            input_state.movement_direction(first) + input_state.movement_direction(second)
        }
        (Some(first), None) => input_state.movement_direction(first),
        _ => IVec3::ZERO,
    };

    let Some(entity_id) = primary_entity_id.0 else {
        held_movement_state.was_moving_last_frame = false;
        return;
    };

    let Some(entity) = entity_data.entities.get(&entity_id) else {
        held_movement_state.was_moving_last_frame = false;
        return;
    };
    let is_moving = entity.movement.is_some();
    let active_direction = entity.movement.map(render_movement_direction);

    let (first_pressed, second_pressed) =
        input_state.get_first_two_pressed(&input_state.groups.movement);
    let held_direction = movement_direction_from_keys(&input_state, first_pressed, second_pressed);
    let should_chain_held = held_movement_state.was_moving_last_frame && !is_moving;
    let active_direction_is_held = active_direction
        .is_some_and(|active_direction| direction_contains(held_direction, active_direction));

    if !is_moving
        && (direction != IVec3::ZERO || (should_chain_held && held_direction != IVec3::ZERO))
    {
        let chosen_direction = if direction != IVec3::ZERO {
            direction
        } else {
            held_direction
        };
        world_command_queue.move_entity(
            entity_id,
            Vec3i::new(chosen_direction.x, chosen_direction.y, chosen_direction.z),
        );
    } else if is_moving
        && direction != IVec3::ZERO
        && active_direction != Some(direction)
        && !active_direction_is_held
    {
        world_command_queue
            .move_entity(entity_id, Vec3i::new(direction.x, direction.y, direction.z));
    }

    held_movement_state.was_moving_last_frame = is_moving;
}

pub(super) fn movement_direction_from_keys(
    input_state: &InputState,
    first: Option<KeyCode>,
    second: Option<KeyCode>,
) -> IVec3 {
    match (first, second) {
        (Some(first), Some(second)) => {
            input_state.movement_direction(first) + input_state.movement_direction(second)
        }
        (Some(first), None) => input_state.movement_direction(first),
        _ => IVec3::ZERO,
    }
}

pub(super) fn direction_contains(container: IVec3, direction: IVec3) -> bool {
    if container == IVec3::ZERO || direction == IVec3::ZERO {
        return false;
    }

    (direction.x == 0 || container.x.signum() == direction.x.signum())
        && (direction.y == 0 || container.y.signum() == direction.y.signum())
        && (direction.z == 0 || container.z.signum() == direction.z.signum())
}
