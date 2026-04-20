#![allow(dead_code)]

use std::collections::HashMap;
use std::io;
use std::net::IpAddr;
use std::net::Ipv4Addr;
use std::net::Ipv6Addr;
use std::net::SocketAddr;
use std::net::ToSocketAddrs;
use std::net::UdpSocket;
use std::time::Duration;
use std::time::Instant;

use bevy::prelude::info;
use bytes::BytesMut;
use rtc::data_channel::RTCDataChannelInit;
use rtc::data_channel::RTCDataChannelMessage;
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
use rtc::peer_connection::transport::RTCIceServer;
use rtc::sansio::Protocol;
use shared::TaggedBytesMut;
use shared::TransportContext;
use shared::TransportProtocol;
use socket2::Domain;
use socket2::Protocol as SocketProtocol;
use socket2::Socket;
use socket2::Type;
use stun::fingerprint::FINGERPRINT;
use stun::message::BINDING_REQUEST;
use stun::message::Getter;
use stun::message::MAGIC_COOKIE;
use stun::message::Message;
use stun::message::TransactionId;
use stun::xoraddr::XorMappedAddress;

use super::{RemotePeer, RtcConfig};
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
    local_ipv4: Option<Ipv4Addr>,
    local_ipv6: Option<Ipv6Addr>,
    supports_ipv6: bool,
    role: PeerRole,
    channel_id: Option<u16>,
    channel_open: bool,
    ping_started: bool,
    next_ping_at: Option<Instant>,
    ice_gathering_complete: bool,
    ice_gathering_started_at: Option<Instant>,
    needs_sdp_refresh: bool,
    local_candidates: Vec<String>,
    stun_queries: Vec<StunQuery>,
    needs_gather: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PeerRole {
    Offerer,
    Answerer,
}

impl Peer {
    fn new(
        key: String,
        peer_connection: RTCPeerConnection,
        socket: UdpSocket,
        local_addr: SocketAddr,
        local_ipv4: Option<Ipv4Addr>,
        local_ipv6: Option<Ipv6Addr>,
        supports_ipv6: bool,
        role: PeerRole,
        stun_queries: Vec<StunQuery>,
    ) -> Self {
        Self {
            key,
            peer_connection,
            socket,
            local_addr,
            local_ipv4,
            local_ipv6,
            supports_ipv6,
            role,
            channel_id: None,
            channel_open: false,
            ping_started: false,
            next_ping_at: None,
            ice_gathering_complete: false,
            ice_gathering_started_at: None,
            needs_sdp_refresh: false,
            local_candidates: Vec::new(),
            stun_queries,
            needs_gather: true,
        }
    }
}

pub struct WebrtcManager {
    rtc_config: RtcConfig,
    offering_peers: HashMap<String, Peer>,
    answering_peers: HashMap<String, Peer>,
}

