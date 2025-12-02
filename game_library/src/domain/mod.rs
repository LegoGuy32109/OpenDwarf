use bevy::asset::AssetMetaCheck;
use bevy::platform::collections::HashSet;
use bevy::prelude::*;
use bevy::sprite_render::{AlphaMode2d, TileData, TilemapChunk, TilemapChunkTileData};
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use std::fmt::Write;
use std::time::Duration;

use crate::components::map_coordinates::MapCoordinates;

const TILE_SIZE_IN_PX: u16 = 64;

const TILE_MAP_PATH: &str = "sprites/StackedTextures.png";
// WARN: CANNOT BE A MULTIPLE OF 6
const NUM_TILES_IN_MAP: u16 = 31;

pub struct OpenDwarfPlugins;

impl Plugin for OpenDwarfPlugins {
    fn build(&self, app: &mut App) {
        app.add_plugins(define_defaults())
            .add_systems(Startup, setup)
            .add_systems(Update, (update_tileset_image, consume_action))
            .add_systems(FixedUpdate, keyboard_movement)
            // debug systems
            .add_systems(Update, debug_menu);
    }
}

fn define_defaults() -> impl PluginGroup {
    DefaultPlugins
        .set(ImagePlugin::default_nearest())
        .set(WindowPlugin {
            primary_window: Some(Window {
                // fill entire browser window
                fit_canvas_to_parent: true,
                // don't hijack keyboard shortcuts
                prevent_default_event_handling: false,
                canvas: Some("#game-canvas".to_string()),
                ..default()
            }),
            ..default()
        })
        .set(AssetPlugin {
            // server won't check for meta files won't clog with 404s
            // if needed in future try AssetMetaCheck::Paths(...)
            meta_check: AssetMetaCheck::Never,
            ..default()
        })
}

fn update_tileset_image(
    chunk_query: Single<&TilemapChunk>,
    mut events: MessageReader<AssetEvent<Image>>,
    mut images: ResMut<Assets<Image>>,
) {
    let tileset_image_handle = &chunk_query.tileset;
    let image_asset_id = tileset_image_handle.id();
    for event in events.read() {
        if event.is_loaded_with_dependencies(image_asset_id) {
            let image = images.get_mut(tileset_image_handle).unwrap();
            image.reinterpret_stacked_2d_as_array(NUM_TILES_IN_MAP.into());
        }
    }
}

#[derive(Component)]
struct Player;

fn setup(mut commands: Commands, asset_server: Res<AssetServer>) {
    // Camera
    commands.spawn((Camera2d, Camera::default()));

    // Load textures for tile map
    let tile_textures: Handle<Image> = asset_server.load(TILE_MAP_PATH);

    let chunk_size = UVec2::splat(16);
    let tile_display_size = UVec2::splat(TILE_SIZE_IN_PX.into());

    // Determine data for tile map
    let mut rng = ChaCha8Rng::seed_from_u64(42);
    let tile_data: Vec<Option<TileData>> = (0..chunk_size.element_product())
        // range of stone variations
        .map(|_| rng.random_range(1..=6))
        .enumerate()
        .map(|(i, texture_index)| {
            if (i + 11) % 31 == 0 {
                return Some(TileData::from_tileset_index(13));
            } else if (i + 18) % 43 == 0 {
                return Some(TileData::from_tileset_index(14));
            } else if (i + 4) % 62 == 0 {
                return Some(TileData::from_tileset_index(11));
            } else if (i + 6) % 23 == 0 {
                return Some(TileData::from_tileset_index(16));
            }
            Some(TileData::from_tileset_index(texture_index))
        })
        .collect();

    let chunk_data = TilemapChunkTileData(tile_data);
    let chunk = TilemapChunk {
        chunk_size,
        tile_display_size,
        tileset: tile_textures,
        alpha_mode: AlphaMode2d::Opaque,
    };

    // Load a sprite for the player; you must have an image at "assets/Dwarf.png"
    let dwarf_texture = asset_server.load("sprites/Dwarf.png");
    let dwarf_coordinates = MapCoordinates::new(IVec3::ZERO, uvec3(chunk_size.x, chunk_size.y, 1));
    let dwarf_transform = chunk.calculate_tile_transform(dwarf_coordinates.as_uvec2());

    commands.spawn((chunk, chunk_data));
    commands.spawn((
        Sprite {
            image: dwarf_texture,
            custom_size: Some(Vec2::splat(TILE_SIZE_IN_PX.into())),
            ..default()
        },
        dwarf_transform,
        Player,
        dwarf_coordinates,
    ));
}

