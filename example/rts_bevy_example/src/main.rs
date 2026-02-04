use bevy::ecs::message::{Message, MessageReader, MessageWriter};
use bevy::input::ButtonInput;
use bevy::prelude::*;

mod clipboard;
mod multiplayer;
use multiplayer::{Multiplayer, MultiplayerPlugin, WebrtcManager};

const BUTTON_NORMAL: Color = Color::srgb(0.18, 0.19, 0.23);
const BUTTON_FOCUSED: Color = Color::srgb(0.28, 0.30, 0.38);
const BORDER_NORMAL: Color = Color::srgb(0.35, 0.36, 0.42);
const BORDER_FOCUSED: Color = Color::srgb(0.70, 0.72, 0.80);

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .add_message::<MenuActivate>()
        .init_resource::<MenuButtons>()
        .init_resource::<MenuState>()
        .insert_resource(WebrtcManager::new())
        .insert_resource(Multiplayer::Disabled)
        .add_plugins(MultiplayerPlugin)
        .add_systems(Startup, setup)
        .add_systems(
            Update,
            (
                menu_keyboard_navigation,
                menu_mouse_activation,
                menu_handle_activation,
                menu_status_label,
                menu_visuals,
            ),
        )
        .run();
}

#[derive(Clone, Copy, Debug)]
enum MenuAction {
    GenerateConnections,
    CopyOfferPayload,
    AcceptAnswerPayload,
    GenerateAnswersFromOffer,
    CopyAnswerPayload,
}

#[derive(Component, Clone, Copy, Debug)]
struct MenuButton {
    action: MenuAction,
}

#[derive(Component)]
struct StatusLabel;

#[derive(Message, Debug)]
struct MenuActivate {
    action: MenuAction,
}

#[derive(Resource, Default)]
struct MenuButtons {
    entities: Vec<Entity>,
}

#[derive(Resource, Default)]
struct MenuState {
    focused: usize,
}

fn setup(mut commands: Commands, mut menu: ResMut<MenuButtons>) {
    commands.spawn(Camera2d);

    let root = commands
        .spawn((
            Node {
                width: Val::Percent(100.0),
                height: Val::Percent(100.0),
                flex_direction: FlexDirection::Column,
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                row_gap: Val::Px(10.0),
                ..default()
            },
            BackgroundColor(Color::srgb(0.07, 0.08, 0.10)),
        ))
        .id();

    let items = [
        ("Generate Connections", MenuAction::GenerateConnections),
        ("Copy Offer Payload", MenuAction::CopyOfferPayload),
        ("Accept Answer Payload", MenuAction::AcceptAnswerPayload),
        (
            "Generate Answers from Offer",
            MenuAction::GenerateAnswersFromOffer,
        ),
        ("Copy Answer Payload", MenuAction::CopyAnswerPayload),
    ];

    let mut buttons = Vec::with_capacity(items.len());

    for (label, action) in items {
        let button = commands
            .spawn((
                Button,
                MenuButton { action },
                Node {
                    width: Val::Px(380.0),
                    height: Val::Px(56.0),
                    justify_content: JustifyContent::Center,
                    align_items: AlignItems::Center,
                    border: UiRect::all(Val::Px(2.0)),
                    ..default()
                },
                BorderColor::all(BORDER_NORMAL),
                BackgroundColor(BUTTON_NORMAL),
                children![(
                    Text::new(label),
                    TextFont::from_font_size(20.0),
                    TextColor(Color::srgb(0.92, 0.94, 0.98)),
                )],
            ))
            .id();
        buttons.push(button);
    }

    let status = commands
        .spawn((
            StatusLabel,
            Text::new("Idle"),
            TextFont::from_font_size(18.0),
            TextColor(Color::srgb(0.75, 0.78, 0.85)),
        ))
        .id();

    commands
        .entity(root)
        .add_children(&buttons)
        .add_child(status);
    menu.entities = buttons;
}