impl WebrtcManager {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            rtc_config: RtcConfig::default(),
            offering_peers: HashMap::new(),
            answering_peers: HashMap::new(),
        })
    }

    pub fn rtc_config(&self) -> &RtcConfig {
        &self.rtc_config
    }

    pub fn rtc_config_mut(&mut self) -> &mut RtcConfig {
        &mut self.rtc_config
    }

    pub fn has_peers(&self) -> bool {
        !self.offering_peers.is_empty() || !self.answering_peers.is_empty()
    }

    pub fn has_offers(&self) -> bool {
        !self.offering_peers.is_empty()
    }

    pub fn guest_connected(&self) -> bool {
        self.answering_peers.values().any(|peer| peer.channel_open)
    }

    pub fn make_offering_peers(&mut self, num_peers: usize) -> Result<(), String> {
        self.offering_peers.clear();

        for _ in 0..num_peers {
            let peer = make_offering_peer(&self.rtc_config)?;
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
            if let Some(description) = peer.peer_connection.local_description()
                && !description.sdp.is_empty()
            {
                log_candidate_list("offer", &peer.key, &peer.local_candidates);
                payload.push(RemotePeer {
                    key: peer.key.clone(),
                    sdp: description.sdp.clone(),
                });
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
            let peer = make_answering_peer(&self.rtc_config, remote_peer)?;
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
            if let Some(description) = peer.peer_connection.local_description()
                && !description.sdp.is_empty()
            {
                log_candidate_list("answer", &peer.key, &peer.local_candidates);
                payload.push(RemotePeer {
                    key: peer.key.clone(),
                    sdp: description.sdp.clone(),
                });
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
                && remote_keys
                    .iter()
                    .any(|remote_key| *remote_key == key.as_str())
            {
                open_peer = Some(peer);
                break;
            }
        }

        let open_peer =
            open_peer.ok_or_else(|| "No matching offer peers for answer payload".to_string())?;
        let remote_peer = remote_peers
            .iter()
            .find(|peer| peer.key == open_peer.key)
            .ok_or_else(|| "Remote Peer filtering invalid, BUG".to_string())?;

        let sanitized_sdp = sanitize_remote_sdp(open_peer.supports_ipv6, &remote_peer.sdp);
        let answer = RTCSessionDescription::answer(sanitized_sdp).map_err(|err| err.to_string())?;
        open_peer
            .peer_connection
            .set_remote_description(answer)
            .map_err(|err| err.to_string())?;

        Ok(())
    }

    pub fn offers_ready(&self) -> bool {
        if self.offering_peers.is_empty() {
            return false;
        }
        self.offering_peers.values().all(|peer| {
            peer.ice_gathering_complete
                && !peer.needs_sdp_refresh
                && peer.peer_connection.local_description().is_some()
        })
    }

    pub fn answers_ready(&self) -> bool {
        if self.answering_peers.is_empty() {
            return false;
        }
        self.answering_peers.values().all(|peer| {
            peer.ice_gathering_complete
                && !peer.needs_sdp_refresh
                && peer.peer_connection.local_description().is_some()
        })
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

fn make_offering_peer(rtc_config: &RtcConfig) -> Result<Peer, String> {
    let config = build_native_config(rtc_config);
    let mut peer_connection = RTCPeerConnection::new(config).map_err(|err| err.to_string())?;

    let (socket, supports_ipv6) = bind_udp_socket()?;
    let local_addr = socket.local_addr().map_err(|err| err.to_string())?;
    let local_ipv4 = resolve_local_ipv4(rtc_config);
    let local_ipv6 = resolve_local_ipv6();
    if local_ipv4.is_none() && local_ipv6.is_none() {
        info!("Local IP resolution failed; ICE host candidates will be skipped");
    }
    let stun_queries = build_stun_queries(rtc_config, local_addr);

    let channel_init = RTCDataChannelInit {
        ordered: true,
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
        local_ipv4,
        local_ipv6,
        supports_ipv6,
        PeerRole::Offerer,
        stun_queries,
    ))
}

fn make_answering_peer(rtc_config: &RtcConfig, remote_peer: &RemotePeer) -> Result<Peer, String> {
    let config = build_native_config(rtc_config);
    let mut peer_connection = RTCPeerConnection::new(config).map_err(|err| err.to_string())?;

    let (socket, supports_ipv6) = bind_udp_socket()?;
    let local_addr = socket.local_addr().map_err(|err| err.to_string())?;
    let local_ipv4 = resolve_local_ipv4(rtc_config);
    let local_ipv6 = resolve_local_ipv6();
    if local_ipv4.is_none() && local_ipv6.is_none() {
        info!("Local IP resolution failed; ICE host candidates will be skipped");
    }
    let stun_queries = build_stun_queries(rtc_config, local_addr);

    let sanitized_sdp = sanitize_remote_sdp(supports_ipv6, &remote_peer.sdp);
    let offer = RTCSessionDescription::offer(sanitized_sdp).map_err(|err| err.to_string())?;
    peer_connection
        .set_remote_description(offer)
        .map_err(|err| err.to_string())?;

    Ok(Peer::new(
        remote_peer.key.clone(),
        peer_connection,
        socket,
        local_addr,
        local_ipv4,
        local_ipv6,
        supports_ipv6,
        PeerRole::Answerer,
        stun_queries,
    ))
}

fn build_native_config(
    config: &RtcConfig,
) -> rtc::peer_connection::configuration::RTCConfiguration {
    let ice_servers = config
        .ice_servers
        .iter()
        .map(|server| RTCIceServer {
            urls: server.urls.clone(),
            ..Default::default()
        })
        .collect();
    RTCConfigurationBuilder::new()
        .with_ice_servers(ice_servers)
        .build()
}

fn random_key() -> String {
    let value: u128 = rand::random();
    format!("{value:032x}")
}

fn bind_udp_socket() -> Result<(UdpSocket, bool), String> {
    let socket = Socket::new(Domain::IPV6, Type::DGRAM, Some(SocketProtocol::UDP));
    if let Ok(socket) = socket
        && socket.set_only_v6(false).is_ok()
        && socket
            .bind(&SocketAddr::from((Ipv6Addr::UNSPECIFIED, 0)).into())
            .is_ok()
    {
        let socket: UdpSocket = socket.into();
        socket
            .set_nonblocking(true)
            .map_err(|err| err.to_string())?;
        return Ok((socket, true));
    }

    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
        socket
            .set_nonblocking(true)
            .map_err(|err| err.to_string())?;
        return Ok((socket, false));
    }

    let socket = Socket::new(Domain::IPV6, Type::DGRAM, Some(SocketProtocol::UDP))
        .map_err(|err| err.to_string())?;
    let _ = socket.set_only_v6(true);
    socket
        .bind(&SocketAddr::from((Ipv6Addr::UNSPECIFIED, 0)).into())
        .map_err(|err| err.to_string())?;
    let socket: UdpSocket = socket.into();
    socket
        .set_nonblocking(true)
        .map_err(|err| err.to_string())?;
    Ok((socket, true))
}

fn resolve_local_ipv4(config: &RtcConfig) -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    for server in &config.ice_servers {
        for url in &server.urls {
            if let Some(server_addr) = parse_stun_url_v4(url)
                && socket.connect(server_addr).is_ok()
                && let Ok(addr) = socket.local_addr()
                && let IpAddr::V4(ip) = addr.ip()
                && !ip.is_unspecified()
            {
                return Some(ip);
            }
        }
    }
    if socket.connect("8.8.8.8:80").is_err() {
        return None;
    }
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if !ip.is_unspecified() => Some(ip),
        _ => None,
    }
}

