use bevy::ecs::system::Commands;
use bevy::prelude::*;
use std::fmt::Write;

use crate::domain::movement::MovementChord;
use crate::resources::input_state::InputState;

#[derive(Component)]
pub struct DebugText;

pub fn debug_menu(
    mut commands: Commands,
    keyboard_input: Res<ButtonInput<KeyCode>>,
    input_state: Res<InputState>,
    debug_text_query: Query<(Entity, &mut Text), With<DebugText>>,
    movement_chord_option: Option<ResMut<MovementChord>>,
) {
    // toggle debug text component
    let maybe_debug_text = debug_text_query.single_inner();

    if input_state.just_pressed(&input_state.debug_menu) {
        // text is already being displayed, remove it
        if let Ok((entity, mut text)) = maybe_debug_text {
            text.0 = String::new();
            commands.entity(entity).despawn();
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
