#![allow(dead_code)]

use std::collections::HashMap;
use std::io;
use std::net::IpAddr;
use std::net::SocketAddr;
use std::net::ToSocketAddrs;
use std::net::UdpSocket;
use std::time::Duration;
use std::time::Instant;

use bevy::prelude::info;
use bytes::BytesMut;
use rtc::data_channel::RTCDataChannelInit;
use rtc::peer_connection::RTCPeerConnection;
use rtc::peer_connection::configuration::RTCConfigurationBuilder;
use rtc::peer_connection::event::RTCDataChannelEvent;
use rtc::peer_connection::event::RTCPeerConnectionEvent;
use rtc::peer_connection::message::RTCMessage;
use rtc::peer_connection::sdp::RTCSessionDescription;
use rtc::peer_connection::state::RTCIceGatheringState;
use rtc::peer_connection::transport::CandidateConfig;
use rtc::peer_connection::transport::CandidateHostConfig;
use rtc::peer_connection::transport::CandidateServerReflexiveConfig;
use rtc::peer_connection::transport::RTCIceCandidate;
use rtc::peer_connection::transport::RTCIceCandidateInit;
use rtc::peer_connection::transport::RTCIceServer;
use rtc::sansio::Protocol;
use shared::TaggedBytesMut;
use shared::TransportContext;
use shared::TransportProtocol;
use stun::fingerprint::FINGERPRINT;
use stun::message::BINDING_REQUEST;
use stun::message::Getter;
use stun::message::MAGIC_COOKIE;
use stun::message::Message;
use stun::message::TransactionId;
use stun::xoraddr::XorMappedAddress;

use super::RemotePeer;

const DEFAULT_STUN: [&str; 2] = [
    "stun:stun1.l.google.com:19302",
    "stun:stun3.l.google.com:19302",
];
const STUN_RETRY_INTERVAL: Duration = Duration::from_millis(300);
const STUN_MAX_ATTEMPTS: u8 = 4;

struct StunQuery {
    server: SocketAddr,
    url: String,
    tx_id: TransactionId,
    sent_at: Instant,
    attempts: u8,
    done: bool,
}

struct Peer {
    key: String,
    peer_connection: RTCPeerConnection,
    socket: UdpSocket,
    local_addr: SocketAddr,
    local_ip: IpAddr,
    ice_gathering_complete: bool,
    ice_gathering_started_at: Option<Instant>,
    local_candidates: Vec<String>,
    stun_queries: Vec<StunQuery>,
    needs_gather: bool,
}

impl Peer {
    fn new(
        key: String,
        peer_connection: RTCPeerConnection,
        socket: UdpSocket,
        local_addr: SocketAddr,
        local_ip: IpAddr,
        stun_queries: Vec<StunQuery>,
    ) -> Self {
        Self {
            key,
            peer_connection,
            socket,
            local_addr,
            local_ip,
            ice_gathering_complete: false,
            ice_gathering_started_at: None,
            local_candidates: Vec::new(),
            stun_queries,
            needs_gather: true,
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
                    log_candidate_list("offer", &peer.key, &peer.local_candidates);
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
                    log_candidate_list("answer", &peer.key, &peer.local_candidates);
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
    let local_addr = socket.local_addr().map_err(|err| err.to_string())?;
    let mut local_ip = local_addr.ip();
    if local_ip.is_unspecified()
        && let Some(resolved) = resolve_local_ip()
    {
        local_ip = resolved;
    }
    if local_ip.is_unspecified() {
        info!("Local IP resolution failed; ICE host candidate will be 0.0.0.0");
    }
    let stun_queries = build_stun_queries(local_addr);

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

    Ok(Peer::new(
        random_key(),
        peer_connection,
        socket,
        local_addr,
        local_ip,
        stun_queries,
    ))
}

fn make_answering_peer(remote_peer: &RemotePeer) -> Result<Peer, String> {
    let config = default_rtc_config();
    let mut peer_connection = RTCPeerConnection::new(config).map_err(|err| err.to_string())?;

    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|err| err.to_string())?;
    socket
        .set_nonblocking(true)
        .map_err(|err| err.to_string())?;
    let local_addr = socket.local_addr().map_err(|err| err.to_string())?;
    let mut local_ip = local_addr.ip();
    if local_ip.is_unspecified()
        && let Some(resolved) = resolve_local_ip()
    {
        local_ip = resolved;
    }
    if local_ip.is_unspecified() {
        info!("Local IP resolution failed; ICE host candidate will be 0.0.0.0");
    }
    let stun_queries = build_stun_queries(local_addr);

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

    Ok(Peer::new(
        remote_peer.key.clone(),
        peer_connection,
        socket,
        local_addr,
        local_ip,
        stun_queries,
    ))
}

fn default_rtc_config() -> rtc::peer_connection::configuration::RTCConfiguration {
    RTCConfigurationBuilder::new()
        .with_ice_servers(vec![RTCIceServer {
            urls: DEFAULT_STUN
                .iter()
                .map(std::string::ToString::to_string)
                .collect(),
            ..Default::default()
        }])
        .build()
}

fn random_key() -> String {
    let value: u128 = rand::random();
    format!("{value:032x}")
}

fn resolve_local_ip() -> Option<IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    for url in DEFAULT_STUN {
        if let Some(server) = parse_stun_url(url)
            && socket.connect(server).is_ok()
            && let Ok(addr) = socket.local_addr()
            && !addr.ip().is_unspecified()
        {
            return Some(addr.ip());
        }
    }
    if socket.connect("8.8.8.8:80").is_err() {
        return None;
    }
    socket.local_addr().ok().map(|addr| addr.ip())
}