fn resolve_local_ipv6() -> Option<Ipv6Addr> {
    let socket = UdpSocket::bind("[::]:0").ok()?;
    if socket.connect("[2001:4860:4860::8888]:80").is_err() {
        return None;
    }
    match socket.local_addr().ok()?.ip() {
        IpAddr::V6(ip) if !ip.is_unspecified() => Some(ip),
        _ => None,
    }
}

fn build_stun_queries(config: &RtcConfig, local_addr: SocketAddr) -> Vec<StunQuery> {
    let mut queries = Vec::new();
    for server in &config.ice_servers {
        for url in &server.urls {
            if let Some(server_addr) = parse_stun_url_v4(url) {
                queries.push(StunQuery {
                    server: server_addr,
                    url: url.clone(),
                    tx_id: TransactionId::new(),
                    sent_at: Instant::now()
                        .checked_sub(STUN_RETRY_INTERVAL)
                        .expect("STUN_RETRY_INTERVAL should be subtractable from now"),
                    attempts: 0,
                    done: false,
                });
            } else {
                info!("Failed to resolve IPv4 STUN server: {url}");
            }
        }
    }

    let _ = local_addr;
    queries
}

fn parse_stun_url_v4(url: &str) -> Option<SocketAddr> {
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

fn sanitize_remote_sdp(allow_ipv6: bool, sdp: &str) -> String {
    let mut output = String::with_capacity(sdp.len());
    for line in sdp.lines() {
        let line = line.trim_end_matches('\r');
        if let Some(candidate_line) = line
            .strip_prefix("a=candidate:")
            .or_else(|| line.strip_prefix("candidate:"))
        {
            let mut parts = candidate_line.split_whitespace();
            let _foundation = parts.next();
            let _component = parts.next();
            let _transport = parts.next();
            let _priority = parts.next();
            let addr = parts.next().unwrap_or("");
            if addr.to_ascii_lowercase().ends_with(".local") {
                continue;
            }
            if !allow_ipv6 && addr.contains(':') {
                continue;
            }
        }
        output.push_str(line);
        output.push_str("\r\n");
    }
    output
}

fn select_local_addr(peer: &Peer, peer_addr: SocketAddr) -> SocketAddr {
    let port = peer.local_addr.port();
    match peer_addr {
        SocketAddr::V4(_) => SocketAddr::new(
            peer.local_ipv4
                .map_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED), IpAddr::V4),
            port,
        ),
        SocketAddr::V6(_) => SocketAddr::new(
            peer.local_ipv6
                .map_or(IpAddr::V6(Ipv6Addr::UNSPECIFIED), IpAddr::V6),
            port,
        ),
    }
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

    if peer.local_ipv4.is_none() && peer.local_ipv6.is_none() {
        info!(
            "Native skipping host candidates for {} because local IPs are unavailable",
            peer.key
        );
    } else {
        if let Some(ipv4) = peer.local_ipv4
            && let Err(err) = add_host_candidate(peer, IpAddr::V4(ipv4))
        {
            info!(
                "Native IPv4 host candidate failed for {}: {}",
                peer.key, err
            );
        }
        if let Some(ipv6) = peer.local_ipv6
            && let Err(err) = add_host_candidate(peer, IpAddr::V6(ipv6))
        {
            info!(
                "Native IPv6 host candidate failed for {}: {}",
                peer.key, err
            );
        }
    }

    start_stun_gather(peer);
    peer.needs_gather = false;
}

