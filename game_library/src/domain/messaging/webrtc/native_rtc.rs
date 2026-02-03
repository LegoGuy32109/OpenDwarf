#![allow(dead_code)]

use std::collections::HashMap;
use std::io;
use std::net::UdpSocket;
use std::time::{Duration, Instant};

use bevy::prelude::info;
use bytes::BytesMut;
use rtc::data_channel::RTCDataChannelInit;
use rtc::peer_connection::RTCPeerConnection;
use rtc::peer_connection::configuration::RTCConfigurationBuilder;
use rtc::peer_connection::event::{RTCDataChannelEvent, RTCPeerConnectionEvent};
use rtc::peer_connection::message::RTCMessage;
use rtc::peer_connection::sdp::RTCSessionDescription;
use rtc::peer_connection::state::RTCIceGatheringState;
use rtc::peer_connection::transport::RTCIceServer;
use rtc::peer_connection::transport::{
    CandidateConfig, CandidateHostConfig, RTCIceCandidate, RTCIceCandidateInit,
};
use rtc::sansio::Protocol;
use shared::{TaggedBytesMut, TransportContext, TransportProtocol};

use super::RemotePeer;

struct Peer {
    key: String,
    peer_connection: RTCPeerConnection,
    _socket: UdpSocket,
    ice_gathering_complete: bool,
    ice_gathering_started_at: Option<Instant>,
    local_candidates: Vec<String>,
}

impl Peer {
    fn new(key: String, peer_connection: RTCPeerConnection, socket: UdpSocket) -> Self {
        Self {
            key,
            peer_connection,
            _socket: socket,
            ice_gathering_complete: false,
            ice_gathering_started_at: Some(Instant::now()),
            local_candidates: Vec::new(),
        }
    }
}

pub struct WebrtcManager {
    offering_peers: HashMap<String, Peer>,
    answering_peers: HashMap<String, Peer>,
}

impl WebrtcManager {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            offering_peers: HashMap::new(),
            answering_peers: HashMap::new(),
        })
    }

    pub fn make_offering_peers(&mut self, num_peers: usize) -> Result<(), String> {
        self.offering_peers.clear();

        for _ in 0..num_peers {
            let peer = make_offering_peer()?;
            self.offering_peers.insert(peer.key.clone(), peer);
        }

        Ok(())
    }

    pub fn offer_payload(&self) -> Result<Vec<RemotePeer>, String> {
        if !self.offers_ready() {
            return Err("ICE gathering not complete for offers".to_string());
        }
        let mut payload = Vec::new();
        for peer in self.offering_peers.values() {
            if let Some(description) = peer.peer_connection.local_description() {
                if !description.sdp.is_empty() {
                    payload.push(RemotePeer {
                        key: peer.key.clone(),
                        sdp: description.sdp.clone(),
                        candidates: peer.local_candidates.clone(),
                    });
                }
            }
        }

        if payload.is_empty() {
            return Err("No Local Offers exist".to_string());
        }
        Ok(payload)
    }

    pub fn make_guest_answers(&mut self, remote_peers: &[RemotePeer]) -> Result<(), String> {
        self.answering_peers.clear();

        if remote_peers.is_empty() {
            return Err("No remote peers given".to_string());
        }

        for remote_peer in remote_peers {
            let peer = make_answering_peer(remote_peer)?;
            let key = random_key();
            self.answering_peers.insert(key, peer);
        }

        Ok(())
    }

    pub fn answer_payload(&self) -> Result<Vec<RemotePeer>, String> {
        if !self.answers_ready() {
            return Err("ICE gathering not complete for answers".to_string());
        }
        let mut payload = Vec::new();
        for peer in self.answering_peers.values() {
            if let Some(description) = peer.peer_connection.local_description() {
                if !description.sdp.is_empty() {
                    payload.push(RemotePeer {
                        key: peer.key.clone(),
                        sdp: description.sdp.clone(),
                        candidates: peer.local_candidates.clone(),
                    });
                }
            }
        }

        if payload.is_empty() {
            return Err("No Local Answers exist".to_string());
        }
        Ok(payload)
    }

    pub fn receive_answer_payload(&mut self, remote_peers: &[RemotePeer]) -> Result<(), String> {
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

        let answer = RTCSessionDescription::answer(remote_peer.sdp.clone())
            .map_err(|err| err.to_string())?;
        open_peer
            .peer_connection
            .set_remote_description(answer)
            .map_err(|err| err.to_string())?;
        add_remote_candidates(open_peer, remote_peer)?;

        Ok(())
    }

    pub fn offers_ready(&self) -> bool {
        if self.offering_peers.is_empty() {
            return false;
        }
        self.offering_peers
            .values()
            .all(|peer| peer.ice_gathering_complete)
    }

    pub fn answers_ready(&self) -> bool {
        if self.answering_peers.is_empty() {
            return false;
        }
        self.answering_peers
            .values()
            .all(|peer| peer.ice_gathering_complete)
    }

    pub fn drive_network(&mut self) -> Result<(), String> {
        for peer in self.offering_peers.values_mut() {
            drive_peer(peer)?;
        }
        for peer in self.answering_peers.values_mut() {
            drive_peer(peer)?;
        }
        Ok(())
    }
}

