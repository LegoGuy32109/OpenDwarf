use std::collections::HashMap;
use std::collections::VecDeque;
use std::fmt::Write as FmtWrite;
use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, ToSocketAddrs, UdpSocket};
use std::time::{Duration, Instant};

use crate::clipboard::ClipboardClient;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use bevy::log::{error, info, warn};
use bevy::prelude::Resource;
use bytes::BytesMut;
use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use rtc::data_channel::RTCDataChannelInit;
use rtc::data_channel::{RTCDataChannelId, RTCDataChannelMessage};
use rtc::peer_connection::RTCPeerConnection;
use rtc::peer_connection::configuration::RTCConfigurationBuilder;
use rtc::peer_connection::event::RTCDataChannelEvent;
use rtc::peer_connection::event::RTCPeerConnectionEvent;
use rtc::peer_connection::message::RTCMessage;
use rtc::peer_connection::sdp::RTCSessionDescription;
use rtc::peer_connection::state::RTCPeerConnectionState;
use rtc::peer_connection::transport::RTCIceServer;
use rtc::peer_connection::transport::{
    CandidateConfig, CandidateHostConfig, CandidateServerReflexiveConfig, RTCIceCandidate,
};
use rtc::sansio::Protocol;
use rtc::shared::{TaggedBytesMut, TransportContext, TransportProtocol};
use serde::{Deserialize, Serialize};
use stun::fingerprint::FINGERPRINT;
use stun::message::{Getter, Message, TransactionId, BINDING_REQUEST, MAGIC_COOKIE};
use stun::xoraddr::XorMappedAddress;
use uuid::Uuid;

const DEFAULT_STUN: [&str; 2] = [
    "stun:stun1.l.google.com:19302",
    "stun:stun3.l.google.com:19302",
];
const STUN_RETRY_INTERVAL: Duration = Duration::from_millis(300);
const STUN_MAX_ATTEMPTS: u8 = 4;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemotePeer {
    pub key: String,
    pub sdp: String,
}

#[derive(Debug)]
enum ActionRequest {
    GenerateOffers { num_peers: usize },
    GenerateAnswersFromOffer { payload: String },
    AcceptAnswerPayload { payload: String },
}

#[derive(Resource)]
pub struct WebrtcManager {
    clipboard: ClipboardClient,
    offer_payload: Option<String>,
    answer_payload: Option<String>,
    last_error: Option<String>,
    pending_actions: VecDeque<ActionRequest>,
    offer_peers: HashMap<String, PeerIo>,
    answer_peers: HashMap<String, PeerIo>,
    pending_offer_payload: bool,
    pending_answer_payload: bool,
}

impl WebrtcManager {
    pub fn new() -> Self {
        Self {
            clipboard: ClipboardClient::new(),
            offer_payload: None,
            answer_payload: None,
            last_error: None,
            pending_actions: VecDeque::new(),
            offer_peers: HashMap::new(),
            answer_peers: HashMap::new(),
            pending_offer_payload: false,
            pending_answer_payload: false,
        }
    }

    pub fn process_actions(&mut self) {
        while let Some(action) = self.pending_actions.pop_front() {
            match action {
                ActionRequest::GenerateOffers { num_peers } => {
                    for (_, mut peer) in self.offer_peers.drain() {
                        let _ = peer.pc.close();
                    }

                    match build_offers(num_peers) {
                        Ok(peers) => {
                            self.offer_peers = peers;
                            self.offer_payload = None;
                            self.pending_offer_payload = true;
                            self.last_error = None;
                            info!("Generating offer payload (waiting for ICE)");
                        }
                        Err(err) => {
                            self.last_error = Some(err.clone());
                            error!("{err}");
                        }
                    }
                }
                ActionRequest::GenerateAnswersFromOffer { payload } => {
                    for (_, mut peer) in self.answer_peers.drain() {
                        let _ = peer.pc.close();
                    }

                    match build_answers(&payload) {
                        Ok(peers) => {
                            self.answer_peers = peers;
                            self.answer_payload = None;
                            self.pending_answer_payload = true;
                            self.last_error = None;
                            info!("Generating answer payload (waiting for ICE)");
                        }
                        Err(err) => {
                            self.last_error = Some(err.clone());
                            error!("{err}");
                        }
                    }
                }
                ActionRequest::AcceptAnswerPayload { payload } => {
                    match accept_answers(&payload, &mut self.offer_peers) {
                        Ok(message) => info!("{message}"),
                        Err(err) => {
                            self.last_error = Some(err.clone());
                            error!("{err}");
                        }
                    }
                }
            }
        }
    }

