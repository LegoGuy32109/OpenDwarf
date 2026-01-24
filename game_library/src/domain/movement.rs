use bevy::platform::collections::HashSet;
use bevy::prelude::*;
use bevy::sprite_render::TilemapChunk;
use std::time::Duration;

use crate::components::map_coordinates::MapCoordinates;
use crate::resources::player_focus_state::PlayerFocusState;

use super::visuals::Player;
use super::visuals::ui::key_map::KeyMap;

#[derive(Component, Debug)]
pub struct Action {
    pub target_entity: Entity,
    pub direction: IVec3,
    pub time_started: Duration,
    pub timer: Timer,
}

#[derive(Resource)]
pub struct MovementChord {
    pub first_key: Option<KeyCode>,
    pub timer: Timer,
}

impl Default for MovementChord {
    fn default() -> Self {
        Self {
            first_key: None,
            timer: Timer::from_seconds(0.2, TimerMode::Once),
        }
    }
}

pub fn consume_action(
    mut commands: Commands,
    time: Res<Time>,
    tilemap: Single<&TilemapChunk>,
    mut actions_in_progress: Query<(Entity, &mut Action)>,
    mut entities_with_transforms: Query<(&mut Transform, &mut MapCoordinates), With<Player>>,
) {
    // keep track of actions in progress
    let mut actions = HashSet::new();

    for (action_entity, mut action) in &mut actions_in_progress {
        // find moving entity's transform
        let Ok((mut entity_transform, mut map_coordinates)) =
            entities_with_transforms.get_mut(action.target_entity)
        else {
            warn!("Invalid Action {:?}", action);
            commands.entity(action_entity).remove::<Action>();
            continue;
        };

        // if the timer is finished, the entity has completed the move action
        if action.timer.is_finished() {
            map_coordinates.add_direction(action.direction);
            info!(
                "\nMoved {:?}, To {:?}\nTook {:?}",
                action.direction,
                entity_transform.translation,
                time.elapsed() - action.time_started
            );
            commands.entity(action_entity).remove::<Action>();
            continue;
        }

        // keep track of this action so duplicates don't occur
        if !actions.insert(action.target_entity) {
            warn!("Duplicate action");
            commands.entity(action_entity).remove::<Action>();
            continue;
        }

        // tick the timer (this function is updated every frame)
        action.timer.tick(time.delta());
        let fraction_done = action.timer.fraction();

        // determine where entity is, and where it's going
        let current_tile_index = map_coordinates.as_uvec2();
        let destination_tile_index = map_coordinates
            .clone()
            .add_direction(action.direction)
            .as_uvec2();
        let current_tile_transform = tilemap.calculate_tile_transform(current_tile_index);
        let destination_tile_transform = tilemap.calculate_tile_transform(destination_tile_index);
        entity_transform.translation = Vec3::lerp(
            current_tile_transform.translation,
            destination_tile_transform.translation,
            fraction_done,
        );
    }
}

pub fn keyboard_movement(
    mut commands: Commands,
    keyboard_input: Res<ButtonInput<KeyCode>>,
    key_map: Res<KeyMap>,
    time: Res<Time>,
    player_query: Query<Entity, With<Player>>,
    movement_chord_option: Option<ResMut<MovementChord>>,
    player_focus_state: Res<PlayerFocusState>,
) {
    let Ok(player) = player_query.single_inner() else {
        error_once!("Failed to find Player in world");
        return;
    };

    if !player_focus_state.can_move_in_world() {
        return;
    }

    // given some direction vector, create an action to be processed
    // if direction isn't 0
    let mut spawn_movement_action = |direction: IVec3| {
        // if we're trying to move clear out movement chord
        commands.remove_resource::<MovementChord>();
        // in some cases directions might cancel out, disregard if so
        if direction != IVec3::ZERO {
            // if there was somehow a Movement Chord still active, remove it
            commands.spawn(make_movement_action(direction, player, time.elapsed()));
        }
    };

    let pressed_movement_keys: HashSet<KeyCode> = keyboard_input
        .get_just_pressed()
        .filter(|k| key_map.get_movement_keys().contains(k))
        .copied()
        .collect();
    let mut movement_keys_sorted: Vec<KeyCode> = pressed_movement_keys.into_iter().collect();
    movement_keys_sorted.sort();
    let mut movement_keys_sorted = movement_keys_sorted.into_iter();
    let first_movement_key = movement_keys_sorted.next();
    let second_movement_key = movement_keys_sorted.next();

    // if you pressed two keys at once, overwrite whatever is in the chord
    if let Some(first_key) = first_movement_key
        && let Some(second_key) = second_movement_key
    {
        spawn_movement_action(
            get_movement_direction(first_key) + get_movement_direction(second_key),
        );
        return;
    }

    if let Some(mut movement_chord) = movement_chord_option {
        let Some(key_in_chord) = movement_chord.first_key else {
            error!("Movement chord triggered without a key");
            commands.remove_resource::<MovementChord>();
            return;
        };

        // if move key is pressed, combine with key in chord
        if let Some(first_key) = first_movement_key {
            let chord_direction = get_movement_direction(key_in_chord);
            let key_direction = get_movement_direction(first_key);
            let combined_direction = chord_direction + key_direction;
            // don't duplicate distance
            // if direction cancels out, just do the latest direction
            if chord_direction == key_direction || combined_direction == IVec3::ZERO {
                spawn_movement_action(key_direction);
            }
            spawn_movement_action(combined_direction);
            return;
        }
        // if movement_chord exists, tick timer down
        if movement_chord.timer.tick(time.delta()).is_finished() {
            spawn_movement_action(get_movement_direction(key_in_chord));
        }
    } else if let Some(key) = first_movement_key {
        commands.insert_resource(MovementChord {
            first_key: Some(key),
            ..default()
        });
    }
}

pub fn make_movement_action(direction: IVec3, entity: Entity, time_started: Duration) -> Action {
    let duration_time = direction.length_squared() as f32 * 0.3;
    Action {
        target_entity: entity,
        direction,
        time_started,
        timer: Timer::new(Duration::from_secs_f32(duration_time), TimerMode::Once),
    }
}

pub fn get_movement_direction(key: KeyCode) -> IVec3 {
    match key {
        KeyCode::KeyE => ivec3(0, 1, 0),
        KeyCode::KeyD => ivec3(0, -1, 0),
        KeyCode::KeyS => ivec3(-1, 0, 0),
        KeyCode::KeyF => ivec3(1, 0, 0),
        _ => IVec3::ZERO,
    }
}
