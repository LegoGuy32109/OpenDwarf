use bevy::math::CompassOctant;
use bevy::prelude::*;

use super::super::visual_utils::{color_from_hex, color_from_hex_alpha};
use super::key_map::KeyMap;
use super::key_map::KeyMapChecker;
use super::ui_focus_map::UiFocusMap;

pub fn handle_escape_menu(
    mut commands: Commands,
    key_map: Res<KeyMap>,
    keyboard_input: Res<ButtonInput<KeyCode>>,
    maybe_menu: Query<(Entity, &mut UiFocusMap), With<EscapeMenu>>,
    button_query: Query<&EscapeMenuButton>,
    button_style_query: Query<(
        Entity,
        &EscapeMenuButton,
        &mut BackgroundColor,
        &mut BorderColor,
    )>,
) {
    let keys = KeyMap::get_keys(&keyboard_input);
    let toggle_menu_pressed = keys.just_pressed(&key_map.escape_menu);

    if let Ok((menu, mut ui_focus_map)) = maybe_menu.single_inner() {
        if toggle_menu_pressed {
            commands.entity(menu).despawn();
            return;
        }

        process_escape_menu(
            keys,
            key_map,
            ui_focus_map.reborrow(),
            button_query,
            button_style_query,
        );
    } else {
        if toggle_menu_pressed {
            spawn_escape_menu(&mut commands);
        }
    }
}

fn process_escape_menu(
    keys: KeyMapChecker,
    key_map: Res<KeyMap>,
    mut ui_focus_map: Mut<UiFocusMap>,
    button_query: Query<&EscapeMenuButton>,
    mut button_style_query: Query<(
        Entity,
        &EscapeMenuButton,
        &mut BackgroundColor,
        &mut BorderColor,
    )>,
) {
    // determine which direction the user is selecting
    let ui_direction = if keys.just_pressed(&key_map.reach_up) {
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

    // set next element to be focused
    if let (Some(selected_direction), Some(focused_entity)) =
        (ui_direction, ui_focus_map.current_focus)
    {
        if let Some(next_entity_to_focus) =
            ui_focus_map.get_next_entity(focused_entity, selected_direction)
        {
            ui_focus_map.current_focus = Some(next_entity_to_focus);
            // after the first movement make the focused button visible
            ui_focus_map.focus_visible = true;
        }
    }

    // trigger action from selected element
    if keys.just_pressed(&key_map.get_ui_confirm_keys()) {
        if let Some(focused) = ui_focus_map.current_focus {
            if let Ok(button) = button_query.get(focused) {
                info!("Focused option: {}", button.label);
            }
        }
    }

    // change style of buttons if they are focused
    let focused_entity = ui_focus_map.current_focus;
    for (entity, button, mut background_color, mut border_color) in button_style_query.iter_mut() {
        let (bg, bd) = if ui_focus_map.focus_visible && Some(entity) == focused_entity {
            (button.focus_background, button.focus_border)
        } else {
            (button.normal_background, button.normal_border)
        };
        *background_color = BackgroundColor(bg);
        *border_color = BorderColor::all(bd);
    }
}

#[derive(Component)]
pub struct EscapeMenu;

#[derive(Component)]
pub struct EscapeMenuButton {
    label: &'static str,
    normal_background: Color,
    normal_border: Color,
    focus_background: Color,
    focus_border: Color,
}

fn make_escape_menu() -> impl Bundle {
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

fn make_button(text: &'static str) -> impl Bundle {
    let button_color: Color = color_from_hex("#22213F");
    let button_border_color: Color = color_from_hex("#AFAFAB");
    let focus_button_color: Color = color_from_hex("#2B3D61");
    let focus_button_border_color: Color = color_from_hex("#E2D9D6");

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
        EscapeMenuButton {
            label: text,
            normal_background: button_color,
            normal_border: button_border_color,
            focus_background: focus_button_color,
            focus_border: focus_button_border_color,
        },
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
    let menu = commands.spawn(make_escape_menu()).id();
    let button_back = commands.spawn(make_button("Back to game")).id();
    let button_options = commands.spawn(make_button("Options...")).id();
    let button_save_quit = commands.spawn(make_button("Save and quit to title")).id();

    commands
        .entity(menu)
        .add_children(&[button_back, button_options, button_save_quit]);

    let mut focus_map = UiFocusMap::default();
    let back_index = focus_map.add_node(button_back);
    let options_index = focus_map.add_node(button_options);
    let save_quit_index = focus_map.add_node(button_save_quit);

    focus_map.set_focus(back_index);
    // set ui directions in focus_map
    focus_map.link(back_index, CompassOctant::North, save_quit_index);
    focus_map.link(back_index, CompassOctant::South, options_index);
    focus_map.link(options_index, CompassOctant::North, back_index);
    focus_map.link(options_index, CompassOctant::South, save_quit_index);
    focus_map.link(save_quit_index, CompassOctant::North, options_index);
    focus_map.link(save_quit_index, CompassOctant::South, back_index);

    commands.entity(menu).insert(focus_map);
    menu
}
