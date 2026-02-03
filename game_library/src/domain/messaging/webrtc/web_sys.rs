use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use js_sys::{Array, Function, Promise, Reflect};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use web_sys::{
    Crypto, Event, MessageEvent, RtcConfiguration, RtcDataChannel, RtcDataChannelInit,
    RtcIceGatheringState, RtcIceServer, RtcPeerConnection, RtcSdpType, RtcSessionDescriptionInit,
    Window, console,
};

use super::RemotePeer;

#[derive(Debug)]
struct Peer {
    key: String,
    peer_connection: RtcPeerConnection,
    channels: Vec<RtcDataChannel>,
    event_handlers: Vec<Closure<dyn FnMut(Event)>>,
    message_handlers: Vec<Closure<dyn FnMut(MessageEvent)>>,
}

impl Peer {
    fn new(key: String, peer_connection: RtcPeerConnection) -> Self {
        Self {
            key,
            peer_connection,
            channels: Vec::new(),
            event_handlers: Vec::new(),
            message_handlers: Vec::new(),
        }
    }
}

pub struct WebrtcManager {
    peer_connection_config: RtcConfiguration,
    offering_peers: HashMap<String, Peer>,
    answering_peers: HashMap<String, Peer>,
}

impl WebrtcManager {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            peer_connection_config: default_rtc_config()?,
            offering_peers: HashMap::new(),
            answering_peers: HashMap::new(),
        })
    }

    pub async fn make_offering_peers(&mut self, num_peers: usize) -> Result<(), String> {
        for peer in self.offering_peers.values() {
            peer.peer_connection.close();
        }
        self.offering_peers.clear();

        for _ in 0..num_peers {
            let peer = make_offering_peer(&self.peer_connection_config).await?;
            self.offering_peers.insert(peer.key.clone(), peer);
        }

        Ok(())
    }

    pub fn offer_payload(&self) -> Result<Vec<RemotePeer>, String> {
        let mut payload = Vec::new();
        for peer in self.offering_peers.values() {
            if let Some(description) = peer.peer_connection.local_description() {
                let sdp = description.sdp();
                if !sdp.is_empty() {
                    payload.push(RemotePeer {
                        key: peer.key.clone(),
                        sdp,
                        candidates: Vec::new(),
                    });
                }
            }
        }

        if payload.is_empty() {
            return Err("No Local Offers exist".to_string());
        }
        Ok(payload)
    }

    pub async fn make_guest_answers(&mut self, remote_peers: &[RemotePeer]) -> Result<(), String> {
        for peer in self.answering_peers.values() {
            peer.peer_connection.close();
        }
        self.answering_peers.clear();

        if remote_peers.is_empty() {
            return Err("No remote peers given".to_string());
        }

        for remote_peer in remote_peers {
            let peer = make_answering_peer(&self.peer_connection_config, remote_peer).await?;
            let key = random_uuid()?;
            self.answering_peers.insert(key, peer);
        }

        Ok(())
    }

    pub fn answer_payload(&self) -> Result<Vec<RemotePeer>, String> {
        let mut payload = Vec::new();
        for peer in self.answering_peers.values() {
            if let Some(description) = peer.peer_connection.local_description() {
                let sdp = description.sdp();
                if !sdp.is_empty() {
                    payload.push(RemotePeer {
                        key: peer.key.clone(),
                        sdp,
                        candidates: Vec::new(),
                    });
                }
            }
        }

        if payload.is_empty() {
            return Err("No Local Answers exist".to_string());
        }
        Ok(payload)
    }

    pub async fn receive_answer_payload(
        &mut self,
        remote_peers: &[RemotePeer],
    ) -> Result<(), String> {
        if remote_peers.is_empty() {
            return Err("No remote peers given".to_string());
        }

        if self.offering_peers.is_empty() {
            return Err("No Local Offers exist".to_string());
        }

        let remote_keys: Vec<&str> = remote_peers.iter().map(|peer| peer.key.as_str()).collect();
        let mut open_peer: Option<&mut Peer> = None;
        for (key, peer) in self.offering_peers.iter_mut() {
            if peer.peer_connection.remote_description().is_none()
                && remote_keys.iter().any(|remote_key| remote_key == key)
            {
                open_peer = Some(peer);
                break;
            }
        }

        let open_peer = open_peer.ok_or_else(|| "No Open Offers exist".to_string())?;
        let remote_peer = remote_peers
            .iter()
            .find(|peer| peer.key == open_peer.key)
            .ok_or_else(|| "Remote Peer filtering invalid, BUG".to_string())?;

        let answer = RtcSessionDescriptionInit::new(RtcSdpType::Answer);
        answer.set_sdp(&remote_peer.sdp);
        JsFuture::from(open_peer.peer_connection.set_remote_description(&answer))
            .await
            .map_err(js_to_string)?;

        Ok(())
    }
}

