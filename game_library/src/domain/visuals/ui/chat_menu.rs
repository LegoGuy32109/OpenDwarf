use bevy::input::ButtonState;
use bevy::input::keyboard::{Key, KeyboardInput};
use bevy::prelude::*;

use crate::resources::input_state::InputState;
use crate::resources::player_focus_state::PlayerFocusState;

use super::super::visual_utils::color_from_hex_alpha;
use super::menu_events::MenuEvent;

type MenuBundle<'a> = (Entity, &'a mut Visibility);
type MenuQueryBundle = (With<ChatMenu>, Without<ChatPlaceholderText>);

pub fn handle_chat_menu(
    mut commands: Commands,
    mut key_events: MessageReader<KeyboardInput>,
    mut menu_events: MessageWriter<MenuEvent>,
    mut resources: ParamSet<((
        ResMut<PlayerFocusState>,
        Res<ButtonInput<KeyCode>>,
        Res<InputState>,
        Res<Time>,
    ),)>,
    mut queries: ParamSet<((
        Query<MenuBundle, MenuQueryBundle>,
        Query<(&mut Text, &mut ChatBuffer, &mut CursorBlink), With<ChatMenuText>>,
        Query<&mut Visibility, (With<ChatPlaceholderText>, Without<ChatMenu>)>,
    ),)>,
) {
    let (mut player_focus_state, keyboard_input, input_state, time) = resources.p0();
    let (maybe_menu, mut text_query, mut placeholder_query) = queries.p0();

    let open_pressed = keyboard_input.just_pressed(KeyCode::KeyT);

    let menu_entities: Vec<Entity> = maybe_menu.iter().map(|(entity, _)| entity).collect();
    let num_chat_menus = menu_entities.len();
    if num_chat_menus > 1 {
        for entity in menu_entities {
            commands.entity(entity).despawn();
        }
        return;
    }

    if let Ok((menu, mut visibility)) = maybe_menu.single_inner() {
        let menu_index = player_focus_state.get_menu_index(menu);
        if let Some(index) = menu_index {
            if player_focus_state.current_menu_index() != Some(index) {
                *visibility = Visibility::Hidden;
                return;
            }
            *visibility = Visibility::Visible;
        } else {
            *visibility = Visibility::Hidden;
            return;
        }

        let exit_pressed = keyboard_input.just_pressed(KeyCode::Escape);
        let return_pressed = input_state.just_pressed(&input_state.return_key);

        if exit_pressed || return_pressed {
            if return_pressed
                && let Ok((_, buffer, _)) = text_query.single()
                && !buffer.0.is_empty()
            {
                info!("Chat: {}", buffer.0);
            }
            player_focus_state.typing = false;
            menu_events.write(MenuEvent::CloseCurrentMenu);
            return;
        }

        if let (Ok((mut text, mut buffer, mut cursor)), Ok(mut placeholder_visibility)) =
            (text_query.single_mut(), placeholder_query.single_mut())
        {
            let ctrl_pressed = keyboard_input.pressed(KeyCode::ControlLeft)
                || keyboard_input.pressed(KeyCode::ControlRight);
            let shift_pressed = keyboard_input.pressed(KeyCode::ShiftLeft)
                || keyboard_input.pressed(KeyCode::ShiftRight);
            for event in key_events.read() {
                // skip released events
                if event.state == ButtonState::Released {
                    continue;
                }
                if ctrl_pressed && input_state.just_pressed(&input_state.clear_menu) {
                    buffer.0.clear();
                    menu_events.write(MenuEvent::ClearAllMenus);
                    return;
                }
                match &event.logical_key {
                    Key::Character(value) => {
                        if !value.is_empty() {
                            buffer.0.push_str(value);
                        }
                    }
                    Key::Space => {
                        buffer.0.push(' ');
                    }
                    Key::Backspace => {
                        if ctrl_pressed && shift_pressed {
                            buffer.0.clear();
                        } else if ctrl_pressed || shift_pressed {
                            delete_last_word(&mut buffer.0);
                        } else {
                            buffer.0.pop();
                        }
                    }
                    _ => {}
                }
            }

            if cursor.timer.tick(time.delta()).just_finished() {
                cursor.visible = !cursor.visible;
            }
            let cursor_char = if cursor.visible { "_" } else { "" };
            if buffer.0.is_empty() {
                *placeholder_visibility = Visibility::Visible;
                text.0 = cursor_char.to_string();
            } else {
                *placeholder_visibility = Visibility::Hidden;
                text.0 = format!("{}{}", buffer.0, cursor_char);
            }
        }
    } else if open_pressed && player_focus_state.menu_stack.is_empty() {
        let chat_menu = spawn_chat_menu(&mut commands);
        player_focus_state.push_new_menu(chat_menu);
        player_focus_state.typing = true;
    }
}

