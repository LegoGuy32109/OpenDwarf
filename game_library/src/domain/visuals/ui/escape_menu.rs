use bevy::math::CompassOctant;
use bevy::prelude::*;

use crate::resources::player_focus_state::PlayerFocusState;

use super::super::visual_utils::{color_from_hex, color_from_hex_alpha};
use super::menu_events::MenuEvent;
use super::ui_focus_map::UiFocusMap;
use crate::resources::input_state::InputState;

pub fn handle_escape_menu(
    mut commands: Commands,
    input_state: Res<InputState>,
    mut player_focus_state: ResMut<PlayerFocusState>,
    maybe_menu: Query<(Entity, &mut UiFocusMap), With<EscapeMenu>>,
    button_query: Query<&EscapeMenuButton>,
    button_style_query: Query<(
        Entity,
        &EscapeMenuButton,
        &mut BackgroundColor,
        &mut BorderColor,
    )>,
    mut menu_events: MessageWriter<MenuEvent>,
) {
    let toggle_menu_pressed = input_state.just_pressed(&input_state.exit_menu);

    // if somehow multiple escape menus exist, delete all of them
    let menu_entities: Vec<Entity> = maybe_menu.iter().map(|(entity, _)| entity).collect();
    let num_escape_menus = menu_entities.len();
    if num_escape_menus > 1 {
        warn!("{num_escape_menus} escape menus found, deleting all");
        for entity in menu_entities {
            commands.entity(entity).despawn();
        }
        return;
    }

    if let Ok((menu, mut ui_focus_map)) = maybe_menu.single_inner() {
        let menu_index = player_focus_state.get_menu_index(menu);

        if let Some(index) = menu_index {
            // if menu isn't currently focused, don't bother
            if index == 0 {
                return;
            }
            // let top_index = player_focus_state.menu_stack.len().saturating_sub(1);
            // if index != top_index {
            //     return;
            // }
        } else {
            return;
        }

        if toggle_menu_pressed {
            menu_events.write(MenuEvent::CloseCurrentMenu);
            return;
        }

        process_escape_menu(
            input_state.as_ref(),
            ui_focus_map.reborrow(),
            button_query,
            button_style_query,
            menu_events,
        );
    } else if toggle_menu_pressed {
        let escape_menu = spawn_escape_menu(&mut commands);
        player_focus_state.push_new_menu(escape_menu);
        player_focus_state.within_system_menu = true;
    }
}

fn process_escape_menu(
    input_state: &InputState,
    mut ui_focus_map: Mut<UiFocusMap>,
    button_query: Query<&EscapeMenuButton>,
    mut button_style_query: Query<(
        Entity,
        &EscapeMenuButton,
        &mut BackgroundColor,
        &mut BorderColor,
    )>,
    mut menu_events: MessageWriter<MenuEvent>,
) {
    // determine which direction the user is selecting
    let ui_direction = if input_state.just_pressed(&input_state.groups.system_up) {
        Some(CompassOctant::North)
    } else if input_state.just_pressed(&input_state.groups.system_down) {
        Some(CompassOctant::South)
    } else if input_state.just_pressed(&input_state.groups.system_left) {
        Some(CompassOctant::West)
    } else if input_state.just_pressed(&input_state.groups.system_right) {
        Some(CompassOctant::East)
    } else {
        None
    };

    // set next element to be focused
    if let (Some(selected_direction), Some(focused_entity)) =
        (ui_direction, ui_focus_map.current_focus)
        && let Some(next_entity_to_focus) =
            ui_focus_map.get_next_entity(focused_entity, selected_direction)
    {
        ui_focus_map.current_focus = Some(next_entity_to_focus);
        // after the first movement make the focused button visible
        ui_focus_map.focus_visible = true;
    }

    // trigger action from selected element
    if input_state.just_pressed(&input_state.groups.ui_confirm)
        && let Some(focused) = ui_focus_map.current_focus
        && let Ok(button) = button_query.get(focused)
    {
        if let EscapeMenuAction::CloseMenu = button.action {
            menu_events.write(MenuEvent::CloseCurrentMenu);
        }
    }

    // change style of buttons if they are focused
    let focused_entity = ui_focus_map.current_focus;
    for (entity, button, mut background_color, mut border_color) in &mut button_style_query {
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
    action: EscapeMenuAction,
    normal_background: Color,
    normal_border: Color,
    focus_background: Color,
    focus_border: Color,
}

#[derive(Clone, Copy, Debug)]
pub enum EscapeMenuAction {
    CloseMenu,
    OpenOptions,
    SaveQuit,
}

fn make_escape_menu() -> impl Bundle {
    let menu_background_color: Color = color_from_hex_alpha("#222222", 0.4);
    (
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
    )
}

fn make_button(text: &'static str, action: EscapeMenuAction) -> impl Bundle {
    let button_color: Color = color_from_hex("#22213F");
    let button_border_color: Color = color_from_hex("#AFAFAB");
    let focus_button_color: Color = color_from_hex("#2B3D61");
    let focus_button_border_color: Color = color_from_hex("#E2D9D6");
    (
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
            action,
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
    )
}

fn spawn_escape_menu(commands: &mut Commands) -> Entity {
    // generate components
    let menu = commands.spawn(make_escape_menu()).id();
    let button_back = commands
        .spawn(make_button("Back to game", EscapeMenuAction::CloseMenu))
        .id();
    let button_options = commands
        .spawn(make_button("Options...", EscapeMenuAction::OpenOptions))
        .id();
    let button_save_quit = commands
        .spawn(make_button(
            "Save and quit to title",
            EscapeMenuAction::SaveQuit,
        ))
        .id();
    // nest child elements in root escape menu
    commands
        .entity(menu)
        .add_children(&[button_back, button_options, button_save_quit]);

    // create the ui flow representations
    let mut focus_map = UiFocusMap::default();
    let index_back = focus_map.add_node(button_back);
    let index_options = focus_map.add_node(button_options);
    let index_save_quit = focus_map.add_node(button_save_quit);

    // the first button focused is back to game
    focus_map.set_focus(index_back);
    // set ui directions in focus_map
    focus_map.link(index_back, CompassOctant::North, index_save_quit);
    focus_map.link(index_back, CompassOctant::South, index_options);
    focus_map.link(index_options, CompassOctant::North, index_back);
    focus_map.link(index_options, CompassOctant::South, index_save_quit);
    focus_map.link(index_save_quit, CompassOctant::North, index_options);
    focus_map.link(index_save_quit, CompassOctant::South, index_back);
    // attach focus map to escape menu to be accessed in handler
    commands.entity(menu).insert(focus_map);
    menu
}

pub fn escape_menu_stack_behavior(
    mut menu_query: Query<(Entity, &mut UiFocusMap, &mut Visibility), With<EscapeMenu>>,
    focus_state: Res<PlayerFocusState>,
) {
    let Ok((menu, mut focus_map, mut visibility)) = menu_query.single_mut() else {
        return;
    };

    let Some(index) = focus_state.get_menu_index(menu) else {
        *visibility = Visibility::Hidden;
        focus_map.focus_visible = false;
        return;
    };

    let top_index = focus_state.menu_stack.len().saturating_sub(1);
    if index == top_index {
        *visibility = Visibility::Visible;
        if focus_map.current_focus.is_some() {
            focus_map.focus_visible = true;
        }
    } else {
        *visibility = Visibility::Hidden;
        focus_map.focus_visible = false;
    }
}
