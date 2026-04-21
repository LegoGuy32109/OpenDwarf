use bevy::input::ButtonState;
use bevy::input::keyboard::Key;
use bevy::prelude::*;
use bevy::text::{LineBreak, TextBounds, TextLayout, TextLayoutInfo};
use bevy::ui::UiSystems;

use crate::resources::game_mode::GameMode;
use crate::resources::input_state::{InputCommand, InputState};
use crate::resources::player_focus_state::PlayerFocusState;
use crate::resources::view_mode::ViewMode;

use super::super::chat_bubbles::ChatBubbleEvent;
use super::super::visual_utils::color_from_hex_alpha;
use super::menu_events::MenuEvent;

pub struct ChatMenuPlugin;

impl Plugin for ChatMenuPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(
            Update,
            (
                chat_menu_open_system,
                chat_menu_input_system.run_if(in_state(GameMode::Typing)),
                chat_menu_cursor_system,
                chat_menu_text_system,
            )
                .chain()
                .after(ApplyDeferred),
        )
        .add_systems(
            Update,
            (chat_menu_resize_system).chain().after(UiSystems::Layout),
        );
    }
}

/// Opens/closes the chat menu and manages visibility based on the menu stack.
fn chat_menu_open_system(
    mut commands: Commands,
    input_state: Res<InputState>,
    mut player_focus_state: ResMut<PlayerFocusState>,
    mut next_state: ResMut<NextState<GameMode>>,
    mut view_mode: ResMut<ViewMode>,
    mut menu_query: Query<(Entity, &mut Visibility), With<ChatMenu>>,
    text_query: Query<&ChatBuffer, With<ChatMenuText>>,
    mut menu_events: MessageWriter<MenuEvent>,
    mut chat_bubble_events: MessageWriter<ChatBubbleEvent>,
) {
    let open_pressed = input_state.command_triggered(InputCommand::ChatOpen);

    let chat_menu_entities: Vec<Entity> = menu_query.iter().map(|(entity, _)| entity).collect();
    let num_chat_menus = chat_menu_entities.len();
    if num_chat_menus > 1 {
        for entity in chat_menu_entities {
            commands.entity(entity).despawn();
        }
        return;
    }

    if let Ok((menu, mut visibility)) = menu_query.single_mut() {
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

        let exit_pressed = input_state.just_pressed(&input_state.chat_cancel);
        let return_pressed = input_state.just_pressed(&input_state.return_key);
        if exit_pressed || return_pressed {
            if return_pressed
                && let Ok(buffer) = text_query.single()
                && !buffer.0.is_empty()
            {
                let input = buffer.0.trim();
                // Check if this is a command (starts with /)
                if input.starts_with('/') {
                    handle_chat_command(input, &mut view_mode);
                } else {
                    chat_bubble_events.write(ChatBubbleEvent::from_chat_input(input));
                }
            }
            next_state.set(GameMode::World);
            menu_events.write(MenuEvent::CloseCurrentMenu);
        }
    } else if open_pressed && player_focus_state.menu_stack.is_empty() {
        let chat_menu = spawn_chat_menu(&mut commands);
        player_focus_state.push_new_menu(chat_menu);
        next_state.set(GameMode::Typing);
    }
}