#[derive(Component)]
pub struct ChatMenu;

#[derive(Component)]
pub struct ChatMenuText;

#[derive(Component)]
pub struct ChatPlaceholderText;

#[derive(Component)]
pub struct ChatTextContainer;

#[derive(Component)]
pub struct ChatBuffer(pub String);

#[derive(Component)]
pub struct CursorBlink {
    pub timer: Timer,
    pub visible: bool,
}

const CHAT_PLACEHOLDER: &str = "Ctrl + Q to cancel";

fn make_chat_menu() -> impl Bundle {
    let menu_background_color: Color = color_from_hex_alpha("#2C2C2C", 0.65);
    (
        ChatMenu,
        Node {
            height: px(48.0),
            position_type: PositionType::Absolute,
            left: px(20.0),
            right: px(20.0),
            bottom: px(18.0),
            justify_content: JustifyContent::FlexStart,
            align_items: AlignItems::Center,
            ..default()
        },
        BackgroundColor(menu_background_color),
    )
}

fn make_chat_text() -> impl Bundle {
    (
        ChatMenuText,
        Node {
            position_type: PositionType::Absolute,
            left: px(0.0),
            top: px(0.0),
            bottom: px(0.0),
            ..default()
        },
        ChatBuffer(String::new()),
        CursorBlink {
            timer: Timer::from_seconds(0.5, TimerMode::Repeating),
            visible: true,
        },
        Text::new(""),
        TextFont {
            font_size: 22.0,
            ..default()
        },
        TextColor(Color::WHITE),
    )
}

fn make_chat_placeholder() -> impl Bundle {
    (
        ChatPlaceholderText,
        Node {
            position_type: PositionType::Absolute,
            left: px(0.0),
            top: px(0.0),
            bottom: px(0.0),
            ..default()
        },
        Text::new(CHAT_PLACEHOLDER),
        TextFont {
            font_size: 22.0,
            ..default()
        },
        TextColor(Color::srgba(0.85, 0.85, 0.85, 0.8)),
    )
}

fn make_chat_text_container() -> impl Bundle {
    (
        ChatTextContainer,
        Node {
            width: percent(100.0),
            height: percent(50.0),
            position_type: PositionType::Relative,
            margin: UiRect::horizontal(px(10.0)),
            ..default()
        },
    )
}

fn spawn_chat_menu(commands: &mut Commands) -> Entity {
    let menu = commands.spawn(make_chat_menu()).id();
    let container = commands.spawn(make_chat_text_container()).id();
    let text = commands.spawn(make_chat_text()).id();
    let placeholder = commands.spawn(make_chat_placeholder()).id();
    commands
        .entity(container)
        .add_children(&[text, placeholder]);
    commands.entity(menu).add_children(&[container]);
    menu
}

fn delete_last_word(buffer: &mut String) {
    let trimmed = buffer.trim_end_matches(' ');
    if trimmed.is_empty() {
        buffer.clear();
        return;
    }
    let mut split_index = None;
    for (idx, ch) in trimmed.char_indices() {
        if ch.is_whitespace() {
            split_index = Some(idx);
        }
    }
    match split_index {
        Some(idx) => {
            let mut new_value = trimmed[..=idx].to_string();
            if !new_value.ends_with(' ') {
                new_value.push(' ');
            }
            *buffer = new_value;
        }
        None => {
            buffer.clear();
        }
    }
}
