use bevy::math::CompassOctant;
use bevy::prelude::*;

#[cfg(target_arch = "wasm32")]
use std::cell::RefCell;
#[cfg(target_arch = "wasm32")]
use std::rc::Rc;

use crate::resources::input_state::InputState;
use crate::resources::player_focus_state::PlayerFocusState;

#[cfg(target_arch = "wasm32")]
use crate::domain::messaging::webrtc::{
    RemotePeer, WebrtcManager, compress_remote_peers, decompress_remote_peers,
};

use super::super::visual_utils::{color_from_hex, color_from_hex_alpha};
use super::menu_events::MenuEvent;
use super::ui_focus_map::UiFocusMap;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::JsValue;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_futures::JsFuture;
#[cfg(target_arch = "wasm32")]
use web_sys::{Clipboard, Navigator};

#[cfg(target_arch = "wasm32")]
pub struct MultiplayerWebrtcState {
    manager: Option<Rc<RefCell<WebrtcManager>>>,
}

#[cfg(target_arch = "wasm32")]
impl Default for MultiplayerWebrtcState {
    fn default() -> Self {
        Self { manager: None }
    }
}

#[cfg(target_arch = "wasm32")]
impl MultiplayerWebrtcState {
    fn manager_rc(&mut self) -> Result<Rc<RefCell<WebrtcManager>>, String> {
        if let Some(manager) = self.manager.as_ref() {
            return Ok(Rc::clone(manager));
        }

        let manager = WebrtcManager::new()?;
        let manager = Rc::new(RefCell::new(manager));
        self.manager = Some(Rc::clone(&manager));
        Ok(manager)
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Default)]
pub struct MultiplayerWebrtcState;

