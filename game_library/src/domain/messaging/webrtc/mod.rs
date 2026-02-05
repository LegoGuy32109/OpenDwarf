#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

use bevy::prelude::{info, warn};
use serde::{Deserialize, Serialize};

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
    driver_active: bool,
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
            driver_active: false,
            #[cfg(target_arch = "wasm32")]
            generation: Rc::new(RefCell::new(GenerationFlags::default())),
            #[cfg(not(target_arch = "wasm32"))]
            generation: GenerationFlags::default(),
        }
    }
}

impl MultiplayerController {
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

    #[cfg(not(target_arch = "wasm32"))]
    pub fn drive(&mut self) {
        if !self.driver_active {
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
                        self.driver_active = true;
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
                let payload = match self.read_native_payload() {
                    Ok(payload) => payload,
                    Err(err) => {
                        warn!("Failed to read native answer payload: {err}");
                        return;
                    }
                };
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
                        self.driver_active = true;
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
                let manager = Rc::clone(&manager);
                spawn_local(async move {
                    let payload = match read_web_payload().await {
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
            MultiplayerAction::GenerateAnswerConnections => {
                {
                    let mut flags = generation.borrow_mut();
                    flags.answers_generating = true;
                    flags.answers_ready = false;
                }
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
        let text = match self.clipboard.read_text() {
            Ok(text) => text,
            Err(err) => {
                if let Some(fallback) = self.clipboard_text.as_ref() {
                    warn!("Falling back to buffered clipboard text: {err}");
                    fallback.clone()
                } else {
                    return Err(err);
                }
            }
        };
        let payload = decompress_remote_peers(&text)?;
        if payload.is_empty() {
            Err("Native clipboard payload was empty".to_string())
        } else {
            Ok(payload)
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