fn build_stun_queries(local_addr: SocketAddr) -> Vec<StunQuery> {
    let mut queries = Vec::new();
    for url in DEFAULT_STUN {
        if let Some(server) = parse_stun_url(url) {
            queries.push(StunQuery {
                server,
                url: url.to_string(),
                tx_id: TransactionId::new(),
                sent_at: Instant::now().checked_sub(STUN_RETRY_INTERVAL).unwrap(),
                attempts: 0,
                done: false,
            });
        } else {
            info!("Failed to resolve IPv4 STUN server: {url}");
        }
    }

    let _ = local_addr;
    queries
}

fn parse_stun_url(url: &str) -> Option<SocketAddr> {
    let mut rest = url.trim();
    if let Some(stripped) = rest.strip_prefix("stun:") {
        rest = stripped;
    }

    let rest = rest.split('?').next().unwrap_or(rest);
    let mut parts = rest.split(':');
    let host = parts.next()?;
    let port = parts.next().unwrap_or("3478");
    let addr = format!("{host}:{port}");
    let mut addrs = addr.to_socket_addrs().ok()?;
    addrs.find(SocketAddr::is_ipv4)
}

fn add_remote_candidates(peer: &mut Peer, remote_peer: &RemotePeer) -> Result<(), String> {
    add_remote_candidates_from_peer(&mut peer.peer_connection, remote_peer)
}