pub fn handle_multiplayer_menu(
    mut commands: Commands,
    input_state: Res<InputState>,
    player_focus_state: ResMut<PlayerFocusState>,
    mut webrtc_state: NonSendMut<MultiplayerWebrtcState>,
    maybe_menu: Query<(Entity, &mut UiFocusMap, &mut Visibility), With<MultiplayerMenu>>,
    mut button_query: Query<(
        Entity,
        &MultiplayerMenuAction,
        &MultiplayerMenuButton,
        &mut BackgroundColor,
        &mut BorderColor,
    )>,
    mut menu_events: MessageWriter<MenuEvent>,
) {
    let toggle_menu_pressed = input_state.just_pressed(&input_state.exit_menu);

    let menu_entities: Vec<Entity> = maybe_menu.iter().map(|(entity, _, _)| entity).collect();
    let num_menus = menu_entities.len();
    if num_menus > 1 {
        for entity in menu_entities {
            commands.entity(entity).despawn();
        }
        return;
    }

    if let Ok((menu, mut ui_focus_map, mut visibility)) = maybe_menu.single_inner() {
        let maybe_menu_index = player_focus_state.get_menu_index(menu);

        if let Some(menu_index) = maybe_menu_index {
            if player_focus_state.current_menu_index() != Some(menu_index) {
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

        process_multiplayer_menu(
            input_state.as_ref(),
            ui_focus_map.reborrow(),
            button_query.reborrow(),
            menu_events,
            &mut *webrtc_state,
        );
    }
}

fn process_multiplayer_menu(
    input_state: &InputState,
    mut ui_focus_map: Mut<UiFocusMap>,
    mut button_query: Query<(
        Entity,
        &MultiplayerMenuAction,
        &MultiplayerMenuButton,
        &mut BackgroundColor,
        &mut BorderColor,
    )>,
    mut menu_events: MessageWriter<MenuEvent>,
    webrtc_state: &mut MultiplayerWebrtcState,
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
            match action {
                MultiplayerMenuAction::Back => {
                    menu_events.write(MenuEvent::CloseCurrentMenu);
                }
                MultiplayerMenuAction::GenerateConnections
                | MultiplayerMenuAction::CopyOfferPayload
                | MultiplayerMenuAction::AcceptAnswerPayload
                | MultiplayerMenuAction::GenerateAnswerConnections
                | MultiplayerMenuAction::CopyAnswerPayload
                | MultiplayerMenuAction::Configure => {
                    trigger_multiplayer_action(*action, webrtc_state);
                }
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
pub struct MultiplayerMenu;

#[derive(Component, Debug, Clone, Copy)]
pub enum MultiplayerMenuAction {
    GenerateConnections,
    CopyOfferPayload,
    AcceptAnswerPayload,
    GenerateAnswerConnections,
    CopyAnswerPayload,
    Configure,
    Back,
}

#[derive(Component)]
pub struct MultiplayerMenuButton {
    normal_background: Color,
    normal_border: Color,
    focus_background: Color,
    focus_border: Color,
}

fn trigger_multiplayer_action(
    action: MultiplayerMenuAction,
    webrtc_state: &mut MultiplayerWebrtcState,
) {
    #[cfg(not(target_arch = "wasm32"))]
    {
        info!("Multiplayer action selected: {action:?}");
        let _ = webrtc_state;
    }

    #[cfg(target_arch = "wasm32")]
    {
        use wasm_bindgen_futures::spawn_local;
        let manager = match webrtc_state.manager_rc() {
            Ok(manager) => manager,
            Err(err) => {
                warn!("Failed to initialize WebRTC manager: {err}");
                return;
            }
        };

        match action {
            MultiplayerMenuAction::GenerateConnections => {
                let manager = Rc::clone(&manager);
                spawn_local(async move {
                    let result = manager.borrow_mut().make_offering_peers(2).await;
                    match result {
                        Ok(()) => info!("WebRTC offers generated"),
                        Err(err) => warn!("Failed to generate offers: {err}"),
                    }
                });
            }
            MultiplayerMenuAction::CopyOfferPayload => {
                let manager = Rc::clone(&manager);
                spawn_local(async move {
                    let payload = manager.borrow().offer_payload();
                    match payload {
                        Ok(payload) => {
                            let text = compress_remote_peers(&payload);
                            if let Err(err) = write_clipboard(&text).await {
                                warn!("Failed to copy offer payload: {err}");
                            } else {
                                info!("Offer payload copied to clipboard");
                            }
                        }
                        Err(err) => warn!("Failed to get offer payload: {err}"),
                    }
                });
            }
            MultiplayerMenuAction::AcceptAnswerPayload => {
                let manager = Rc::clone(&manager);
                spawn_local(async move {
                    let payload = match read_clipboard_payload().await {
                        Ok(payload) => payload,
                        Err(err) => {
                            warn!("Failed to read answer payload: {err}");
                            return;
                        }
                    };
                    let result = manager.borrow_mut().receive_answer_payload(&payload).await;
                    match result {
                        Ok(()) => info!("Answer payload accepted"),
                        Err(err) => warn!("Failed to accept answer payload: {err}"),
                    }
                });
            }
            MultiplayerMenuAction::GenerateAnswerConnections => {
                let manager = Rc::clone(&manager);
                spawn_local(async move {
                    let payload = match read_clipboard_payload().await {
                        Ok(payload) => payload,
                        Err(err) => {
                            warn!("Failed to read offer payload: {err}");
                            return;
                        }
                    };
                    let result = manager.borrow_mut().make_guest_answers(&payload).await;
                    match result {
                        Ok(()) => info!("WebRTC answers generated"),
                        Err(err) => warn!("Failed to generate answers: {err}"),
                    }
                });
            }
            MultiplayerMenuAction::CopyAnswerPayload => {
                let manager = Rc::clone(&manager);
                spawn_local(async move {
                    let payload = manager.borrow().answer_payload();
                    match payload {
                        Ok(payload) => {
                            let text = compress_remote_peers(&payload);
                            if let Err(err) = write_clipboard(&text).await {
                                warn!("Failed to copy answer payload: {err}");
                            } else {
                                info!("Answer payload copied to clipboard");
                            }
                        }
                        Err(err) => warn!("Failed to get answer payload: {err}"),
                    }
                });
            }
            MultiplayerMenuAction::Configure | MultiplayerMenuAction::Back => {}
        }
    }
}

#[cfg(target_arch = "wasm32")]
async fn read_clipboard_payload() -> Result<Vec<RemotePeer>, String> {
    let text = read_clipboard().await?;
    let payload = decompress_remote_peers(&text)?;
    if payload.is_empty() {
        Err("Clipboard payload was empty".to_string())
    } else {
        Ok(payload)
    }
}

#[cfg(target_arch = "wasm32")]
async fn read_clipboard() -> Result<String, String> {
    let window = web_sys::window().ok_or_else(|| "No window available".to_string())?;
    let navigator: Navigator = window.navigator();
    let clipboard: Clipboard = navigator.clipboard();
    let future = JsFuture::from(clipboard.read_text());
    let value = future.await.map_err(js_to_string)?;
    value
        .as_string()
        .ok_or_else(|| "Clipboard read did not return text".to_string())
}

#[cfg(target_arch = "wasm32")]
async fn write_clipboard(text: &str) -> Result<(), String> {
    let window = web_sys::window().ok_or_else(|| "No window available".to_string())?;
    let navigator: Navigator = window.navigator();
    let clipboard: Clipboard = navigator.clipboard();
    let future = JsFuture::from(clipboard.write_text(text));
    future.await.map_err(js_to_string)?;
    Ok(())
}

#[cfg(target_arch = "wasm32")]
fn js_to_string(err: impl Into<JsValue>) -> String {
    let value: JsValue = err.into();
    value.as_string().unwrap_or_else(|| format!("{value:?}"))
}

fn make_multiplayer_menu() -> impl Bundle {
    let menu_background_color: Color = color_from_hex_alpha("#111114", 0.6);
    (
        MultiplayerMenu,
        Node {
            width: percent(100.),
            height: percent(100.),
            justify_content: JustifyContent::FlexEnd,
            align_items: AlignItems::Stretch,
            ..default()
        },
        BackgroundColor(menu_background_color),
    )
}

fn make_panel() -> impl Bundle {
    let panel_color: Color = color_from_hex("#1F1F22");
    (
        Node {
            width: percent(38.),
            min_width: px(320),
            height: percent(100.),
            flex_direction: FlexDirection::Column,
            row_gap: px(14),
            padding: UiRect::all(px(18)),
            ..default()
        },
        BackgroundColor(panel_color),
    )
}

fn make_section_label(text: &'static str) -> impl Bundle {
    (
        Text::new(text),
        TextFont {
            font_size: 18.0,
            ..default()
        },
        TextColor(Color::WHITE),
    )
}

fn make_hint(text: &'static str) -> impl Bundle {
    (
        Text::new(text),
        TextFont {
            font_size: 14.0,
            ..default()
        },
        TextColor(color_from_hex("#A6A7AB")),
    )
}

fn make_button(text: &'static str, action: MultiplayerMenuAction) -> impl Bundle {
    let button_color: Color = color_from_hex("#22213F");
    let button_border_color: Color = color_from_hex("#AFAFAB");
    let focus_button_color: Color = color_from_hex("#2B3D61");
    let focus_button_border_color: Color = color_from_hex("#E2D9D6");
    (
        Node {
            width: percent(100.),
            height: px(56),
            border: UiRect::all(px(2)),
            justify_content: JustifyContent::Center,
            align_items: AlignItems::Center,
            ..default()
        },
        BackgroundColor(button_color),
        BorderColor::all(button_border_color),
        action,
        MultiplayerMenuButton {
            normal_background: button_color,
            normal_border: button_border_color,
            focus_background: focus_button_color,
            focus_border: focus_button_border_color,
        },
        children![(
            Text::new(text),
            TextFont {
                font_size: 18.0,
                ..default()
            },
            TextColor(Color::WHITE),
        ),],
    )
}

fn make_divider() -> impl Bundle {
    (
        Node {
            width: percent(100.),
            height: px(2),
            ..default()
        },
        BackgroundColor(color_from_hex("#4E4F54")),
    )
}

pub fn spawn_multiplayer_menu(commands: &mut Commands) -> Entity {
    let menu = commands.spawn(make_multiplayer_menu()).id();
    let panel = commands.spawn(make_panel()).id();

    let title = commands
        .spawn((
            Text::new("Multiplayer"),
            TextFont {
                font_size: 26.0,
                ..default()
            },
            TextColor(Color::WHITE),
        ))
        .id();

    let label_host = commands.spawn(make_section_label("Create a Room")).id();
    let button_generate = commands
        .spawn(make_button(
            "Generate Connections",
            MultiplayerMenuAction::GenerateConnections,
        ))
        .id();
    let button_copy_offer = commands
        .spawn(make_button(
            "Copy Offer Payload",
            MultiplayerMenuAction::CopyOfferPayload,
        ))
        .id();
    let button_accept_answer = commands
        .spawn(make_button(
            "Accept Answer Payload",
            MultiplayerMenuAction::AcceptAnswerPayload,
        ))
        .id();

    let divider = commands.spawn(make_divider()).id();

    let label_join = commands.spawn(make_section_label("Join a Room")).id();
    let button_generate_answers = commands
        .spawn(make_button(
            "Generate Answer Connections",
            MultiplayerMenuAction::GenerateAnswerConnections,
        ))
        .id();
    let button_copy_answer = commands
        .spawn(make_button(
            "Copy Answer Payload",
            MultiplayerMenuAction::CopyAnswerPayload,
        ))
        .id();

    let divider_config = commands.spawn(make_divider()).id();
    let button_config = commands
        .spawn(make_button(
            "Configure WebRTC",
            MultiplayerMenuAction::Configure,
        ))
        .id();

    let hint = commands
        .spawn(make_hint(
            "Use a TURN server for symmetric NAT or hidden IPs.",
        ))
        .id();

    let button_back = commands
        .spawn(make_button("Back", MultiplayerMenuAction::Back))
        .id();

    commands.entity(panel).add_children(&[
        title,
        label_host,
        button_generate,
        button_copy_offer,
        button_accept_answer,
        divider,
        label_join,
        button_generate_answers,
        button_copy_answer,
        divider_config,
        button_config,
        hint,
        button_back,
    ]);

    commands.entity(menu).add_child(panel);

    let mut focus_map = UiFocusMap::default();
    let index_generate = focus_map.add_node(button_generate);
    let index_copy_offer = focus_map.add_node(button_copy_offer);
    let index_accept_answer = focus_map.add_node(button_accept_answer);
    let index_generate_answers = focus_map.add_node(button_generate_answers);
    let index_copy_answer = focus_map.add_node(button_copy_answer);
    let index_config = focus_map.add_node(button_config);
    let index_back = focus_map.add_node(button_back);

    focus_map.set_focus(index_generate);
    focus_map.link(index_generate, CompassOctant::South, index_copy_offer);
    focus_map.link(index_copy_offer, CompassOctant::North, index_generate);
    focus_map.link(index_copy_offer, CompassOctant::South, index_accept_answer);
    focus_map.link(index_accept_answer, CompassOctant::North, index_copy_offer);
    focus_map.link(
        index_accept_answer,
        CompassOctant::South,
        index_generate_answers,
    );
    focus_map.link(
        index_generate_answers,
        CompassOctant::North,
        index_accept_answer,
    );
    focus_map.link(
        index_generate_answers,
        CompassOctant::South,
        index_copy_answer,
    );
    focus_map.link(
        index_copy_answer,
        CompassOctant::North,
        index_generate_answers,
    );
    focus_map.link(index_copy_answer, CompassOctant::South, index_config);
    focus_map.link(index_config, CompassOctant::North, index_copy_answer);
    focus_map.link(index_config, CompassOctant::South, index_back);
    focus_map.link(index_back, CompassOctant::North, index_config);
    focus_map.link(index_back, CompassOctant::South, index_generate);
    focus_map.link(index_generate, CompassOctant::North, index_back);

    commands.entity(menu).insert(focus_map);
    menu
}