    pub fn poll_network(&mut self) {
        for peer in self.offer_peers.values_mut() {
            if let Err(err) = pump_peer(peer) {
                error!("Pump error for offer peer {}: {}", peer.key, err);
            }
        }
        for peer in self.answer_peers.values_mut() {
            if let Err(err) = pump_peer(peer) {
                error!("Pump error for answer peer {}: {}", peer.key, err);
            }
        }

        if self.pending_offer_payload && all_ice_complete(&self.offer_peers) {
            match build_payload_from_peers(&self.offer_peers) {
                Ok(payload) => {
                    self.offer_payload = Some(payload);
                    self.pending_offer_payload = false;
                    info!("Offer payload ready");
                }
                Err(err) => {
                    self.last_error = Some(err.clone());
                    error!("{err}");
                }
            }
        }

        if self.pending_answer_payload && all_ice_complete(&self.answer_peers) {
            match build_payload_from_peers(&self.answer_peers) {
                Ok(payload) => {
                    self.answer_payload = Some(payload);
                    self.pending_answer_payload = false;
                    info!("Answer payload ready");
                }
                Err(err) => {
                    self.last_error = Some(err.clone());
                    error!("{err}");
                }
            }
        }
    }

    pub fn generate_connections(&mut self, num_peers: usize) -> Result<(), String> {
        if num_peers == 0 {
            return Err("num_peers must be > 0".to_string());
        }
        self.pending_actions
            .push_back(ActionRequest::GenerateOffers { num_peers });
        Ok(())
    }

    pub fn generate_answers_from_clipboard(&mut self) -> Result<(), String> {
        let text = self.read_clipboard_text()?;
        info!("Clipboard offer payload read: {} bytes", text.len());
        self.pending_actions
            .push_back(ActionRequest::GenerateAnswersFromOffer { payload: text });
        Ok(())
    }

    pub fn accept_answer_from_clipboard(&mut self) -> Result<(), String> {
        let text = self.read_clipboard_text()?;
        info!("Clipboard answer payload read: {} bytes", text.len());
        self.pending_actions
            .push_back(ActionRequest::AcceptAnswerPayload { payload: text });
        Ok(())
    }

    pub fn copy_offer_payload(&mut self) -> Result<(), String> {
        let payload = self
            .offer_payload
            .clone()
            .ok_or_else(|| "No offer payload available".to_string())?;
        info!("{}", payload_log_preview("Offer payload clipboard text", &payload));
        self.write_clipboard_text(&payload)
    }

    pub fn copy_answer_payload(&mut self) -> Result<(), String> {
        let payload = self
            .answer_payload
            .clone()
            .ok_or_else(|| "No answer payload available".to_string())?;
        info!("{}", payload_log_preview("Answer payload clipboard text", &payload));
        self.write_clipboard_text(&payload)
    }

    pub fn is_generating_offer(&self) -> bool {
        self.pending_offer_payload
    }

    pub fn is_generating_answer(&self) -> bool {
        self.pending_answer_payload
    }

    pub fn has_offer_payload(&self) -> bool {
        self.offer_payload.is_some()
    }

    pub fn has_answer_payload(&self) -> bool {
        self.answer_payload.is_some()
    }

    fn read_clipboard_text(&mut self) -> Result<String, String> {
        let text = self.clipboard.read_text()?;
        info!("Clipboard read {} bytes", text.len());
        Ok(text)
    }

    fn write_clipboard_text(&mut self, text: &str) -> Result<(), String> {
        self.clipboard.write_text(text)?;
        info!("Clipboard write {} bytes", text.len());
        Ok(())
    }
}

impl Default for WebrtcManager {
    fn default() -> Self {
        Self::new()
    }
}

struct PeerIo {
    key: String,
    role: PeerRole,
    pc: RTCPeerConnection,
    socket: UdpSocket,
    local_addr: std::net::SocketAddr,
    local_ip: IpAddr,
    candidate_lines: Vec<String>,
    stun_queries: Vec<StunQuery>,
    channel_id: Option<RTCDataChannelId>,
    next_message: Option<(Instant, String)>,
    last_pending_log: Option<Instant>,
    ping_started: bool,
    channel_open: bool,
    ice_complete: bool,
    needs_gather: bool,
    needs_sdp_refresh: bool,
}