async fn make_offering_peer(config: &RtcConfiguration) -> Result<Peer, String> {
    let peer_connection =
        RtcPeerConnection::new_with_configuration(config).map_err(js_to_string)?;
    let key = random_uuid()?;
    let mut peer = Peer::new(key, peer_connection);

    let channel_config = RtcDataChannelInit::new();
    channel_config.set_negotiated(true);
    channel_config.set_id(0);
    let channel = peer
        .peer_connection
        .create_data_channel_with_data_channel_dict("chat", &channel_config);
    setup_data_channel_handlers(&mut peer, &channel);
    peer.channels.push(channel);

    let offer_value = JsFuture::from(peer.peer_connection.create_offer())
        .await
        .map_err(js_to_string)?;
    let offer_sdp = sdp_from_js(offer_value)?;
    let offer = RtcSessionDescriptionInit::new(RtcSdpType::Offer);
    offer.set_sdp(&offer_sdp);
    JsFuture::from(peer.peer_connection.set_local_description(&offer))
        .await
        .map_err(js_to_string)?;

    wait_for_ice_gathering(&mut peer, 5).await?;

    Ok(peer)
}

async fn make_answering_peer(
    config: &RtcConfiguration,
    remote_peer: &RemotePeer,
) -> Result<Peer, String> {
    let peer_connection =
        RtcPeerConnection::new_with_configuration(config).map_err(js_to_string)?;
    let mut peer = Peer::new(remote_peer.key.clone(), peer_connection);

    let offer = RtcSessionDescriptionInit::new(RtcSdpType::Offer);
    offer.set_sdp(&remote_peer.sdp);
    JsFuture::from(peer.peer_connection.set_remote_description(&offer))
        .await
        .map_err(js_to_string)?;

    let channel_config = RtcDataChannelInit::new();
    channel_config.set_negotiated(true);
    channel_config.set_id(0);
    let channel = peer
        .peer_connection
        .create_data_channel_with_data_channel_dict("chat", &channel_config);
    setup_data_channel_handlers(&mut peer, &channel);
    peer.channels.push(channel);

    let answer_value = JsFuture::from(peer.peer_connection.create_answer())
        .await
        .map_err(js_to_string)?;
    let answer_sdp = sdp_from_js(answer_value)?;
    let answer = RtcSessionDescriptionInit::new(RtcSdpType::Answer);
    answer.set_sdp(&answer_sdp);
    JsFuture::from(peer.peer_connection.set_local_description(&answer))
        .await
        .map_err(js_to_string)?;

    wait_for_ice_gathering(&mut peer, 5).await?;

    Ok(peer)
}

