#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

use bevy::prelude::{info, warn};
use bevy::time::{Timer, TimerMode};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[cfg(target_arch = "wasm32")]
use std::cell::RefCell;
#[cfg(target_arch = "wasm32")]
use std::rc::Rc;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen_futures::spawn_local;

use crate::domain::messaging::clipboard;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemotePeer {
    pub key: String,
    pub sdp: String,
}

#[derive(Debug, Clone)]
pub struct RtcIceServerConfig {
    pub urls: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct RtcConfig {
    pub ice_servers: Vec<RtcIceServerConfig>,
}

impl Default for RtcConfig {
    fn default() -> Self {
        Self {
            ice_servers: vec![RtcIceServerConfig {
                urls: vec![
                    "stun:stun1.l.google.com:19302".to_string(),
                    "stun:stun3.l.google.com:19302".to_string(),
                ],
            }],
        }
    }
}

pub fn default_rtc_config() -> RtcConfig {
    RtcConfig::default()
}

mod candidate_payload;

#[cfg(not(target_arch = "wasm32"))]
mod native_rtc;
#[cfg(target_arch = "wasm32")]
mod web_sys;

#[allow(unused_imports)]
pub use candidate_payload::{
    compress_and_log_payload, compress_remote_peers, decompress_remote_peers,
};

#[cfg(not(target_arch = "wasm32"))]
#[allow(unused_imports)]
pub use native_rtc::WebrtcManager;
#[cfg(target_arch = "wasm32")]
#[allow(unused_imports)]
pub use web_sys::WebrtcManager;

#[derive(Clone, Copy, Default)]
pub struct GenerationFlags {
    pub offers_generating: bool,
    pub answers_generating: bool,
    pub offers_ready: bool,
    pub answers_ready: bool,
}

#[derive(Debug, Clone, Copy)]
pub enum MultiplayerAction {
    GenerateConnections,
    CopyOfferPayload,
    AcceptAnswerPayload,
    GenerateAnswerConnections,
    CopyAnswerPayload,
}

pub struct MultiplayerController {
    #[cfg(target_arch = "wasm32")]
    manager: Option<Rc<RefCell<WebrtcManager>>>,
    #[cfg(not(target_arch = "wasm32"))]
    manager: Option<WebrtcManager>,
    #[cfg(not(target_arch = "wasm32"))]
    clipboard: clipboard::ClipboardState,
    clipboard_text: Option<String>,
    enabled: bool,
    menu_open: bool,
    started: bool,
    flow: MultiplayerFlow,
    guest_connected: bool,
    #[cfg(target_arch = "wasm32")]
    clipboard_scan: Rc<RefCell<ClipboardScanResult>>,
    #[cfg(not(target_arch = "wasm32"))]
    clipboard_scan: ClipboardScanResult,
    clipboard_scan_timer: Timer,
    #[cfg(target_arch = "wasm32")]
    generation: Rc<RefCell<GenerationFlags>>,
    #[cfg(not(target_arch = "wasm32"))]
    generation: GenerationFlags,
}

impl Default for MultiplayerController {
    fn default() -> Self {
        Self {
            #[cfg(target_arch = "wasm32")]
            manager: None,
            #[cfg(not(target_arch = "wasm32"))]
            manager: None,
            #[cfg(not(target_arch = "wasm32"))]
            clipboard: clipboard::ClipboardState::new(),
            clipboard_text: None,
            enabled: false,
            menu_open: false,
            started: false,
            flow: MultiplayerFlow::None,
            guest_connected: false,
            #[cfg(target_arch = "wasm32")]
            clipboard_scan: Rc::new(RefCell::new(ClipboardScanResult::default())),
            #[cfg(not(target_arch = "wasm32"))]
            clipboard_scan: ClipboardScanResult::default(),
            clipboard_scan_timer: Timer::from_seconds(0.5, TimerMode::Repeating),
            #[cfg(target_arch = "wasm32")]
            generation: Rc::new(RefCell::new(GenerationFlags::default())),
            #[cfg(not(target_arch = "wasm32"))]
            generation: GenerationFlags::default(),
        }
    }
}

impl MultiplayerController {
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    pub fn flow_state(&self) -> MultiplayerFlow {
        self.flow
    }

    pub fn guest_connected(&self) -> bool {
        self.guest_connected
    }

    pub fn generation_flags(&self) -> GenerationFlags {
        #[cfg(target_arch = "wasm32")]
        {
            *self.generation.borrow()
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.generation
        }
    }

