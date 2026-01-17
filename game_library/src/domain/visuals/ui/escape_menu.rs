use bevy::math::CompassOctant;
use bevy::prelude::*;

use super::super::visual_utils::{color_from_hex, color_from_hex_alpha};
use super::key_map::KeyMap;
use super::ui_focus_map::UiFocusMap;

pub fn handle_escape_menu(
    mut commands: Commands,
    key_map: Res<KeyMap>,
    keyboard_input: Res<ButtonInput<KeyCode>>,
    maybe_menu: Query<(Entity, &mut UiFocusMap), With<EscapeMenu>>,
    button_query: Query<&EscapeMenuButton>,
) {
    let keys = KeyMap::get_keys(&keyboard_input);
    let toggle_menu_pressed = keys.just_pressed(&key_map.escape_menu);

    if let Ok((menu, mut ui_focus_map)) = maybe_menu.single_inner() {
        if toggle_menu_pressed {
            commands.entity(menu).despawn();
            return;
        }

        // update data in the escape menu
        let direction = if keys.just_pressed(&key_map.reach_up) {
            Some(CompassOctant::North)
        } else if keys.just_pressed(&key_map.reach_down) {
            Some(CompassOctant::South)
        } else if keys.just_pressed(&key_map.reach_left) {
            Some(CompassOctant::West)
        } else if keys.just_pressed(&key_map.reach_right) {
            Some(CompassOctant::East)
        } else {
            None
        };

        if let (Some(direction), Some(current_focus)) = (direction, ui_focus_map.current_focus) {
            if let Some(next_focus) = ui_focus_map.get_next_entity(current_focus, direction) {
                ui_focus_map.current_focus = Some(next_focus);
                ui_focus_map.focus_visible = true;
            }
        }

        if keys.just_pressed(&key_map.get_ui_confirm_keys()) {
            if let Some(focused) = ui_focus_map.current_focus {
                if let Ok(button) = button_query.get(focused) {
                    info!("Focused option: {}", button.label);
                }
            }
        }
    } else {
        if toggle_menu_pressed {
            spawn_escape_menu(&mut commands);
        }
    }
}

#[derive(Component)]
pub struct EscapeMenu;

#[derive(Component)]
pub struct EscapeMenuButton {
    label: &'static str,
}

fn escape_menu() -> impl Bundle {
    let menu_background_color: Color = color_from_hex_alpha("#222222", 0.4);

    return (
        EscapeMenu,
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
    );
}

fn escape_menu_button(text: &'static str) -> impl Bundle {
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
        EscapeMenuButton { label: text },
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

fn spawn_escape_menu(commands: &mut Commands) -> Entity {
    let menu = commands.spawn(escape_menu()).id();
    let button_back = commands.spawn(escape_menu_button("Back to game")).id();
    let button_options = commands.spawn(escape_menu_button("Options...")).id();
    let button_save_quit = commands
        .spawn(escape_menu_button("Save and quit to title"))
        .id();

    commands
        .entity(menu)
        .add_children(&[button_back, button_options, button_save_quit]);

    let mut focus_map = UiFocusMap::default();
    let back_index = focus_map.add_node(button_back);
    let options_index = focus_map.add_node(button_options);
    let save_quit_index = focus_map.add_node(button_save_quit);

    focus_map.set_focus(back_index);
    focus_map.link(back_index, CompassOctant::South, options_index);
    focus_map.link(options_index, CompassOctant::North, back_index);
    focus_map.link(options_index, CompassOctant::South, save_quit_index);
    focus_map.link(save_quit_index, CompassOctant::North, options_index);

    commands.entity(menu).insert(focus_map);
    menu
}