struct StunQuery {
    server: SocketAddr,
    url: String,
    tx_id: TransactionId,
    sent_at: Instant,
    attempts: u8,
    done: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PeerRole {
    Offerer,
    Answerer,
}

fn build_offers(num_peers: usize) -> Result<HashMap<String, PeerIo>, String> {
    if num_peers == 0 {
        return Err("num_peers must be > 0".to_string());
    }

    let mut peers = HashMap::new();

    for _ in 0..num_peers {
        let peer = create_peer()?;
        let key = peer.key.clone();
        peers.insert(key, peer);
    }

    Ok(peers)
}

fn build_answers(payload: &str) -> Result<HashMap<String, PeerIo>, String> {
    let remote = decompress_remote_peers(payload)?;
    if remote.is_empty() {
        return Err("No remote peers given".to_string());
    }

    let mut peers = HashMap::new();

    for remote_peer in remote {
        let peer = create_peer_with_remote_offer(&remote_peer)?;
        peers.insert(remote_peer.key, peer);
    }

    Ok(peers)
}

fn accept_answers(
    payload: &str,
    offer_peers: &mut HashMap<String, PeerIo>,
) -> Result<String, String> {
    let remote = decompress_remote_peers(payload)?;
    if remote.is_empty() {
        return Err("No remote peers given".to_string());
    }

    let mut accepted = 0;
    for remote_peer in remote {
        if let Some(peer) = offer_peers.get_mut(&remote_peer.key) {
            let answer =
                RTCSessionDescription::answer(remote_peer.sdp).map_err(|e| e.to_string())?;
            peer.pc
                .set_remote_description(answer)
                .map_err(|e| e.to_string())?;
            accepted += 1;
        }
    }

    if accepted == 0 {
        return Err("No matching offer peers for answer payload".to_string());
    }

    Ok(format!("Accepted {accepted} answer(s)"))
}

fn create_peer() -> Result<PeerIo, String> {
    let mut pc = new_peer_connection()?;
    let channel_id = create_data_channel(&mut pc)?;

    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.set_nonblocking(true).map_err(|e| e.to_string())?;
    let local_addr = socket.local_addr().map_err(|e| e.to_string())?;
    let mut local_ip = local_addr.ip();
    if local_ip.is_unspecified()
        && let Some(resolved) = resolve_local_ip() {
            local_ip = resolved;
        }
    if local_ip.is_unspecified() {
        error!("Local IP resolution failed; ICE host candidate will be 0.0.0.0");
    }
    let stun_queries = build_stun_queries(local_addr);

    let offer = pc.create_offer(None).map_err(|e| e.to_string())?;
    pc.set_local_description(offer).map_err(|e| e.to_string())?;

    Ok(PeerIo {
        key: Uuid::new_v4().to_string(),
        role: PeerRole::Offerer,
        pc,
        socket,
        local_addr,
        local_ip,
        candidate_lines: Vec::new(),
        stun_queries,
        channel_id: Some(channel_id),
        next_message: None,
        last_pending_log: None,
        ping_started: false,
        channel_open: false,
        ice_complete: false,
        needs_gather: true,
        needs_sdp_refresh: false,
    })
}

fn create_peer_with_remote_offer(remote: &RemotePeer) -> Result<PeerIo, String> {
    let mut pc = new_peer_connection()?;

    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.set_nonblocking(true).map_err(|e| e.to_string())?;
    let local_addr = socket.local_addr().map_err(|e| e.to_string())?;
    let mut local_ip = local_addr.ip();
    if local_ip.is_unspecified()
        && let Some(resolved) = resolve_local_ip() {
            local_ip = resolved;
        }
    if local_ip.is_unspecified() {
        error!("Local IP resolution failed; ICE host candidate will be 0.0.0.0");
    }
    let stun_queries = build_stun_queries(local_addr);

    let offer = RTCSessionDescription::offer(remote.sdp.clone()).map_err(|e| e.to_string())?;
    pc.set_remote_description(offer)
        .map_err(|e| e.to_string())?;

    let answer = pc.create_answer(None).map_err(|e| e.to_string())?;
    pc.set_local_description(answer)
        .map_err(|e| e.to_string())?;

    Ok(PeerIo {
        key: remote.key.clone(),
        role: PeerRole::Answerer,
        pc,
        socket,
        local_addr,
        local_ip,
        candidate_lines: Vec::new(),
        stun_queries,
        channel_id: None,
        next_message: None,
        last_pending_log: None,
        ping_started: false,
        channel_open: false,
        ice_complete: false,
        needs_gather: true,
        needs_sdp_refresh: false,
    })
}

fn new_peer_connection() -> Result<RTCPeerConnection, String> {
    let config = RTCConfigurationBuilder::new()
        .with_ice_servers(vec![RTCIceServer {
            urls: DEFAULT_STUN
                .iter()
                .map(std::string::ToString::to_string)
                .collect(),
            ..Default::default()
        }])
        .build();

    RTCPeerConnection::new(config).map_err(|e| e.to_string())
}

fn create_data_channel(pc: &mut RTCPeerConnection) -> Result<RTCDataChannelId, String> {
    let init = RTCDataChannelInit {
        ordered: true,
        ..Default::default()
    };

    let channel = pc
        .create_data_channel("chat", Some(init))
        .map_err(|e| e.to_string())?;
    Ok(channel.id())
}

fn add_host_candidate(
    pc: &mut RTCPeerConnection,
    local_ip: IpAddr,
    local_port: u16,
) -> Result<String, String> {
    let host_candidate = CandidateHostConfig {
        base_config: CandidateConfig {
            network: "udp".to_string(),
            address: local_ip.to_string(),
            port: local_port,
            component: 1,
            ..Default::default()
        },
        ..Default::default()
    }
    .new_candidate_host()
    .map_err(|e| e.to_string())?;

    let init = RTCIceCandidate::from(&host_candidate)
        .to_json()
        .map_err(|e| e.to_string())?;

    let line = init.candidate.clone();
    pc.add_local_candidate(init)
        .map_err(|e| e.to_string())?;
    Ok(line)
}

fn pump_peer(peer: &mut PeerIo) -> Result<bool, String> {
    start_gather_if_needed(peer);
    pump_stun(peer);
    pump_rtc_writes(peer)?;
    pump_socket_reads(peer)?;
    pump_rtc_timeout(peer)?;
    pump_rtc_reads(peer);
    pump_rtc_events(peer);
    refresh_sdp_if_needed(peer);
    send_scheduled_message_if_due(peer);
    log_pending_message(peer);

    Ok(false)
}

fn start_gather_if_needed(peer: &mut PeerIo) {
    if !peer.needs_gather {
        return;
    }

    info!("Starting ICE gather for {}", peer.key);
    if peer.local_ip.is_unspecified() {
        warn!(
            "Skipping host candidate for {} because local IP is unspecified",
            peer.key
        );
    } else {
        match add_host_candidate(&mut peer.pc, peer.local_ip, peer.local_addr.port()) {
            Ok(line) => peer.candidate_lines.push(line),
            Err(err) => {
                error!("Host candidate failed for {}: {}", peer.key, err);
                peer.needs_gather = false;
                peer.ice_complete = true;
                peer.needs_sdp_refresh = true;
                return;
            }
        }
    }
    start_stun_gather(peer);
    peer.needs_gather = false;
}

fn pump_rtc_writes(peer: &mut PeerIo) -> Result<(), String> {
    while let Some(msg) = peer.pc.poll_write() {
        peer.socket
            .send_to(&msg.message, msg.transport.peer_addr)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn pump_socket_reads(peer: &mut PeerIo) -> Result<(), String> {
    loop {
        let mut buf = [0u8; 2000];
        match peer.socket.recv_from(&mut buf) {
            Ok((n, peer_addr)) => {
                if is_stun_message(&buf[..n]) {
                    // STUN requests are used for ICE connectivity checks, so we must
                    // forward them to the peer connection. Only consume responses that
                    // match our own STUN queries.
                    if let Ok(consumed) = handle_stun_response(peer, &buf[..n])
                        && consumed {
                            continue;
                        }
                }
                let _ = peer.pc.handle_read(TaggedBytesMut {
                    now: Instant::now(),
                    transport: TransportContext {
                        local_addr: if peer.local_ip.is_unspecified() {
                            peer.local_addr
                        } else {
                            SocketAddr::new(peer.local_ip, peer.local_addr.port())
                        },
                        peer_addr,
                        ecn: None,
                        transport_protocol: TransportProtocol::UDP,
                    },
                    message: BytesMut::from(&buf[..n]),
                });
            }
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => break,
            Err(err) => return Err(err.to_string()),
        }
    }
    Ok(())
}

fn pump_rtc_timeout(peer: &mut PeerIo) -> Result<(), String> {
    if let Some(timeout_at) = peer.pc.poll_timeout()
        && timeout_at <= Instant::now()
    {
        peer.pc
            .handle_timeout(Instant::now())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn pump_rtc_reads(peer: &mut PeerIo) {
    while let Some(message) = peer.pc.poll_read() {
        if let RTCMessage::DataChannelMessage(_, data) = message
            && data.is_string
            && let Ok(text) = std::str::from_utf8(&data.data)
        {
            handle_data_message(peer, text);
        }
    }
}

fn pump_rtc_events(peer: &mut PeerIo) {
    while let Some(event) = peer.pc.poll_event() {
        match event {
            RTCPeerConnectionEvent::OnIceConnectionStateChangeEvent(state) => {
                info!("ICE connection state for {}: {}", peer.key, state);
            }
            RTCPeerConnectionEvent::OnConnectionStateChangeEvent(state) => {
                info!("Peer connection state for {}: {}", peer.key, state);
                if state == RTCPeerConnectionState::Connected {
                    maybe_start_ping(peer);
                }
            }
            RTCPeerConnectionEvent::OnDataChannel(dc_event) => match dc_event {
                RTCDataChannelEvent::OnOpen(id) => {
                    peer.channel_open = true;
                    peer.channel_id = Some(id);
                    info!("Data channel open for {} (id {:?})", peer.key, id);
                    maybe_start_ping(peer);
                }
                RTCDataChannelEvent::OnClose(id) => {
                    peer.channel_open = false;
                    info!("Data channel closed for {} (id {:?})", peer.key, id);
                }
                _ => {}
            },
            RTCPeerConnectionEvent::OnIceGatheringStateChangeEvent(state) => {
                info!("ICE gathering state for {}: {}", peer.key, state);
            }
            _ => {}
        }
    }
}

fn refresh_sdp_if_needed(peer: &mut PeerIo) {
    if !peer.needs_sdp_refresh {
        return;
    }
    if peer.role == PeerRole::Offerer {
        if let Err(err) = refresh_local_description(peer) {
            error!("SDP refresh failed for {}: {}", peer.key, err);
        }
    } else {
        info!("Skipping SDP refresh for answerer {}", peer.key);
    }
    peer.needs_sdp_refresh = false;
}

fn send_scheduled_message_if_due(peer: &mut PeerIo) {
    let Some((when, payload)) = peer.next_message.clone() else {
        return;
    };
    if when > Instant::now() {
        return;
    }
    if peer.channel_open && peer.channel_id.is_some() {
        info!(
            "Attempting to send {} to {} (channel {:?})",
            payload, peer.key, peer.channel_id
        );
        match send_data_message(peer, &payload) {
            Ok(()) => {
                peer.next_message = None;
            }
            Err(err) => {
                error!(
                    "Failed sending {} to {}: {}",
                    payload, peer.key, err
                );
            }
        }
    } else {
        info!(
            "Message pending for {} but channel not ready (open {}, id {:?})",
            peer.key, peer.channel_open, peer.channel_id
        );
    }
}

fn log_pending_message(peer: &mut PeerIo) {
    let Some((when, payload)) = &peer.next_message else {
        return;
    };
    let now = Instant::now();
    let should_log = peer
        .last_pending_log
        .is_none_or(|last| now.duration_since(last) >= Duration::from_secs(1));
    if should_log {
        info!(
            "Pending {} for {} (send at {:?}, now {:?})",
            payload, peer.key, when, now
        );
        peer.last_pending_log = Some(now);
    }
}

fn resolve_local_ip() -> Option<IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    for url in DEFAULT_STUN {
        if let Some(server) = parse_stun_url(url)
            && socket.connect(server).is_ok()
                && let Ok(addr) = socket.local_addr()
                    && !addr.ip().is_unspecified() {
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
            error!("Failed to resolve IPv4 STUN server: {url}");
        }
    }

    // Ensure local_addr is referenced so future extensions can use it.
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
    addrs.find(std::net::SocketAddr::is_ipv4)
}

fn start_stun_gather(peer: &mut PeerIo) {
    if peer.stun_queries.is_empty() {
        peer.ice_complete = true;
        peer.needs_sdp_refresh = true;
        info!("ICE gathering complete for {} (no STUN servers)", peer.key);
        return;
    }

    info!(
        "STUN gather started for {} ({} server(s))",
        peer.key,
        peer.stun_queries.len()
    );
    for query in &mut peer.stun_queries {
        if !query.done && query.attempts == 0
            && let Err(err) = send_stun_request(&peer.socket, query) {
                error!(
                    "STUN request failed to {} for {}: {}",
                    query.server, peer.key, err
                );
                query.done = true;
            }
    }
}

fn pump_stun(peer: &mut PeerIo) {
    let now = Instant::now();
    for query in &mut peer.stun_queries {
        if query.done {
            continue;
        }
        if query.attempts >= STUN_MAX_ATTEMPTS {
            query.done = true;
            info!(
                "STUN server {} exhausted attempts for {}",
                query.server, peer.key
            );
            continue;
        }
        if now.duration_since(query.sent_at) >= STUN_RETRY_INTERVAL
            && let Err(err) = send_stun_request(&peer.socket, query) {
                error!(
                    "STUN request failed to {} for {}: {}",
                    query.server, peer.key, err
                );
                query.done = true;
            }
    }

    if !peer.ice_complete && peer.stun_queries.iter().all(|q| q.done) {
        peer.ice_complete = true;
        peer.needs_sdp_refresh = true;
        info!("ICE gathering complete for {}", peer.key);
    }
}

fn send_stun_request(socket: &UdpSocket, query: &mut StunQuery) -> Result<(), String> {
    let mut msg = Message::new();
    msg.build(&[
        Box::new(BINDING_REQUEST),
        Box::new(query.tx_id),
        Box::new(FINGERPRINT),
    ])
    .map_err(|e| e.to_string())?;
    msg.encode();

    socket
        .send_to(&msg.raw, query.server)
        .map_err(|e| e.to_string())?;

    query.sent_at = Instant::now();
    query.attempts = query.attempts.saturating_add(1);
    let mut tx_id = String::with_capacity(query.tx_id.0.len() * 2);
    for byte in &query.tx_id.0 {
        let _ = write!(tx_id, "{byte:02x}");
    }
    info!(
        "STUN request {} attempt {} to {}",
        tx_id, query.attempts, query.server
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

fn handle_stun_response(peer: &mut PeerIo, buf: &[u8]) -> Result<bool, String> {
    let mut msg = Message::new();
    msg.raw = buf.to_vec();
    msg.decode().map_err(|e| e.to_string())?;

    let tx_id = msg.transaction_id;
    let Some(query) = peer
        .stun_queries
        .iter_mut()
        .find(|q| q.tx_id == tx_id && !q.done)
    else {
        return Ok(false);
    };

    let mut mapped = XorMappedAddress::default();
    mapped.get_from(&msg).map_err(|e| e.to_string())?;

    if peer.local_ip.is_unspecified() {
        warn!(
            "Server-reflexive candidate for {} has unspecified local IP",
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
        .map_err(|e| e.to_string())?;
    let mut init = RTCIceCandidate::from(&candidate)
        .to_json()
        .map_err(|e| e.to_string())?;
    init.url = Some(query.url.clone());
    peer.candidate_lines.push(init.candidate.clone());
    peer.pc
        .add_local_candidate(init)
        .map_err(|e| e.to_string())?;

    query.done = true;
    info!(
        "STUN response from {} for {} -> {}:{}",
        query.server, peer.key, mapped.ip, mapped.port
    );
    Ok(true)
}

fn all_ice_complete(peers: &HashMap<String, PeerIo>) -> bool {
    !peers.is_empty() && peers.values().all(|peer| peer.ice_complete)
}

fn build_payload_from_peers(peers: &HashMap<String, PeerIo>) -> Result<String, String> {
    let mut payload: Vec<RemotePeer> = Vec::with_capacity(peers.len());
    for peer in peers.values() {
        let description = peer
            .pc
            .local_description()
            .ok_or_else(|| "Local description missing".to_string())?;
        let sdp = if description.sdp.contains("a=candidate:")
            || peer.candidate_lines.is_empty()
        {
            description.sdp.clone()
        } else {
            let mut sdp = description.sdp.clone();
            for candidate in &peer.candidate_lines {
                sdp.push('\n');
                sdp.push_str("a=");
                sdp.push_str(candidate);
            }
            sdp.push('\n');
            sdp.push_str("a=end-of-candidates");
            sdp
        };
        if !description.sdp.contains("a=candidate:")
            && !peer.candidate_lines.is_empty()
        {
            info!(
                "SDP missing candidates for {}; injected {} candidate line(s)",
                peer.key,
                peer.candidate_lines.len()
            );
        }
        payload.push(RemotePeer {
            key: peer.key.clone(),
            sdp,
        });
    }

    if payload.is_empty() {
        return Err("No local descriptions available".to_string());
    }

    if let Some(example) = payload.first() {
        info!("Final payload SDP for {}:\n{}", example.key, example.sdp);
    }

    Ok(compress_remote_peers(&payload))
}

fn handle_data_message(peer: &mut PeerIo, text: &str) {
    match text {
        "ping" => {
            info!("Received ping from {}", peer.key);
            info!("Scheduling pong for {}", peer.key);
            schedule_message(peer, "pong");
        }
        "pong" => {
            info!("Received pong from {}", peer.key);
            if peer.role == PeerRole::Offerer {
                info!("Scheduling ping for {}", peer.key);
                schedule_message(peer, "ping");
            }
        }
        _ => {
            info!("Received data from {}: {}", peer.key, text);
        }
    }
}

fn schedule_message(peer: &mut PeerIo, payload: &str) {
    peer.next_message = Some((Instant::now() + Duration::from_secs(1), payload.to_string()));
    peer.last_pending_log = None;
}

fn send_data_message(peer: &mut PeerIo, payload: &str) -> Result<(), String> {
    let Some(channel_id) = peer.channel_id else {
        return Err("Data channel not ready".to_string());
    };
    info!("Sending {} to {}", payload, peer.key);
    let msg = RTCDataChannelMessage {
        is_string: true,
        data: BytesMut::from(payload.as_bytes()),
    };
    peer.pc
        .handle_write(RTCMessage::DataChannelMessage(channel_id, msg))
        .map_err(|e| e.to_string())
}

fn maybe_start_ping(peer: &mut PeerIo) {
    if peer.role == PeerRole::Offerer
        && !peer.ping_started
        && peer.channel_open
        && peer.channel_id.is_some()
    {
        peer.ping_started = true;
        info!("Starting ping loop for {}", peer.key);
        schedule_message(peer, "ping");
    }
}

fn refresh_local_description(peer: &mut PeerIo) -> Result<(), String> {
    match peer.role {
        PeerRole::Offerer => {
            let offer = peer.pc.create_offer(None).map_err(|e| e.to_string())?;
            peer.pc
                .set_local_description(offer)
                .map_err(|e| e.to_string())?;
        }
        PeerRole::Answerer => {
            let answer = peer.pc.create_answer(None).map_err(|e| e.to_string())?;
            peer.pc
                .set_local_description(answer)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn payload_log_preview(label: &str, payload: &str) -> String {
    const PREVIEW_LIMIT: usize = 256;
    let mut preview = payload;
    let mut truncated = false;
    if payload.len() > PREVIEW_LIMIT {
        let mut end = PREVIEW_LIMIT;
        while end > 0 && !payload.is_char_boundary(end) {
            end -= 1;
        }
        preview = &payload[..end];
        truncated = true;
    }
    if truncated {
        format!("{label} ({} bytes): {}...", payload.len(), preview)
    } else {
        format!("{label} ({} bytes): {}", payload.len(), preview)
    }
}

pub fn compress_remote_peers(peers: &[RemotePeer]) -> String {
    let Ok(json) = serde_json::to_string(peers) else {
        return String::new();
    };

    let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
    if encoder.write_all(json.as_bytes()).is_err() {
        return json;
    }

    match encoder.finish() {
        Ok(bytes) => BASE64.encode(bytes),
        Err(_) => json,
    }
}

pub fn decompress_remote_peers(text: &str) -> Result<Vec<RemotePeer>, String> {
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }

    if let Ok(bytes) = BASE64.decode(text.trim()) {
        let mut decoder = GzDecoder::new(&bytes[..]);
        let mut json = String::new();
        if decoder.read_to_string(&mut json).is_ok() {
            return serde_json::from_str(&json).map_err(|e| e.to_string());
        }
    }

    serde_json::from_str(text).map_err(|e| e.to_string())
}