    pub fn clipboard_scan(&self) -> ClipboardScanResult {
        #[cfg(target_arch = "wasm32")]
        {
            *self.clipboard_scan.borrow()
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.clipboard_scan
        }
    }

    pub fn sync_menu_presence(&mut self, menu_present: bool) -> MenuPresenceChange {
        let was_open = self.menu_open;
        if self.has_peers() {
            self.started = true;
            if self.flow == MultiplayerFlow::None {
                self.flow = if self.has_local_offers() {
                    MultiplayerFlow::Host
                } else {
                    MultiplayerFlow::Guest
                };
            }
        }
        self.menu_open = menu_present;
        if menu_present {
            self.enabled = true;
        } else if was_open && !self.should_remain_enabled() {
            self.enabled = false;
            self.started = false;
            self.flow = MultiplayerFlow::None;
            self.guest_connected = false;
            self.set_clipboard_scan(ClipboardScanResult::default());
        }

        match (was_open, menu_present) {
            (false, true) => MenuPresenceChange::Opened,
            (true, false) => MenuPresenceChange::Closed,
            _ => MenuPresenceChange::None,
        }
    }

    pub fn tick_clipboard_scan(&mut self, delta: Duration) {
        if !self.enabled {
            return;
        }
        self.clipboard_scan_timer.tick(delta);
        if self.clipboard_scan_timer.just_finished() {
            self.scan_clipboard();
        }
    }