#[derive(Component, Debug)]
struct Action {
    target_entity: Entity,
    direction: IVec3,
    time_started: Duration,
    timer: Timer,
}

fn consume_action(
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

#[derive(Component)]
struct DebugText;

#[derive(Resource)]
struct MovementChord {
    first_key: Option<KeyCode>,
    timer: Timer,
}

impl Default for MovementChord {
    fn default() -> Self {
        Self {
            first_key: None,
            timer: Timer::from_seconds(0.2, TimerMode::Once),
        }
    }
}

fn make_movement_action(direction: IVec3, entity: Entity, time_started: Duration) -> Action {
    let duration_time = direction.length_squared() as f32 * 0.3;
    Action {
        target_entity: entity,
        direction,
        time_started,
        timer: Timer::new(Duration::from_secs_f32(duration_time), TimerMode::Once),
    }
}

fn debug_menu(
    mut commands: Commands,
    keyboard_input: Res<ButtonInput<KeyCode>>,
    debug_text_query: Query<(Entity, &mut Text), With<DebugText>>,
    movement_chord_option: Option<ResMut<MovementChord>>,
) {
    // toggle debug text
    let maybe_debug_text = debug_text_query.single_inner();
    if keyboard_input.just_pressed(KeyCode::F1) {
        // text is already being displayed, remove it
        if let Ok((entity, mut text)) = maybe_debug_text {
            text.0 = String::new();
            commands.entity(entity).remove::<DebugText>();
        // text is not being displayed, add it
        } else {
            commands.spawn((
                Text::new(""),
                TextFont {
                    font_size: 24.0,
                    ..default()
                },
                TextColor(Color::WHITE),
                Node {
                    position_type: PositionType::Absolute,
                    top: Val::Px(20.0),
                    left: Val::Px(20.0),
                    ..default()
                },
                DebugText,
            ));
        }
        // end here, can process keys to display on next frame
        return;
    }
    // display keyboard input if debug text is active
    if let Ok(bundle) = maybe_debug_text {
        fn format_keys<I>(label: &str, keys: I) -> String
        where
            I: Iterator<Item = KeyCode>,
        {
            let mut keys: Vec<String> = keys.map(|key| format!("{key:?}")).collect();
            keys.sort();

            if keys.is_empty() {
                format!("{label}: (none)")
            } else {
                format!("{label}: {}", keys.join(", "))
            }
        }

        let mut text = bundle.1;

        let pressed_output = format_keys("Pressed Keys", keyboard_input.get_pressed().copied());

        let just_pressed_output = format_keys(
            "Just Pressed Keys",
            keyboard_input.get_just_pressed().copied(),
        );

        let just_released_output = format_keys(
            "Just Released Keys",
            keyboard_input.get_just_released().copied(),
        );
        text.0 = [just_pressed_output, pressed_output, just_released_output].join("\n");

        // chord info
        if let Some(ref movement_chord) = movement_chord_option {
            let _ = write!(text.0, "\nMovement Chord: {:?}", movement_chord.first_key);
        }
    }
}

fn keyboard_movement(
    mut commands: Commands,
    keyboard_input: Res<ButtonInput<KeyCode>>,
    time: Res<Time>,
    player_query: Query<Entity, With<Player>>,
    movement_chord_option: Option<ResMut<MovementChord>>,
) {
    let Ok(player) = player_query.single_inner() else {
        error_once!("Failed to find Player in world");
        return;
    };

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
        .filter(|k| {
            matches!(
                k,
                KeyCode::KeyE | KeyCode::KeyS | KeyCode::KeyD | KeyCode::KeyF
            )
        })
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
            if chord_direction == key_direction || combined_direction == IVec3::ZERO {}
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

fn get_movement_direction(key: KeyCode) -> IVec3 {
    match key {
        KeyCode::KeyE => ivec3(0, 1, 0),
        KeyCode::KeyD => ivec3(0, -1, 0),
        KeyCode::KeyS => ivec3(-1, 0, 0),
        KeyCode::KeyF => ivec3(1, 0, 0),
        _ => IVec3::ZERO,
    }
}
