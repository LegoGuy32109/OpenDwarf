use bevy::prelude::*;

use super::super::visual_utils::{color_from_hex, color_from_hex_alpha};
use super::menu_handler::KeyMap;

pub fn handle_escape_menu(
    mut commands: Commands,
    key_map: Res<KeyMap>,
    keyboard_input: Res<ButtonInput<KeyCode>>,
    maybe_menu: Query<Entity, With<EscapeMenu>>,
) {
    let keys = KeyMap::get_keys(&keyboard_input);
    if keys.just_pressed(&key_map.escape_menu) {
        if let Ok(menu) = maybe_menu.single_inner() {
            info!("yeah its there, {menu}");
            commands.entity(menu).remove::<EscapeMenu>();
        } else {
            info!("lemme add one");
            commands.spawn(escape_menu());
        }
    }
}

#[derive(Component)]
pub struct EscapeMenu;

fn escape_menu() -> impl Bundle {
    let button_color: Color = color_from_hex("#112F11");
    let button_border_color: Color = color_from_hex("#CFBFBB");
    let menu_background_color: Color = color_from_hex_alpha("#222222", 0.4);

    return (
        EscapeMenu,
        Node {
            width: percent(100.),
            height: percent(100.),
            justify_content: JustifyContent::Center,
            align_items: AlignItems::Center,
            flex_direction: FlexDirection::Column,
            row_gap: px(8),
            ..default()
        },
        BackgroundColor(menu_background_color),
        children![
            (
                Node {
                    width: px(500),
                    height: px(100),
                    border: UiRect::all(px(2)),
                    justify_content: JustifyContent::Center,
                    align_items: AlignItems::Center,
                    ..default()
                },
                BackgroundColor(button_color),
                BorderColor::all(button_border_color),
            ),
            (
                Node {
                    width: px(500),
                    height: px(100),
                    border: UiRect::all(px(2)),
                    justify_content: JustifyContent::Center,
                    align_items: AlignItems::Center,
                    ..default()
                },
                BackgroundColor(button_color),
                BorderColor::all(button_border_color),
            )
        ],
    );
}
