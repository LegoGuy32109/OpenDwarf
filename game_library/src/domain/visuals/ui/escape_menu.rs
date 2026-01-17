use bevy::prelude::*;

use super::super::visual_utils::{color_from_hex, color_from_hex_alpha};
use super::key_map::KeyMap;
use super::ui_focus_map::UiFocusMap;

pub fn handle_escape_menu(
    mut commands: Commands,
    key_map: Res<KeyMap>,
    keyboard_input: Res<ButtonInput<KeyCode>>,
    maybe_menu: Query<Entity, With<EscapeMenu>>,
) {
    let keys = KeyMap::get_keys(&keyboard_input);
    if keys.just_pressed(&key_map.escape_menu) {
        if let Ok(menu) = maybe_menu.single_inner() {
            commands.entity(menu).despawn();
        } else {
            commands.spawn(escape_menu());
        }
    }
}

#[derive(Component)]
pub struct EscapeMenu;

fn escape_menu() -> impl Bundle {
    let menu_background_color: Color = color_from_hex_alpha("#222222", 0.4);

    return (
        EscapeMenu,
        UiFocusMap {},
        Node {
            width: percent(100.),
            height: percent(100.),
            justify_content: JustifyContent::Center,
            align_items: AlignItems::Center,
            flex_direction: FlexDirection::Column,
            row_gap: px(16),
            ..default()
        },
        BackgroundColor(menu_background_color),
        children![
            escape_menu_button("Back to game"),
            escape_menu_button("Options..."),
            escape_menu_button("Save and quit to title")
        ],
    );
}

fn escape_menu_button(text: &str) -> impl Bundle {
    let button_color: Color = color_from_hex("#22213F");
    let button_border_color: Color = color_from_hex("#AFAFAB");

    return (
        Node {
            width: percent(70.),
            height: px(70),
            border: UiRect::all(px(2)),
            justify_content: JustifyContent::Center,
            align_items: AlignItems::Center,
            ..default()
        },
        BackgroundColor(button_color),
        BorderColor::all(button_border_color),
        children![(
            Text::new(text),
            TextFont {
                font_size: 24.0,
                ..default()
            },
            TextColor(Color::WHITE),
        )],
    );
}