fn add_remote_candidates_from_peer(
    peer_connection: &mut RTCPeerConnection,
    remote_peer: &RemotePeer,
) -> Result<(), String> {
    if remote_peer.candidates.is_empty() {
        info!(
            "Native remote peer {} provided 0 ICE candidates",
            remote_peer.key
        );
        return Ok(());
    }

    info!(
        "Native applying {} ICE candidates for peer {}",
        remote_peer.candidates.len(),
        remote_peer.key
    );
    for candidate in &remote_peer.candidates {
        info!("Native remote candidate: {candidate}");
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

fn log_candidate_list(kind: &str, key: &str, candidates: &[String]) {
    if candidates.is_empty() {
        info!("Native {kind} payload for {key} has 0 ICE candidates");
        return;
    }
    info!(
        "Native {kind} payload for {key} has {} ICE candidates",
        candidates.len()
    );
    for candidate in candidates {
        info!("Native local candidate: {candidate}");
    }
}

const ICE_GATHERING_TIMEOUT: Duration = Duration::from_secs(6);

fn start_gather_if_needed(peer: &mut Peer) {
    if !peer.needs_gather {
        return;
    }

    info!("Native starting ICE gather for {}", peer.key);
    peer.ice_gathering_started_at = Some(Instant::now());

    if peer.local_ip.is_unspecified() {
        info!(
            "Native skipping host candidate for {} because local IP is unspecified",
            peer.key
        );
    } else if let Err(err) = add_host_candidate(peer) {
        info!("Native host candidate failed for {}: {}", peer.key, err);
        peer.needs_gather = false;
        peer.ice_gathering_complete = true;
        return;
    }

    start_stun_gather(peer);
    peer.needs_gather = false;
}

fn add_host_candidate(peer: &mut Peer) -> Result<(), String> {
    let host_candidate = CandidateHostConfig {
        base_config: CandidateConfig {
            network: "udp".to_string(),
            address: peer.local_ip.to_string(),
            port: peer.local_addr.port(),
            component: 1,
            ..Default::default()
        },
        ..Default::default()
    }
    .new_candidate_host()
    .map_err(|err| err.to_string())?;

    let init = RTCIceCandidate::from(&host_candidate)
        .to_json()
        .map_err(|err| err.to_string())?;
    let line = init.candidate.clone();
    if !peer.local_candidates.contains(&line) {
        peer.local_candidates.push(line);
    }
    peer.peer_connection
        .add_local_candidate(init)
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn start_stun_gather(peer: &mut Peer) {
    if peer.stun_queries.is_empty() {
        peer.ice_gathering_complete = true;
        info!(
            "Native ICE gathering complete for {} (no STUN servers)",
            peer.key
        );
        return;
    }

    info!(
        "Native STUN gather started for {} ({} server(s))",
        peer.key,
        peer.stun_queries.len()
    );
    for query in &mut peer.stun_queries {
        if !query.done
            && query.attempts == 0
            && let Err(err) = send_stun_request(&peer.socket, query)
        {
            info!(
                "Native STUN request failed to {} for {}: {}",
                query.server, peer.key, err
            );
            query.done = true;
        }
    }
}

fn pump_stun(peer: &mut Peer) {
    let now = Instant::now();
    for query in &mut peer.stun_queries {
        if query.done {
            continue;
        }
        if query.attempts >= STUN_MAX_ATTEMPTS {
            query.done = true;
            info!(
                "Native STUN server {} exhausted attempts for {}",
                query.server, peer.key
            );
            continue;
        }
        if now.duration_since(query.sent_at) >= STUN_RETRY_INTERVAL
            && let Err(err) = send_stun_request(&peer.socket, query)
        {
            info!(
                "Native STUN request failed to {} for {}: {}",
                query.server, peer.key, err
            );
            query.done = true;
        }
    }

    if !peer.ice_gathering_complete && peer.stun_queries.iter().all(|query| query.done) {
        peer.ice_gathering_complete = true;
        info!("Native ICE gathering complete for {}", peer.key);
    }
}

fn send_stun_request(socket: &UdpSocket, query: &mut StunQuery) -> Result<(), String> {
    let mut msg = Message::new();
    msg.build(&[
        Box::new(BINDING_REQUEST),
        Box::new(query.tx_id),
        Box::new(FINGERPRINT),
    ])
    .map_err(|err| err.to_string())?;
    msg.encode();

    socket
        .send_to(&msg.raw, query.server)
        .map_err(|err| err.to_string())?;

    query.sent_at = Instant::now();
    query.attempts = query.attempts.saturating_add(1);
    info!(
        "Native STUN request attempt {} to {}",
        query.attempts, query.server
    );
    Ok(())
}

fn is_stun_message(buf: &[u8]) -> bool {
    if buf.len() < 20 {
        return false;
    }
    if buf[0] & 0b1100_0000 != 0 {
        return false;
    }
    let cookie = u32::from_be_bytes([buf[4], buf[5], buf[6], buf[7]]);
    cookie == MAGIC_COOKIE
}

fn handle_stun_response(peer: &mut Peer, buf: &[u8]) -> Result<bool, String> {
    let mut msg = Message::new();
    msg.raw = buf.to_vec();
    msg.decode().map_err(|err| err.to_string())?;

    let tx_id = msg.transaction_id;
    let Some(query) = peer
        .stun_queries
        .iter_mut()
        .find(|query| query.tx_id == tx_id && !query.done)
    else {
        return Ok(false);
    };

    let mut mapped = XorMappedAddress::default();
    mapped.get_from(&msg).map_err(|err| err.to_string())?;

    if peer.local_ip.is_unspecified() {
        info!(
            "Native server-reflexive candidate for {} has unspecified local IP",
            peer.key
        );
    }
    let config = CandidateServerReflexiveConfig {
        base_config: CandidateConfig {
            network: "udp".to_string(),
            address: mapped.ip.to_string(),
            port: mapped.port,
            component: 1,
            ..Default::default()
        },
        rel_addr: peer.local_ip.to_string(),
        rel_port: peer.local_addr.port(),
        url: Some(query.url.clone()),
    };
    let candidate = config
        .new_candidate_server_reflexive()
        .map_err(|err| err.to_string())?;
    let mut init = RTCIceCandidate::from(&candidate)
        .to_json()
        .map_err(|err| err.to_string())?;
    init.url = Some(query.url.clone());
    if !peer.local_candidates.contains(&init.candidate) {
        peer.local_candidates.push(init.candidate.clone());
    }
    peer.peer_connection
        .add_local_candidate(init)
        .map_err(|err| err.to_string())?;

    query.done = true;
    info!(
        "Native STUN response from {} for {} -> {}:{}",
        query.server, peer.key, mapped.ip, mapped.port
    );
    Ok(true)
}

fn drive_peer(peer: &mut Peer) -> Result<(), String> {
    let now = Instant::now();

    start_gather_if_needed(peer);
    pump_stun(peer);

    while let Some(msg) = peer.peer_connection.poll_write() {
        peer.socket
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
            RTCPeerConnectionEvent::OnIceCandidateEvent(ice_event) => {
                let mut candidate_init = ice_event
                    .candidate
                    .to_json()
                    .map_err(|err| err.to_string())?;
                if !ice_event.url.is_empty() {
                    candidate_init.url = Some(ice_event.url);
                }
                if !peer.local_candidates.contains(&candidate_init.candidate) {
                    peer.local_candidates.push(candidate_init.candidate.clone());
                    info!(
                        "Native gathered ICE candidate: {}",
                        candidate_init.candidate
                    );
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
        match peer.socket.recv_from(&mut buf) {
            Ok((n, peer_addr)) => {
                if is_stun_message(&buf[..n]) && handle_stun_response(peer, &buf[..n])? {
                    continue;
                }
                let local_addr = if peer.local_ip.is_unspecified() {
                    normalized_local_addr(peer.local_addr, peer_addr)
                } else {
                    SocketAddr::new(peer.local_ip, peer.local_addr.port())
                };
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

fn normalized_local_addr(local_addr: SocketAddr, peer_addr: SocketAddr) -> SocketAddr {
    if !local_addr.ip().is_unspecified() {
        return local_addr;
    }
    SocketAddr::new(peer_addr.ip(), local_addr.port())
}
