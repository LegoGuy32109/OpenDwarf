use bevy::math::CompassOctant;
use bevy::prelude::*;

use crate::resources::player_focus_state::PlayerFocusState;

use super::super::visual_utils::{color_from_hex, color_from_hex_alpha};
use super::menu_events::{MenuAction, MenuEvent};
use super::ui_focus_map::UiFocusMap;
use crate::domain::messaging::webrtc::MultiplayerController;
use crate::resources::input_state::InputState;

pub fn handle_escape_menu(
    mut commands: Commands,
    input_state: Res<InputState>,
    mut player_focus_state: ResMut<PlayerFocusState>,
    webrtc_state: NonSend<MultiplayerController>,
    maybe_escape_menu: Query<(Entity, &mut UiFocusMap, &mut Visibility), With<EscapeMenu>>,
    button_query: Query<(
        Entity,
        &MenuAction,
        &EscapeMenuButtonStyle,
        &mut BackgroundColor,
        &mut BorderColor,
    )>,
    mut indicator_query: Query<
        &mut Visibility,
        (With<MultiplayerStatusIndicator>, Without<EscapeMenu>),
    >,
    mut menu_events: MessageWriter<MenuEvent>,
) {
    if player_focus_state.typing {
        return;
    }

    let toggle_menu_pressed = input_state.just_pressed(&input_state.exit_menu);

    // if somehow multiple escape menus exist, delete all of them
    let escape_menu_entities: Vec<Entity> = maybe_escape_menu
        .iter()
        .map(|(entity, _, _)| entity)
        .collect();
    let num_escape_menus = escape_menu_entities.len();
    if num_escape_menus > 1 {
        warn!("{num_escape_menus} escape menus found, deleting all");
        for entity in escape_menu_entities {
            commands.entity(entity).despawn();
        }
        return;
    }

    if let Ok((menu, mut ui_focus_map, mut visibility)) = maybe_escape_menu.single_inner() {
        let menu_index = player_focus_state.get_menu_index(menu);

        if let Some(index) = menu_index {
            if player_focus_state.current_menu_index() != Some(index) {
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

        let indicator_visibility = if webrtc_state.is_enabled() {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };
        for mut visibility in &mut indicator_query {
            *visibility = indicator_visibility;
        }

        process_escape_menu(
            input_state.as_ref(),
            ui_focus_map.reborrow(),
            button_query,
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
    mut button_query: Query<(
        Entity,
        &MenuAction,
        &EscapeMenuButtonStyle,
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

    let confirm_pressed = input_state.just_pressed(&input_state.groups.ui_confirm);
    let focused_entity = ui_focus_map.current_focus;
    for (entity, action, button, mut background_color, mut border_color) in &mut button_query {
        // trigger action from selected element
        if confirm_pressed && Some(entity) == focused_entity {
            match action {
                MenuAction::CloseCurrentMenu => {
                    menu_events.write(MenuEvent::CloseCurrentMenu);
                }
                MenuAction::OpenOptions => {
                    menu_events.write(MenuEvent::OpenOptionsMenu);
                }
                MenuAction::OpenMultiplayer => {
                    menu_events.write(MenuEvent::OpenMultiplayerMenu);
                }
            }
        }

        // change style of buttons if they are focused
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
pub struct EscapeMenuButtonStyle {
    normal_background: Color,
    normal_border: Color,
    focus_background: Color,
    focus_border: Color,
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

fn make_button(text: &'static str, action: MenuAction) -> impl Bundle {
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
        action,
        EscapeMenuButtonStyle {
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

#[derive(Component)]
pub(crate) struct MultiplayerStatusIndicator;

fn spawn_escape_menu(commands: &mut Commands) -> Entity {
    // generate components
    let menu = commands.spawn(make_escape_menu()).id();
    let button_back = commands
        .spawn(make_button("Back to game", MenuAction::CloseCurrentMenu))
        .id();
    let button_options = commands
        .spawn(make_button("Options", MenuAction::OpenOptions))
        .id();
    let button_multiplayer = commands
        .spawn(make_button("Multiplayer", MenuAction::OpenMultiplayer))
        .id();
    let multiplayer_indicator = commands
        .spawn((
            MultiplayerStatusIndicator,
            Node {
                width: px(10),
                height: px(10),
                position_type: PositionType::Absolute,
                top: px(10),
                right: px(12),
                border_radius: BorderRadius::all(px(999.)),
                ..default()
            },
            BackgroundColor(color_from_hex("#53D06C")),
            Visibility::Hidden,
        ))
        .id();
    let button_save_quit = commands
        .spawn(make_button(
            "Save and quit to title",
            MenuAction::CloseCurrentMenu,
        ))
        .id();
    // nest child elements in root escape menu
    commands.entity(menu).add_children(&[
        button_back,
        button_multiplayer,
        button_options,
        button_save_quit,
    ]);
    commands
        .entity(button_multiplayer)
        .add_child(multiplayer_indicator);

    // create the ui flow representations
    let mut focus_map = UiFocusMap::default();
    let index_back = focus_map.add_node(button_back);
    let index_multiplayer = focus_map.add_node(button_multiplayer);
    let index_options = focus_map.add_node(button_options);
    let index_save_quit = focus_map.add_node(button_save_quit);

    // the first button focused is back to game
    focus_map.set_focus(index_back);
    // set ui directions in focus_map
    focus_map.link(index_back, CompassOctant::North, index_save_quit);
    focus_map.link(index_back, CompassOctant::South, index_multiplayer);
    focus_map.link(index_multiplayer, CompassOctant::North, index_back);
    focus_map.link(index_multiplayer, CompassOctant::South, index_options);
    focus_map.link(index_options, CompassOctant::North, index_multiplayer);
    focus_map.link(index_options, CompassOctant::South, index_save_quit);
    focus_map.link(index_save_quit, CompassOctant::North, index_options);
    focus_map.link(index_save_quit, CompassOctant::South, index_back);
    // attach focus map to escape menu to be accessed in handler
    commands.entity(menu).insert(focus_map);
    menu
}