    pub fn force_clipboard_scan(&mut self) {
        if !self.enabled {
            return;
        }
        self.clipboard_scan_timer.reset();
        self.scan_clipboard();
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn drive(&mut self) {
        if !self.enabled {
            return;
        }
        let offers_generating = self.generation.offers_generating;
        let answers_generating = self.generation.answers_generating;
        let (offers_ready, answers_ready, drive_result) = {
            let Some(manager) = self.manager.as_mut() else {
                return;
            };
            let drive_result = manager.drive_network();
            let offers_ready = manager.offers_ready();
            let answers_ready = manager.answers_ready();
            self.guest_connected = manager.guest_connected();
            (offers_ready, answers_ready, drive_result)
        };

        if let Err(err) = drive_result {
            warn!("Native WebRTC driver error: {err}");
        }
        if offers_generating && offers_ready {
            self.generation.offers_generating = false;
            self.generation.offers_ready = true;
        }
        if answers_generating && answers_ready {
            self.generation.answers_generating = false;
            self.generation.answers_ready = true;
        }
    }

    pub fn trigger_action(&mut self, action: MultiplayerAction) {
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.trigger_native_action(action);
        }
        #[cfg(target_arch = "wasm32")]
        {
            self.trigger_web_action(action);
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn trigger_native_action(&mut self, action: MultiplayerAction) {
        match action {
            MultiplayerAction::GenerateConnections => {
                self.generation.offers_generating = true;
                self.generation.offers_ready = false;
                self.flow = MultiplayerFlow::Host;
                self.guest_connected = false;

                let manager = match self.manager_mut() {
                    Ok(manager) => manager,
                    Err(err) => {
                        warn!("Failed to initialize native WebRTC manager: {err}");
                        self.generation.offers_generating = false;
                        return;
                    }
                };
                match manager.make_offering_peers(2) {
                    Ok(()) => {
                        self.enabled = true;
                        self.started = true;
                        info!("Native WebRTC offers generated");
                    }
                    Err(err) => {
                        self.generation.offers_generating = false;
                        warn!("Failed to generate native offers: {err}");
                    }
                }
            }
            MultiplayerAction::CopyOfferPayload => {
                let manager = match self.manager_mut() {
                    Ok(manager) => manager,
                    Err(err) => {
                        warn!("Failed to initialize native WebRTC manager: {err}");
                        return;
                    }
                };
                match manager.offer_payload() {
                    Ok(payload) => {
                        let text = compress_and_log_payload("Native offer", &payload);
                        if let Err(err) = self.clipboard.write_text(&text) {
                            warn!("Failed to copy native offer payload: {err}");
                            self.clipboard_text = Some(text);
                        } else {
                            info!("Native offer payload copied to clipboard");
                        }
                    }
                    Err(err) => warn!("Failed to get native offer payload: {err}"),
                }
            }
            MultiplayerAction::AcceptAnswerPayload => {
                self.flow = MultiplayerFlow::Host;
                let payload = match self.read_native_payload() {
                    Ok(payload) => payload,
                    Err(err) => {
                        warn!("Failed to read native answer payload: {err}");
                        self.clear_clipboard_payload();
                        return;
                    }
                };
                self.clear_clipboard_payload();
                let manager = match self.manager_mut() {
                    Ok(manager) => manager,
                    Err(err) => {
                        warn!("Failed to initialize native WebRTC manager: {err}");
                        return;
                    }
                };
                match manager.receive_answer_payload(&payload) {
                    Ok(()) => info!("Native answer payload accepted"),
                    Err(err) => warn!("Failed to accept native answer payload: {err}"),
                }
            }
            MultiplayerAction::GenerateAnswerConnections => {
                self.generation.answers_generating = true;
                self.generation.answers_ready = false;
                self.flow = MultiplayerFlow::Guest;
                self.guest_connected = false;

                let payload = match self.read_native_payload() {
                    Ok(payload) => payload,
                    Err(err) => {
                        warn!("Failed to read native offer payload: {err}");
                        self.generation.answers_generating = false;
                        return;
                    }
                };
                let manager = match self.manager_mut() {
                    Ok(manager) => manager,
                    Err(err) => {
                        warn!("Failed to initialize native WebRTC manager: {err}");
                        self.generation.answers_generating = false;
                        return;
                    }
                };
                match manager.make_guest_answers(&payload) {
                    Ok(()) => {
                        self.enabled = true;
                        self.started = true;
                        info!("Native WebRTC answers generated");
                    }
                    Err(err) => {
                        self.generation.answers_generating = false;
                        warn!("Failed to generate native answers: {err}");
                    }
                }
            }
            MultiplayerAction::CopyAnswerPayload => {
                let manager = match self.manager_mut() {
                    Ok(manager) => manager,
                    Err(err) => {
                        warn!("Failed to initialize native WebRTC manager: {err}");
                        return;
                    }
                };
                match manager.answer_payload() {
                    Ok(payload) => {
                        let text = compress_and_log_payload("Native answer", &payload);
                        if let Err(err) = self.clipboard.write_text(&text) {
                            warn!("Failed to copy native answer payload: {err}");
                            self.clipboard_text = Some(text);
                        } else {
                            info!("Native answer payload copied to clipboard");
                        }
                    }
                    Err(err) => warn!("Failed to get native answer payload: {err}"),
                }
            }
        }
    }

    #[cfg(target_arch = "wasm32")]
    fn trigger_web_action(&mut self, action: MultiplayerAction) {
        let generation = Rc::clone(&self.generation);
        let manager = match self.manager_rc() {
            Ok(manager) => manager,
            Err(err) => {
                warn!("Failed to initialize WebRTC manager: {err}");
                return;
            }
        };

        match action {
            MultiplayerAction::GenerateConnections => {
                {
                    let mut flags = generation.borrow_mut();
                    flags.offers_generating = true;
                    flags.offers_ready = false;
                }
                self.enabled = true;
                self.flow = MultiplayerFlow::Host;
                self.started = true;
                self.guest_connected = false;
                let manager = Rc::clone(&manager);
                let generation = Rc::clone(&generation);
                spawn_local(async move {
                    let result = manager.borrow_mut().make_offering_peers(2).await;
                    match result {
                        Ok(()) => {
                            let mut flags = generation.borrow_mut();
                            flags.offers_generating = false;
                            flags.offers_ready = true;
                            info!("WebRTC offers generated");
                        }
                        Err(err) => {
                            generation.borrow_mut().offers_generating = false;
                            warn!("Failed to generate offers: {err}");
                        }
                    }
                });
            }
            MultiplayerAction::CopyOfferPayload => {
                let manager = Rc::clone(&manager);
                spawn_local(async move {
                    let payload = manager.borrow().offer_payload();
                    match payload {
                        Ok(payload) => {
                            let text = compress_and_log_payload("Web offer", &payload);
                            if let Err(err) = clipboard::write_text(&text).await {
                                warn!("Failed to copy offer payload: {err}");
                            } else {
                                info!("Offer payload copied to clipboard");
                            }
                        }
                        Err(err) => warn!("Failed to get offer payload: {err}"),
                    }
                });
            }
            MultiplayerAction::AcceptAnswerPayload => {
                self.flow = MultiplayerFlow::Host;
                let manager = Rc::clone(&manager);
                spawn_local(async move {
                    let payload = match read_web_payload().await {
                        Ok(payload) => payload,
                        Err(err) => {
                            warn!("Failed to read answer payload: {err}");
                            let _ = clipboard::write_text("").await;
                            return;
                        }
                    };
                    let _ = clipboard::write_text("").await;
                    let result = manager.borrow_mut().receive_answer_payload(&payload).await;
                    match result {
                        Ok(()) => info!("Answer payload accepted"),
                        Err(err) => warn!("Failed to accept answer payload: {err}"),
                    }
                });
            }
            MultiplayerAction::GenerateAnswerConnections => {
                {
                    let mut flags = generation.borrow_mut();
                    flags.answers_generating = true;
                    flags.answers_ready = false;
                }
                self.enabled = true;
                self.flow = MultiplayerFlow::Guest;
                self.started = true;
                self.guest_connected = false;
                let manager = Rc::clone(&manager);
                let generation = Rc::clone(&generation);
                spawn_local(async move {
                    let payload = match read_web_payload().await {
                        Ok(payload) => payload,
                        Err(err) => {
                            generation.borrow_mut().answers_generating = false;
                            warn!("Failed to read offer payload: {err}");
                            return;
                        }
                    };
                    let result = manager.borrow_mut().make_guest_answers(&payload).await;
                    match result {
                        Ok(()) => {
                            let mut flags = generation.borrow_mut();
                            flags.answers_generating = false;
                            flags.answers_ready = true;
                            info!("WebRTC answers generated");
                        }
                        Err(err) => {
                            generation.borrow_mut().answers_generating = false;
                            warn!("Failed to generate answers: {err}");
                        }
                    }
                });
            }
            MultiplayerAction::CopyAnswerPayload => {
                let manager = Rc::clone(&manager);
                spawn_local(async move {
                    let payload = manager.borrow().answer_payload();
                    match payload {
                        Ok(payload) => {
                            let text = compress_and_log_payload("Web answer", &payload);
                            if let Err(err) = clipboard::write_text(&text).await {
                                warn!("Failed to copy answer payload: {err}");
                            } else {
                                info!("Answer payload copied to clipboard");
                            }
                        }
                        Err(err) => warn!("Failed to get answer payload: {err}"),
                    }
                });
            }
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn manager_mut(&mut self) -> Result<&mut WebrtcManager, String> {
        if self.manager.is_none() {
            self.manager = Some(WebrtcManager::new()?);
        }
        self.manager
            .as_mut()
            .ok_or_else(|| "WebRTC manager unavailable".to_string())
    }

    #[cfg(target_arch = "wasm32")]
    fn manager_rc(&mut self) -> Result<Rc<RefCell<WebrtcManager>>, String> {
        if let Some(manager) = self.manager.as_ref() {
            return Ok(Rc::clone(manager));
        }
        let manager = WebrtcManager::new()?;
        let manager = Rc::new(RefCell::new(manager));
        self.manager = Some(Rc::clone(&manager));
        Ok(manager)
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn read_native_payload(&mut self) -> Result<Vec<RemotePeer>, String> {
        let text = self.read_native_clipboard_text()?;
        let payload = decompress_remote_peers(&text)?;
        if payload.is_empty() {
            Err("Native clipboard payload was empty".to_string())
        } else {
            Ok(payload)
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn read_native_clipboard_text(&mut self) -> Result<String, String> {
        match self.clipboard.read_text() {
            Ok(text) => Ok(text),
            Err(err) => {
                if let Some(fallback) = self.clipboard_text.as_ref() {
                    warn!("Falling back to buffered clipboard text: {err}");
                    Ok(fallback.clone())
                } else {
                    Err(err)
                }
            }
        }
    }

    fn has_peers(&self) -> bool {
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.manager
                .as_ref()
                .map_or(false, |manager| manager.has_peers())
        }
        #[cfg(target_arch = "wasm32")]
        {
            self.manager
                .as_ref()
                .map_or(false, |manager| manager.borrow().has_peers())
        }
    }

    fn has_local_offers(&self) -> bool {
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.manager
                .as_ref()
                .map_or(false, |manager| manager.has_offers())
        }
        #[cfg(target_arch = "wasm32")]
        {
            self.manager
                .as_ref()
                .map_or(false, |manager| manager.borrow().has_offers())
        }
    }

    fn should_remain_enabled(&self) -> bool {
        self.started || self.has_peers()
    }

    fn scan_clipboard(&mut self) {
        self.set_clipboard_scan(ClipboardScanResult::default());
        #[cfg(not(target_arch = "wasm32"))]
        {
            let text = match self.read_native_clipboard_text() {
                Ok(text) => text,
                Err(_) => return,
            };
            if text.trim().is_empty() {
                return;
            }
            let payload = match decompress_remote_peers(&text) {
                Ok(payload) => payload,
                Err(_) => return,
            };
            if !is_valid_payload(&payload) {
                return;
            }
            match classify_payload(&payload).unwrap_or_else(|| {
                if self.has_local_offers() {
                    ClipboardPayloadKind::Answer
                } else {
                    ClipboardPayloadKind::Offer
                }
            }) {
                ClipboardPayloadKind::Offer => self.mark_clipboard_offer(),
                ClipboardPayloadKind::Answer => self.mark_clipboard_answer(),
            }
        }
        #[cfg(target_arch = "wasm32")]
        {
            let scan_store = Rc::clone(&self.clipboard_scan);
            let local_has_offers = self.has_local_offers();
            spawn_local(async move {
                let text = match clipboard::read_text().await {
                    Ok(text) => text,
                    Err(_) => return,
                };
                if text.trim().is_empty() {
                    return;
                }
                let payload = match decompress_remote_peers(&text) {
                    Ok(payload) => payload,
                    Err(_) => return,
                };
                if !is_valid_payload(&payload) {
                    return;
                }
                let kind = classify_payload(&payload).unwrap_or_else(|| {
                    if local_has_offers {
                        ClipboardPayloadKind::Answer
                    } else {
                        ClipboardPayloadKind::Offer
                    }
                });
                let mut scan = scan_store.borrow_mut();
                *scan = ClipboardScanResult::default();
                match kind {
                    ClipboardPayloadKind::Offer => scan.offer_available = true,
                    ClipboardPayloadKind::Answer => scan.answer_available = true,
                }
            });
        }
    }

    fn clear_clipboard_payload(&mut self) {
        self.set_clipboard_scan(ClipboardScanResult::default());
        #[cfg(not(target_arch = "wasm32"))]
        {
            if let Err(err) = self.clipboard.write_text("") {
                warn!("Failed to clear clipboard payload: {err}");
            }
            self.clipboard_text = None;
        }
        #[cfg(target_arch = "wasm32")]
        {
            spawn_local(async {
                let _ = clipboard::write_text("").await;
            });
        }
    }

    fn set_clipboard_scan(&mut self, value: ClipboardScanResult) {
        #[cfg(target_arch = "wasm32")]
        {
            *self.clipboard_scan.borrow_mut() = value;
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.clipboard_scan = value;
        }
    }

    fn mark_clipboard_offer(&mut self) {
        #[cfg(target_arch = "wasm32")]
        {
            let mut scan = self.clipboard_scan.borrow_mut();
            scan.offer_available = true;
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.clipboard_scan.offer_available = true;
        }
    }

    fn mark_clipboard_answer(&mut self) {
        #[cfg(target_arch = "wasm32")]
        {
            let mut scan = self.clipboard_scan.borrow_mut();
            scan.answer_available = true;
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.clipboard_scan.answer_available = true;
        }
    }
}

#[cfg(target_arch = "wasm32")]
async fn read_web_payload() -> Result<Vec<RemotePeer>, String> {
    let text = clipboard::read_text().await?;
    let payload = decompress_remote_peers(&text)?;
    if payload.is_empty() {
        Err("Clipboard payload was empty".to_string())
    } else {
        Ok(payload)
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ClipboardScanResult {
    pub offer_available: bool,
    pub answer_available: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuPresenceChange {
    Opened,
    Closed,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClipboardPayloadKind {
    Offer,
    Answer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MultiplayerFlow {
    #[default]
    None,
    Host,
    Guest,
}

fn classify_payload(payload: &[RemotePeer]) -> Option<ClipboardPayloadKind> {
    let mut saw_offer = false;
    let mut saw_answer = false;
    for peer in payload {
        if peer.sdp.contains("a=setup:actpass") {
            saw_offer = true;
        }
        if peer.sdp.contains("a=setup:active") || peer.sdp.contains("a=setup:passive") {
            saw_answer = true;
        }
    }
    match (saw_offer, saw_answer) {
        (true, false) => Some(ClipboardPayloadKind::Offer),
        (false, true) => Some(ClipboardPayloadKind::Answer),
        _ => None,
    }
}

fn is_valid_payload(payload: &[RemotePeer]) -> bool {
    !payload.is_empty()
        && payload
            .iter()
            .all(|peer| !peer.key.trim().is_empty() && !peer.sdp.trim().is_empty())
}
