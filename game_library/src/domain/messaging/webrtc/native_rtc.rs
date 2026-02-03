#![allow(dead_code)]

use std::collections::HashMap;
use std::net::UdpSocket;

use rtc::data_channel::RTCDataChannelInit;
use rtc::peer_connection::RTCPeerConnection;
use rtc::peer_connection::configuration::RTCConfigurationBuilder;
use rtc::peer_connection::sdp::RTCSessionDescription;
use rtc::peer_connection::transport::RTCIceServer;
use rtc::peer_connection::transport::{CandidateConfig, CandidateHostConfig, RTCIceCandidate};

use super::RemotePeer;

struct Peer {
    key: String,
    peer_connection: RTCPeerConnection,
    _socket: UdpSocket,
}

impl Peer {
    fn new(key: String, peer_connection: RTCPeerConnection, socket: UdpSocket) -> Self {
        Self {
            key,
            peer_connection,
            _socket: socket,
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

    pub async fn make_offering_peers(&mut self, num_peers: usize) -> Result<(), String> {
        self.offering_peers.clear();

        for _ in 0..num_peers {
            let peer = make_offering_peer()?;
            self.offering_peers.insert(peer.key.clone(), peer);
        }

        Ok(())
    }

    pub fn offer_payload(&self) -> Result<Vec<RemotePeer>, String> {
        let mut payload = Vec::new();
        for peer in self.offering_peers.values() {
            if let Some(description) = peer.peer_connection.local_description() {
                if !description.sdp.is_empty() {
                    payload.push(RemotePeer {
                        key: peer.key.clone(),
                        sdp: description.sdp.clone(),
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
        let mut payload = Vec::new();
        for peer in self.answering_peers.values() {
            if let Some(description) = peer.peer_connection.local_description() {
                if !description.sdp.is_empty() {
                    payload.push(RemotePeer {
                        key: peer.key.clone(),
                        sdp: description.sdp.clone(),
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

        let answer = RTCSessionDescription::answer(remote_peer.sdp.clone())
            .map_err(|err| err.to_string())?;
        open_peer
            .peer_connection
            .set_remote_description(answer)
            .map_err(|err| err.to_string())?;

        Ok(())
    }
}

fn make_offering_peer() -> Result<Peer, String> {
    let config = default_rtc_config();
    let mut peer_connection = RTCPeerConnection::new(config).map_err(|err| err.to_string())?;

    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|err| err.to_string())?;
    add_local_candidate(&mut peer_connection, &socket)?;

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

    Ok(Peer::new(random_key(), peer_connection, socket))
}

fn make_answering_peer(remote_peer: &RemotePeer) -> Result<Peer, String> {
    let config = default_rtc_config();
    let mut peer_connection = RTCPeerConnection::new(config).map_err(|err| err.to_string())?;

    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|err| err.to_string())?;
    add_local_candidate(&mut peer_connection, &socket)?;

    let offer =
        RTCSessionDescription::offer(remote_peer.sdp.clone()).map_err(|err| err.to_string())?;
    peer_connection
        .set_remote_description(offer)
        .map_err(|err| err.to_string())?;

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

    Ok(Peer::new(remote_peer.key.clone(), peer_connection, socket))
}

fn add_local_candidate(
    peer_connection: &mut RTCPeerConnection,
    socket: &UdpSocket,
) -> Result<(), String> {
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
    peer_connection
        .add_local_candidate(candidate_init)
        .map_err(|err| err.to_string())
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