fn make_offering_peer() -> Result<Peer, String> {
    let config = default_rtc_config();
    let mut peer_connection = RTCPeerConnection::new(config).map_err(|err| err.to_string())?;

    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|err| err.to_string())?;
    socket
        .set_nonblocking(true)
        .map_err(|err| err.to_string())?;
    let local_candidate = add_local_candidate(&mut peer_connection, &socket)?;

    let channel_init = RTCDataChannelInit {
        negotiated: Some(0),
        ..Default::default()
    };
    let _ = peer_connection
        .create_data_channel("chat", Some(channel_init))
        .map_err(|err| err.to_string())?;

    let offer = peer_connection
        .create_offer(None)
        .map_err(|err| err.to_string())?;
    peer_connection
        .set_local_description(offer)
        .map_err(|err| err.to_string())?;

    let mut peer = Peer::new(random_key(), peer_connection, socket);
    peer.local_candidates.push(local_candidate);
    Ok(peer)
}

fn make_answering_peer(remote_peer: &RemotePeer) -> Result<Peer, String> {
    let config = default_rtc_config();
    let mut peer_connection = RTCPeerConnection::new(config).map_err(|err| err.to_string())?;

    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|err| err.to_string())?;
    socket
        .set_nonblocking(true)
        .map_err(|err| err.to_string())?;
    let local_candidate = add_local_candidate(&mut peer_connection, &socket)?;

    let offer =
        RTCSessionDescription::offer(remote_peer.sdp.clone()).map_err(|err| err.to_string())?;
    peer_connection
        .set_remote_description(offer)
        .map_err(|err| err.to_string())?;
    add_remote_candidates_from_peer(&mut peer_connection, remote_peer)?;

    let channel_init = RTCDataChannelInit {
        negotiated: Some(0),
        ..Default::default()
    };
    let _ = peer_connection
        .create_data_channel("chat", Some(channel_init))
        .map_err(|err| err.to_string())?;

    let answer = peer_connection
        .create_answer(None)
        .map_err(|err| err.to_string())?;
    peer_connection
        .set_local_description(answer)
        .map_err(|err| err.to_string())?;

    let mut peer = Peer::new(remote_peer.key.clone(), peer_connection, socket);
    peer.local_candidates.push(local_candidate);
    Ok(peer)
}

fn add_local_candidate(
    peer_connection: &mut RTCPeerConnection,
    socket: &UdpSocket,
) -> Result<String, String> {
    let local_addr = socket.local_addr().map_err(|err| err.to_string())?;
    let candidate = CandidateHostConfig {
        base_config: CandidateConfig {
            network: "udp".to_string(),
            address: local_addr.ip().to_string(),
            port: local_addr.port(),
            component: 1,
            ..Default::default()
        },
        ..Default::default()
    }
    .new_candidate_host()
    .map_err(|err| err.to_string())?;
    let candidate_init = RTCIceCandidate::from(&candidate)
        .to_json()
        .map_err(|err| err.to_string())?;
    let candidate_string = candidate_init.candidate.clone();
    peer_connection
        .add_local_candidate(candidate_init)
        .map_err(|err| err.to_string())?;
    Ok(candidate_string)
}

