use bevy::math::CompassOctant;
use bevy::prelude::*;

use crate::resources::input_state::InputState;
use crate::resources::player_focus_state::PlayerFocusState;

use super::super::visual_utils::{color_from_hex, color_from_hex_alpha};
use super::menu_events::{MenuAction, MenuEvent};
use super::ui_focus_map::UiFocusMap;

pub fn handle_options_menu(
    mut commands: Commands,
    input_state: Res<InputState>,
    player_focus_state: ResMut<PlayerFocusState>,
    maybe_menu: Query<(Entity, &mut UiFocusMap, &mut Visibility), With<OptionsMenu>>,
    mut button_query: Query<(
        Entity,
        &MenuAction,
        &OptionsMenuButton,
        &mut BackgroundColor,
        &mut BorderColor,
    )>,
    mut menu_events: MessageWriter<MenuEvent>,
) {
    let toggle_menu_pressed = input_state.just_pressed(&input_state.exit_menu);

    let menu_entities: Vec<Entity> = maybe_menu.iter().map(|(entity, _, _)| entity).collect();
    let num_options_menus = menu_entities.len();
    if num_options_menus > 1 {
        for entity in menu_entities {
            commands.entity(entity).despawn();
        }
        return;
    }

    if let Ok((escape_menu, mut ui_focus_map, mut visibility)) = maybe_menu.single_inner() {
        let maybe_menu_index = player_focus_state.get_menu_index(escape_menu);

        if let Some(escape_menu_index) = maybe_menu_index {
            if player_focus_state.current_menu_index() != Some(escape_menu_index) {
                *visibility = Visibility::Hidden;
                ui_focus_map.focus_visible = false;
                return;
            }
            *visibility = Visibility::Visible;
            if ui_focus_map.current_focus.is_some() {
                ui_focus_map.focus_visible = true;
            }
        } else {
            *visibility = Visibility::Hidden;
            ui_focus_map.focus_visible = false;
            return;
        }

        if toggle_menu_pressed {
            menu_events.write(MenuEvent::CloseCurrentMenu);
            return;
        }

        process_options_menu(
            input_state.as_ref(),
            ui_focus_map.reborrow(),
            button_query.reborrow(),
            menu_events,
        );
    }
}

fn process_options_menu(
    input_state: &InputState,
    mut ui_focus_map: Mut<UiFocusMap>,
    mut button_query: Query<(
        Entity,
        &MenuAction,
        &OptionsMenuButton,
        &mut BackgroundColor,
        &mut BorderColor,
    )>,
    mut menu_events: MessageWriter<MenuEvent>,
) {
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

    if let (Some(selected_direction), Some(focused_entity)) =
        (ui_direction, ui_focus_map.current_focus)
        && let Some(next_entity_to_focus) =
            ui_focus_map.get_next_entity(focused_entity, selected_direction)
    {
        ui_focus_map.current_focus = Some(next_entity_to_focus);
        ui_focus_map.focus_visible = true;
    }

    let confirm_pressed = input_state.just_pressed(&input_state.groups.ui_confirm);
    let focused_entity = ui_focus_map.current_focus;
    for (entity, action, button, mut background_color, mut border_color) in &mut button_query {
        if confirm_pressed && Some(entity) == focused_entity {
            if matches!(action, MenuAction::CloseCurrentMenu) {
                menu_events.write(MenuEvent::CloseCurrentMenu);
            }
        }

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
pub struct OptionsMenu;

#[derive(Component)]
pub struct OptionsMenuButton {
    normal_background: Color,
    normal_border: Color,
    focus_background: Color,
    focus_border: Color,
}

fn make_options_menu() -> impl Bundle {
    let menu_background_color: Color = color_from_hex_alpha("#222222", 0.4);
    (
        OptionsMenu,
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

fn make_button(text: &'static str) -> impl Bundle {
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
        MenuAction::CloseCurrentMenu,
        OptionsMenuButton {
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

pub fn spawn_options_menu(commands: &mut Commands) -> Entity {
    let menu = commands.spawn(make_options_menu()).id();
    let button_video = commands.spawn(make_button("Video Settings...")).id();
    let button_controls = commands.spawn(make_button("Controls...")).id();
    let button_done = commands.spawn(make_button("Done")).id();
    commands
        .entity(menu)
        .add_children(&[button_video, button_controls, button_done]);

    let mut focus_map = UiFocusMap::default();
    let index_video = focus_map.add_node(button_video);
    let index_controls = focus_map.add_node(button_controls);
    let index_done = focus_map.add_node(button_done);

    focus_map.set_focus(index_video);
    focus_map.link(index_video, CompassOctant::North, index_done);
    focus_map.link(index_video, CompassOctant::South, index_controls);
    focus_map.link(index_controls, CompassOctant::North, index_video);
    focus_map.link(index_controls, CompassOctant::South, index_done);
    focus_map.link(index_done, CompassOctant::North, index_controls);
    focus_map.link(index_done, CompassOctant::South, index_video);

    commands.entity(menu).insert(focus_map);
    menu
}