fn setup_data_channel_handlers(peer: &mut Peer, channel: &RtcDataChannel) {
    let open_handler = Closure::wrap(Box::new(move |_event: Event| {
        console::log_1(&JsValue::from_str("Channel was opened"));
    }) as Box<dyn FnMut(_)>);
    channel.set_onopen(Some(open_handler.as_ref().unchecked_ref()));
    peer.event_handlers.push(open_handler);

    let message_handler = Closure::wrap(Box::new(move |event: MessageEvent| {
        console::log_1(&JsValue::from_str("received message from Guest"));
        console::log_1(&event.data());
    }) as Box<dyn FnMut(_)>);
    channel.set_onmessage(Some(message_handler.as_ref().unchecked_ref()));
    peer.message_handlers.push(message_handler);
}

async fn wait_for_ice_gathering(peer: &mut Peer, timeout_secs: u32) -> Result<(), String> {
    if peer.peer_connection.ice_gathering_state() == RtcIceGatheringState::Complete {
        return Ok(());
    }

    let promise = ice_gathering_promise(&peer.peer_connection, timeout_secs)?;
    JsFuture::from(promise).await.map_err(js_to_string)?;
    Ok(())
}

fn ice_gathering_promise(
    peer_connection: &RtcPeerConnection,
    timeout_secs: u32,
) -> Result<Promise, String> {
    let peer_connection = peer_connection.clone();
    let window = web_sys::window().ok_or_else(|| "No window available".to_string())?;
    Ok(Promise::new(&mut |resolve: Function, reject: Function| {
        let done = Rc::new(RefCell::new(false));
        let done_on_event = Rc::clone(&done);
        let resolve_on_event = resolve.clone();
        let pc_on_event = peer_connection.clone();
        let on_state_change = Closure::wrap(Box::new(move |_event: Event| {
            if pc_on_event.ice_gathering_state() == RtcIceGatheringState::Complete
                && !*done_on_event.borrow()
            {
                *done_on_event.borrow_mut() = true;
                let _ = resolve_on_event.call0(&JsValue::NULL);
            }
        }) as Box<dyn FnMut(_)>);
        peer_connection
            .set_onicegatheringstatechange(Some(on_state_change.as_ref().unchecked_ref()));
        on_state_change.forget();

        let done_on_timeout = Rc::clone(&done);
        let reject_on_timeout = reject.clone();
        let timeout_closure = Closure::wrap(Box::new(move || {
            if !*done_on_timeout.borrow() {
                *done_on_timeout.borrow_mut() = true;
                let _ = reject_on_timeout.call1(
                    &JsValue::NULL,
                    &JsValue::from_str("Failed gathering ICE candidates before timeout"),
                );
            }
        }) as Box<dyn FnMut()>);
        let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(
            timeout_closure.as_ref().unchecked_ref(),
            (timeout_secs * 1000) as i32,
        );
        timeout_closure.forget();
    }))
}

fn default_rtc_config() -> Result<RtcConfiguration, String> {
    let config = RtcConfiguration::new();
    let ice_server = RtcIceServer::new();
    let urls = Array::new();
    urls.push(&JsValue::from_str("stun:stun1.l.google.com:19302"));
    urls.push(&JsValue::from_str("stun:stun3.l.google.com:19302"));
    ice_server.set_urls(&urls.into());
    let ice_servers = Array::new();
    ice_servers.push(&ice_server);
    config.set_ice_servers(&ice_servers.into());
    Ok(config)
}

fn random_uuid() -> Result<String, String> {
    let window: Window = web_sys::window().ok_or_else(|| "No window available".to_string())?;
    let crypto: Crypto = window.crypto().map_err(js_to_string)?;
    Ok(crypto.random_uuid())
}

fn js_to_string(err: impl Into<JsValue>) -> String {
    let value: JsValue = err.into();
    value.as_string().unwrap_or_else(|| format!("{value:?}"))
}

fn sdp_from_js(value: JsValue) -> Result<String, String> {
    let sdp = Reflect::get(&value, &JsValue::from_str("sdp")).map_err(js_to_string)?;
    sdp.as_string()
        .ok_or_else(|| "WebRTC offer/answer missing sdp".to_string())
}