fn default_rtc_config() -> rtc::peer_connection::configuration::RTCConfiguration {
    RTCConfigurationBuilder::new()
        .with_ice_servers(vec![RTCIceServer {
            urls: vec![
                "stun:stun1.l.google.com:19302".to_string(),
                "stun:stun3.l.google.com:19302".to_string(),
            ],
            ..Default::default()
        }])
        .build()
}

fn random_key() -> String {
    let value: u128 = rand::random();
    format!("{value:032x}")
}

fn add_remote_candidates(peer: &mut Peer, remote_peer: &RemotePeer) -> Result<(), String> {
    add_remote_candidates_from_peer(&mut peer.peer_connection, remote_peer)
}

fn add_remote_candidates_from_peer(
    peer_connection: &mut RTCPeerConnection,
    remote_peer: &RemotePeer,
) -> Result<(), String> {
    if remote_peer.candidates.is_empty() {
        return Ok(());
    }

    for candidate in &remote_peer.candidates {
        let candidate_init = RTCIceCandidateInit {
            candidate: candidate.clone(),
            sdp_mid: Some("0".to_string()),
            sdp_mline_index: Some(0),
            username_fragment: None,
            url: None,
        };
        peer_connection
            .add_remote_candidate(candidate_init)
            .map_err(|err| err.to_string())?;
    }

    Ok(())
}

const ICE_GATHERING_TIMEOUT: Duration = Duration::from_secs(6);

fn drive_peer(peer: &mut Peer) -> Result<(), String> {
    let now = Instant::now();

    while let Some(msg) = peer.peer_connection.poll_write() {
        peer._socket
            .send_to(&msg.message, msg.transport.peer_addr)
            .map_err(|err| err.to_string())?;
    }

    while let Some(event) = peer.peer_connection.poll_event() {
        match event {
            RTCPeerConnectionEvent::OnDataChannel(dc_event) => {
                if let RTCDataChannelEvent::OnOpen(channel_id) = dc_event {
                    info!("Native data channel opened: {channel_id}");
                }
            }
            RTCPeerConnectionEvent::OnIceGatheringStateChangeEvent(state) => {
                if state == RTCIceGatheringState::Gathering {
                    peer.ice_gathering_started_at = Some(Instant::now());
                }
                if state == RTCIceGatheringState::Complete {
                    peer.ice_gathering_complete = true;
                }
            }
            _ => {}
        }
    }

    while let Some(message) = peer.peer_connection.poll_read() {
        if let RTCMessage::DataChannelMessage(channel_id, data_channel_message) = message {
            let payload = data_channel_message.data.to_vec();
            if let Ok(text) = String::from_utf8(payload) {
                info!("Native data channel {channel_id} message: {text}");
            }
        }
    }

    if let Some(timeout) = peer.peer_connection.poll_timeout() {
        if timeout <= now {
            peer.peer_connection
                .handle_timeout(now)
                .map_err(|err| err.to_string())?;
        }
    }

    if !peer.ice_gathering_complete {
        if let Some(started_at) = peer.ice_gathering_started_at {
            if now.duration_since(started_at) >= ICE_GATHERING_TIMEOUT {
                peer.ice_gathering_complete = true;
                info!("Native ICE gathering timed out; continuing with current candidates");
            }
        }
    }

    let mut buf = [0u8; 2048];
    loop {
        match peer._socket.recv_from(&mut buf) {
            Ok((n, peer_addr)) => {
                let local_addr = peer._socket.local_addr().map_err(|err| err.to_string())?;
                let message = TaggedBytesMut {
                    now: Instant::now(),
                    transport: TransportContext {
                        local_addr,
                        peer_addr,
                        transport_protocol: TransportProtocol::UDP,
                        ecn: None,
                    },
                    message: BytesMut::from(&buf[..n]),
                };
                peer.peer_connection
                    .handle_read(message)
                    .map_err(|err| err.to_string())?;
            }
            Err(err) if err.kind() == io::ErrorKind::WouldBlock => break,
            Err(err) => return Err(err.to_string()),
        }
    }

    Ok(())
}