/// Processes keyboard input into the chat buffer and menu actions.
fn chat_menu_input_system(
    input_state: Res<InputState>,
    player_focus_state: Res<PlayerFocusState>,
    mut text_query: Query<&mut ChatBuffer, With<ChatMenuText>>,
    menu_query: Query<Entity, With<ChatMenu>>,
    mut menu_events: MessageWriter<MenuEvent>,
) {
    let Ok(menu) = menu_query.single() else {
        return;
    };
    if !player_focus_state.is_menu_focused(menu) {
        return;
    }

    if input_state.command_triggered(InputCommand::ClearAllMenus) {
        menu_events.write(MenuEvent::ClearAllMenus);
        return;
    }

    let Ok(mut buffer) = text_query.single_mut() else {
        return;
    };

    let ctrl_pressed = input_state.ctrl_pressed();
    let shift_pressed = input_state.shift_pressed();

    for event in input_state.key_events() {
        if event.state == ButtonState::Released {
            continue;
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
}

/// Toggles the blinking cursor based on the timer.
fn chat_menu_cursor_system(time: Res<Time>, mut cursor_query: Query<&mut CursorBlink>) {
    for mut cursor in &mut cursor_query {
        if cursor.timer.tick(time.delta()).just_finished() {
            cursor.visible = !cursor.visible;
        }
    }
}

/// Updates the visible chat text and placeholder display.
fn chat_menu_text_system(
    mut text_query: Query<(&ChatBuffer, &CursorBlink, &mut Text), With<ChatMenuText>>,
    mut placeholder_query: Query<&mut Visibility, With<ChatPlaceholderText>>,
) {
    let Ok((buffer, cursor, mut text)) = text_query.single_mut() else {
        return;
    };
    let Ok(mut placeholder_visibility) = placeholder_query.single_mut() else {
        return;
    };

    let cursor_char = if cursor.visible { "_" } else { " " };
    if buffer.0.is_empty() {
        *placeholder_visibility = Visibility::Visible;
        text.0 = cursor_char.to_string();
    } else {
        *placeholder_visibility = Visibility::Hidden;
        text.0 = format!("{}{}", buffer.0, cursor_char);
    }
}

/// Resizes the chat menu to fit wrapped text lines.
fn chat_menu_resize_system(
    text_query: Query<(&ChatBuffer, &TextLayoutInfo), With<ChatMenuText>>,
    placeholder_query: Query<&TextLayoutInfo, With<ChatPlaceholderText>>,
    mut container_query: Query<&mut Node, (With<ChatTextContainer>, Without<ChatMenu>)>,
    mut menu_query: Query<&mut Node, (With<ChatMenu>, Without<ChatTextContainer>)>,
) {
    let Ok((buffer, text_layout)) = text_query.single() else {
        return;
    };
    let Ok(placeholder_layout) = placeholder_query.single() else {
        return;
    };

    let visible_height = if buffer.0.is_empty() {
        placeholder_layout.size.y
    } else {
        text_layout.size.y
    };
    let text_height = visible_height.max(CHAT_MIN_TEXT_HEIGHT);
    if let Ok(mut container_node) = container_query.single_mut() {
        container_node.height = Val::Px(text_height.ceil());
    }
    let menu_height = text_height + CHAT_BOX_PADDING * 2.0;
    if let Ok(mut menu_node) = menu_query.single_mut() {
        menu_node.height = Val::Px(menu_height.ceil());
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
const CHAT_MIN_TEXT_HEIGHT: f32 = 22.0;
const CHAT_BOX_PADDING: f32 = 12.0;

fn make_chat_menu() -> impl Bundle {
    let menu_background_color: Color = color_from_hex_alpha("#2C2C2C", 0.65);
    (
        ChatMenu,
        Node {
            height: px(CHAT_MIN_TEXT_HEIGHT + CHAT_BOX_PADDING * 2.0),
            position_type: PositionType::Absolute,
            left: px(20.0),
            right: px(20.0),
            bottom: px(18.0),
            justify_content: JustifyContent::FlexStart,
            align_items: AlignItems::Center,
            padding: UiRect::all(px(CHAT_BOX_PADDING)),
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
        TextLayout::new_with_linebreak(LineBreak::WordOrCharacter),
        TextBounds::UNBOUNDED,
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
        TextLayout::new_with_linebreak(LineBreak::WordOrCharacter),
        TextBounds::UNBOUNDED,
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
            height: Val::Auto,
            position_type: PositionType::Relative,
            justify_content: JustifyContent::FlexStart,
            align_items: AlignItems::Center,
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

/// Handle chat commands (commands starting with /).
fn handle_chat_command(input: &str, view_mode: &mut ViewMode) {
    let command = input.trim_start_matches('/').to_lowercase();

    match command.as_str() {
        "master" => {
            *view_mode = ViewMode::Master;
        }
        "entity" => {
            *view_mode = ViewMode::Entity;
        }
        _ => {
            // Unknown command, silently ignore
        }
    }
}