fn add_host_candidate(peer: &mut Peer, ip: IpAddr) -> Result<(), String> {
    let host_candidate = CandidateHostConfig {
        base_config: CandidateConfig {
            network: "udp".to_string(),
            address: ip.to_string(),
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
        mark_ice_gathering_complete(peer);
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
        mark_ice_gathering_complete(peer);
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

    if peer.local_ipv4.is_none() {
        info!(
            "Native server-reflexive candidate for {} has unspecified local IPv4",
            peer.key
        );
    }
    let rel_addr = peer
        .local_ipv4
        .map_or_else(|| "0.0.0.0".to_string(), |ip| ip.to_string());
    let config = CandidateServerReflexiveConfig {
        base_config: CandidateConfig {
            network: "udp".to_string(),
            address: mapped.ip.to_string(),
            port: mapped.port,
            component: 1,
            ..Default::default()
        },
        rel_addr,
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
            RTCPeerConnectionEvent::OnDataChannel(RTCDataChannelEvent::OnOpen(channel_id)) => {
                peer.channel_open = true;
                peer.channel_id = Some(channel_id);
                info!("Native data channel opened: {channel_id}");
                if peer.role == PeerRole::Offerer && !peer.ping_started {
                    peer.next_ping_at = Some(Instant::now() + Duration::from_millis(200));
                    peer.ping_started = true;
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
                info!("Native ICE gathering state for {}: {}", peer.key, state);
                if state == RTCIceGatheringState::Gathering {
                    peer.ice_gathering_started_at = Some(Instant::now());
                }
                if state == RTCIceGatheringState::Complete {
                    mark_ice_gathering_complete(peer);
                }
            }
            RTCPeerConnectionEvent::OnIceConnectionStateChangeEvent(state) => {
                info!("Native ICE connection state for {}: {}", peer.key, state);
            }
            RTCPeerConnectionEvent::OnConnectionStateChangeEvent(state) => {
                info!("Native peer connection state for {}: {}", peer.key, state);
            }
            _ => {}
        }
    }

    while let Some(message) = peer.peer_connection.poll_read() {
        if let RTCMessage::DataChannelMessage(channel_id, data_channel_message) = message {
            let payload = data_channel_message.data.to_vec();
            if let Ok(text) = String::from_utf8(payload) {
                info!("Native data channel {channel_id} message: {text}");
                match text.as_str() {
                    "ping" => {
                        if peer.role == PeerRole::Answerer {
                            let _ = send_data_message(peer, "pong");
                        }
                    }
                    "pong" => {
                        if peer.role == PeerRole::Offerer {
                            peer.next_ping_at = Some(Instant::now() + Duration::from_secs(1));
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    if let Some(timeout) = peer.peer_connection.poll_timeout()
        && timeout <= now
    {
        peer.peer_connection
            .handle_timeout(now)
            .map_err(|err| err.to_string())?;
    }

    if !peer.ice_gathering_complete
        && let Some(started_at) = peer.ice_gathering_started_at
        && now.duration_since(started_at) >= ICE_GATHERING_TIMEOUT
    {
        mark_ice_gathering_complete(peer);
        info!("Native ICE gathering timed out; continuing with current candidates");
    }

    if peer.ice_gathering_complete && peer.needs_sdp_refresh {
        refresh_local_description(peer)?;
        peer.needs_sdp_refresh = false;
    }

    send_scheduled_ping(peer, now)?;

    let mut buf = [0u8; 2048];
    loop {
        match peer.socket.recv_from(&mut buf) {
            Ok((n, peer_addr)) => {
                if is_stun_message(&buf[..n]) {
                    if handle_stun_response(peer, &buf[..n])? {
                        continue;
                    }
                    if peer.peer_connection.remote_description().is_none() {
                        continue;
                    }
                }
                let local_addr = select_local_addr(peer, peer_addr);
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

fn mark_ice_gathering_complete(peer: &mut Peer) {
    if !peer.ice_gathering_complete {
        peer.ice_gathering_complete = true;
        peer.needs_sdp_refresh = true;
    }
}

fn refresh_local_description(peer: &mut Peer) -> Result<(), String> {
    if peer.peer_connection.remote_description().is_none() {
        let offer = peer
            .peer_connection
            .create_offer(None)
            .map_err(|err| err.to_string())?;
        peer.peer_connection
            .set_local_description(offer)
            .map_err(|err| err.to_string())?;
        info!("Native refreshed offer SDP for {}", peer.key);
        return Ok(());
    }

    if peer.peer_connection.local_description().is_some() {
        info!(
            "Native skipping SDP refresh for {} (local description already set)",
            peer.key
        );
        return Ok(());
    }

    let answer = peer
        .peer_connection
        .create_answer(None)
        .map_err(|err| err.to_string())?;
    peer.peer_connection
        .set_local_description(answer)
        .map_err(|err| err.to_string())?;
    info!("Native generated answer SDP for {}", peer.key);
    Ok(())
}

fn send_scheduled_ping(peer: &mut Peer, now: Instant) -> Result<(), String> {
    if peer.role != PeerRole::Offerer {
        return Ok(());
    }
    let Some(when) = peer.next_ping_at else {
        return Ok(());
    };
    if when > now {
        return Ok(());
    }
    if peer.channel_open && peer.channel_id.is_some() {
        send_data_message(peer, "ping")?;
        peer.next_ping_at = None;
    }
    Ok(())
}

fn send_data_message(peer: &mut Peer, payload: &str) -> Result<(), String> {
    let Some(channel_id) = peer.channel_id else {
        return Err("Data channel not ready".to_string());
    };
    let msg = RTCDataChannelMessage {
        is_string: true,
        data: BytesMut::from(payload.as_bytes()),
    };
    peer.peer_connection
        .handle_write(RTCMessage::DataChannelMessage(channel_id, msg))
        .map_err(|err| err.to_string())
}
