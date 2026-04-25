use bevy::ecs::system::Commands;
use bevy::prelude::*;

use crate::domain::runtime_telemetry::RuntimeTelemetryClipboard;
use crate::domain::runtime_telemetry::RuntimeTelemetryState;
use crate::domain::simulation::ReplayHudState;
use crate::domain::simulation::TileLayerDebugState;
use crate::resources::input_state::InputState;

#[derive(Component)]
pub struct DebugText;

#[derive(Component)]
pub struct ReplayDebugText;

#[derive(Component)]
pub struct ReplayEventLine;

pub fn debug_menu(
    mut commands: Commands,
    keyboard_input: Res<ButtonInput<KeyCode>>,
    input_state: Res<InputState>,
    tile_layer_debug_state: Option<Res<TileLayerDebugState>>,
    telemetry_state: Option<Res<RuntimeTelemetryState>>,
    mut telemetry_clipboard: Option<ResMut<RuntimeTelemetryClipboard>>,
    debug_text_query: Query<(Entity, &mut Text), With<DebugText>>,
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
        let telemetry_state_ref = telemetry_state.as_deref();

        let pressed_output = format_keys("Pressed Keys", keyboard_input.get_pressed().copied());

        let just_pressed_output = format_keys(
            "Just Pressed Keys",
            keyboard_input.get_just_pressed().copied(),
        );

        let just_released_output = format_keys(
            "Just Released Keys",
            keyboard_input.get_just_released().copied(),
        );
        let mut lines = vec![just_pressed_output, pressed_output, just_released_output];
        if let Some(telemetry_state) = telemetry_state_ref {
            lines.push(String::from("Telemetry"));
            lines.push(telemetry_state.short_report.clone());
            lines.push(String::from("F10 Copy Short | F11 Copy Long"));
        } else {
            lines.push(String::from("Telemetry unavailable"));
        }
        if let Some(tile_layer_debug_state) = tile_layer_debug_state {
            lines.push(format!(
                "Layer Toggles: 6 floor={} 7 edge={} 8 ceiling={} 9 fog={} 0 depth_stack={}",
                if tile_layer_debug_state.show_floor {
                    "on"
                } else {
                    "off"
                },
                if tile_layer_debug_state.show_edge_shadow {
                    "on"
                } else {
                    "off"
                },
                if tile_layer_debug_state.show_ceiling_shadow {
                    "on"
                } else {
                    "off"
                },
                if tile_layer_debug_state.show_fog_shadow {
                    "on"
                } else {
                    "off"
                },
                if tile_layer_debug_state.show_depth_stack {
                    "on"
                } else {
                    "off"
                },
            ));
        }
        if input_state.just_pressed_key(KeyCode::F10)
            && let (Some(telemetry_state), Some(clipboard)) =
                (telemetry_state_ref, telemetry_clipboard.as_deref_mut())
        {
            clipboard.copy_short_report(&telemetry_state.short_report);
        }
        if input_state.just_pressed_key(KeyCode::F11)
            && let (Some(telemetry_state), Some(clipboard)) =
                (telemetry_state_ref, telemetry_clipboard.as_deref_mut())
        {
            clipboard.copy_long_report(&telemetry_state.long_report);
        }
        text.0 = lines.join("\n");
    }
}

pub fn replay_debug_overlay(
    mut commands: Commands,
    replay_hud_state: Option<Res<ReplayHudState>>,
    mut replay_text_query: Query<(Entity, &mut Text), With<ReplayDebugText>>,
    replay_event_lines_query: Query<Entity, With<ReplayEventLine>>,
) {
    let is_replay_active = replay_hud_state
        .as_ref()
        .map(|state| state.active)
        .unwrap_or(false);

    if !is_replay_active {
        if let Ok((entity, _)) = replay_text_query.single() {
            commands.entity(entity).despawn();
        }
        for entity in &replay_event_lines_query {
            commands.entity(entity).despawn();
        }
        return;
    }

    let replay_hud_state =
        replay_hud_state.expect("replay state should exist when replay is active");
    let status = if replay_hud_state.playing {
        "Playing"
    } else {
        "Paused"
    };
    let text = format!(
        "Replay Mode\nControls: F6 Play/Pause | F7 Step | F8 Restart | F9 Toggle Events\nStatus: {}\nEvent: {}/{}\nWorld Tick: {}",
        status, replay_hud_state.cursor, replay_hud_state.total_events, replay_hud_state.tick
    );

    for entity in &replay_event_lines_query {
        commands.entity(entity).despawn();
    }

    if let Ok((_, mut existing_text)) = replay_text_query.single_mut() {
        existing_text.0 = text;
    } else {
        commands.spawn((
            Text::new(text),
            TextFont {
                font_size: 20.0,
                ..default()
            },
            TextColor(Color::srgba(0.95, 0.96, 1.0, 0.96)),
            Node {
                position_type: PositionType::Absolute,
                top: Val::Px(20.0),
                left: Val::Px(20.0),
                ..default()
            },
            ReplayDebugText,
        ));
    }

    if !replay_hud_state.show_all_events {
        return;
    }

    let mut line_y = 155.0;
    for (index, event_label) in replay_hud_state.event_labels.iter().enumerate() {
        let performed = index < replay_hud_state.cursor;
        let color = if performed {
            Color::srgba(0.9, 0.95, 1.0, 0.95)
        } else {
            Color::srgba(0.5, 0.54, 0.6, 0.85)
        };
        commands.spawn((
            Text::new(format!("{:04}: {}", index + 1, event_label)),
            TextFont {
                font_size: 14.0,
                ..default()
            },
            TextColor(color),
            Node {
                position_type: PositionType::Absolute,
                top: Val::Px(line_y),
                left: Val::Px(20.0),
                ..default()
            },
            ReplayEventLine,
        ));
        line_y += 18.0;
    }
}