fn menu_keyboard_navigation(
    keys: Res<ButtonInput<KeyCode>>,
    menu: Res<MenuButtons>,
    mut state: ResMut<MenuState>,
    mut events: MessageWriter<MenuActivate>,
    buttons: Query<&MenuButton>,
) {
    if menu.entities.is_empty() {
        return;
    }

    let mut delta: i32 = 0;
    let up = keys.just_pressed(KeyCode::KeyI)
        || keys.just_pressed(KeyCode::KeyE)
        || keys.just_pressed(KeyCode::ArrowUp)
        || keys.just_pressed(KeyCode::KeyJ)
        || keys.just_pressed(KeyCode::KeyS)
        || keys.just_pressed(KeyCode::ArrowLeft);
    let down = keys.just_pressed(KeyCode::KeyK)
        || keys.just_pressed(KeyCode::KeyD)
        || keys.just_pressed(KeyCode::ArrowDown)
        || keys.just_pressed(KeyCode::KeyL)
        || keys.just_pressed(KeyCode::KeyF)
        || keys.just_pressed(KeyCode::ArrowRight);

    if up {
        delta -= 1;
    }
    if down {
        delta += 1;
    }

    if delta != 0 {
        let len = match isize::try_from(menu.entities.len()) {
            Ok(len) if len > 0 => len,
            _ => return,
        };
        let current = isize::try_from(state.focused).unwrap_or(0);
        let delta = isize::try_from(delta).unwrap_or(0);
        let next = (current + delta).rem_euclid(len);
        state.focused = usize::try_from(next).unwrap_or(0);
    }

    let activate = keys.just_pressed(KeyCode::Enter)
        || keys.just_pressed(KeyCode::NumpadEnter)
        || keys.just_pressed(KeyCode::Space);

    if activate
        && let Some(&entity) = menu.entities.get(state.focused)
        && let Ok(button) = buttons.get(entity)
    {
        events.write(MenuActivate {
            action: button.action,
        });
    }
}

fn menu_mouse_activation(
    mut interactions: Query<(Entity, &Interaction, &MenuButton), Changed<Interaction>>,
    menu: Res<MenuButtons>,
    mut state: ResMut<MenuState>,
    mut events: MessageWriter<MenuActivate>,
) {
    for (entity, interaction, button) in &mut interactions {
        if *interaction == Interaction::Pressed {
            if let Some(index) = menu.entities.iter().position(|&item| item == entity) {
                state.focused = index;
            }
            events.write(MenuActivate {
                action: button.action,
            });
        }
    }
}

fn menu_handle_activation(
    mut events: MessageReader<MenuActivate>,
    mut webrtc: ResMut<WebrtcManager>,
    mut multiplayer: ResMut<Multiplayer>,
) {
    for event in events.read() {
        match event.action {
            MenuAction::GenerateConnections => {
                *multiplayer = Multiplayer::Enabled;
                if let Err(err) = webrtc.generate_connections(1) {
                    error!("{err}");
                } else {
                    info!("Generating offer payload");
                }
            }
            MenuAction::CopyOfferPayload => {
                if let Err(err) = webrtc.copy_offer_payload() {
                    error!("{err}");
                } else {
                    info!("Offer payload copied to clipboard");
                }
            }
            MenuAction::AcceptAnswerPayload => {
                if let Err(err) = webrtc.accept_answer_from_clipboard() {
                    error!("{err}");
                } else {
                    info!("Accepted answer payload from clipboard");
                }
            }
            MenuAction::GenerateAnswersFromOffer => {
                *multiplayer = Multiplayer::Enabled;
                if let Err(err) = webrtc.generate_answers_from_clipboard() {
                    error!("{err}");
                } else {
                    info!("Generating answer payload from clipboard");
                }
            }
            MenuAction::CopyAnswerPayload => {
                if let Err(err) = webrtc.copy_answer_payload() {
                    error!("{err}");
                } else {
                    info!("Answer payload copied to clipboard");
                }
            }
        }
    }
}

fn menu_visuals(
    menu: Res<MenuButtons>,
    state: Res<MenuState>,
    mut query: Query<(Entity, &mut BackgroundColor, &mut BorderColor), With<MenuButton>>,
) {
    for (entity, mut background, mut border) in &mut query {
        if Some(&entity) == menu.entities.get(state.focused) {
            *background = BackgroundColor(BUTTON_FOCUSED);
            *border = BorderColor::all(BORDER_FOCUSED);
        } else {
            *background = BackgroundColor(BUTTON_NORMAL);
            *border = BorderColor::all(BORDER_NORMAL);
        }
    }
}

fn menu_status_label(webrtc: Res<WebrtcManager>, mut query: Query<&mut Text, With<StatusLabel>>) {
    let Ok(mut label) = query.single_mut() else {
        return;
    };

    let next_text = if webrtc.is_generating_offer() {
        "Generating offer payload..."
    } else if webrtc.is_generating_answer() {
        "Generating answer payload..."
    } else if webrtc.has_offer_payload() {
        "Offer payload ready - copy now"
    } else if webrtc.has_answer_payload() {
        "Answer payload ready - copy now"
    } else {
        "Idle"
    };

    *label = Text::new(next_text);
}
