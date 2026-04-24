use crate::protocol::{
    ChunkLayerPatch, ChunkKey, EntityPatchBatch, InputBatch, LayerId, RuntimeConfig,
    RuntimeControl, RuntimeEvent, SnapshotKind, Vec3i, ViewMode, ViewportIntent, WorldCommand,
    WorldSnapshot, WorldUpdate,
};
#[cfg(target_arch = "wasm32")]
use crate::protocol::{RuntimeMessage, RuntimeResponse};
use crate::telemetry::{SessionStatus, TelemetryFrame, TelemetrySession};
use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::Mutex;
#[cfg(target_arch = "wasm32")]
use std::cell::RefCell;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::closure::Closure;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::{JsCast, JsValue};
#[cfg(not(target_arch = "wasm32"))]
use std::time::Duration;
use world_sim::world_core::WorldState;

enum Backend {
    #[cfg(not(target_arch = "wasm32"))]
    Threaded {
        control_tx: std::sync::mpsc::Sender<ControlMessage>,
        event_rx: Mutex<std::sync::mpsc::Receiver<RuntimeEvent>>,
        shared_session: Arc<Mutex<TelemetrySession>>,
    },
    #[cfg(target_arch = "wasm32")]
    Worker {
        worker: web_sys::Worker,
        _message_closure: Closure<dyn FnMut(web_sys::MessageEvent)>,
        shared_session: Arc<Mutex<TelemetrySession>>,
        event_queue: Arc<Mutex<VecDeque<RuntimeEvent>>>,
    },
    #[allow(dead_code)]
    Inline {
        core: Mutex<RuntimeCore>,
    },
}

#[cfg(not(target_arch = "wasm32"))]
enum ControlMessage {
    Input(InputBatch),
    Viewport(ViewportIntent),
    Control(RuntimeControl),
}

struct RuntimeCore {
    world: WorldState,
    config: RuntimeConfig,
    pending_commands: Vec<WorldCommand>,
    pending_viewport: Option<ViewportIntent>,
    session: TelemetrySession,
    shared_session: Arc<Mutex<TelemetrySession>>,
    next_tick_at_ms: u128,
    worker_frame_id: u64,
    active: bool,
    initial_snapshot_sent: bool,
    events: VecDeque<RuntimeEvent>,
}

impl RuntimeCore {
    fn new(config: RuntimeConfig, shared_session: Arc<Mutex<TelemetrySession>>) -> Self {
        let mut world = WorldState::new(config.world_config.clone());
        if config.spawn_default_player {
            world
                .spawn_entity_auto(Vec3i::ZERO)
                .expect("default player should spawn in bounds");
        }

        let session = TelemetrySession::new(
            config.session_id.clone(),
            config.build_id.clone(),
            format!("{:?}", config.mode),
            format!("{:?}", config.transport),
        );

        let mut core = Self {
            world,
            config,
            pending_commands: Vec::new(),
            pending_viewport: None,
            session,
            shared_session,
            next_tick_at_ms: now_millis() + 50,
            worker_frame_id: 0,
            active: true,
            initial_snapshot_sent: false,
            events: VecDeque::new(),
        };

        core.events.push_back(RuntimeEvent::SessionStarted {
            session_id: core.config.session_id.clone(),
            build_id: core.config.build_id.clone(),
            mode: core.config.mode,
            transport: core.config.transport,
        });
        core.events.push_back(RuntimeEvent::RuntimeReady);
        if let Some(viewport) = core.config.initial_viewport {
            core.pending_viewport = Some(viewport);
        }
        core.emit_initial_snapshot();
        core.sync_shared_session();
        core
    }

    fn sync_shared_session(&self) {
        let mut shared_session = self
            .shared_session
            .lock()
            .expect("runtime shared session lock should be available");
        *shared_session = self.session.clone();
    }

    fn emit_initial_snapshot(&mut self) {
        if self.initial_snapshot_sent {
            return;
        }
        self.initial_snapshot_sent = true;
        self.events.push_back(RuntimeEvent::InitialSnapshotStarted);
        let snapshot = self.world.snapshot();
        self.events.push_back(RuntimeEvent::InitialSnapshotProgress {
            completed_chunks: 1,
            total_chunks: 1,
        });
        self.events
            .push_back(RuntimeEvent::InitialSnapshotChunkLayer(
                self.snapshot_to_patch(
                    &snapshot,
                    ChunkKey::new(0, 0, 0),
                    LayerId::Floor,
                    SnapshotKind::Initial,
                ),
            ));
        self.events
            .push_back(RuntimeEvent::InitialSnapshotEntities(EntityPatchBatch {
                worker_frame_id: self.worker_frame_id,
                updates: vec![WorldUpdate::Snapshot(snapshot)],
            }));
        self.events.push_back(RuntimeEvent::InitialSnapshotComplete);
    }

    fn snapshot_to_patch(
        &self,
        snapshot: &WorldSnapshot,
        chunk: ChunkKey,
        layer: LayerId,
        kind: SnapshotKind,
    ) -> ChunkLayerPatch {
        let full_chunk = matches!(kind, SnapshotKind::Initial | SnapshotKind::Resync);
        let payload = bincode::serde::encode_to_vec(snapshot, bincode::config::standard())
            .expect("snapshot should serialize for patch payload");
        ChunkLayerPatch {
            chunk,
            layer,
            revision: snapshot.tick,
            worker_frame_id: self.worker_frame_id,
            full_chunk,
            tile_data: payload,
        }
    }

    fn queue_input(&mut self, input: InputBatch) {
        self.pending_commands.extend(input.commands);
    }

    fn queue_viewport(&mut self, viewport: ViewportIntent) {
        self.pending_viewport = Some(viewport);
    }

    fn request_resync(&mut self, reason: String) {
        self.events.push_back(RuntimeEvent::ResyncStarted {
            reason: reason.clone(),
        });
        let snapshot = self.world.snapshot();
        self.events
            .push_back(RuntimeEvent::ResyncChunkLayer(self.snapshot_to_patch(
                &snapshot,
                ChunkKey::new(0, 0, 0),
                LayerId::Floor,
                SnapshotKind::Resync,
            )));
        self.events
            .push_back(RuntimeEvent::ResyncEntities(EntityPatchBatch {
                worker_frame_id: self.worker_frame_id,
                updates: vec![WorldUpdate::Snapshot(snapshot)],
            }));
        self.events.push_back(RuntimeEvent::ResyncComplete);
        self.session
            .set_status(SessionStatus::DesyncedResync, Some(reason));
        self.sync_shared_session();
    }

    fn step(&mut self) {
        if !self.active {
            return;
        }

        self.worker_frame_id = self.worker_frame_id.saturating_add(1);
        let frame_start_ms = now_millis();
        let fov_ms = 0;

        if let Some(viewport) = self.pending_viewport.take() {
            let layer = match viewport.view_mode {
                ViewMode::Master => LayerId::Floor,
                ViewMode::Entity => LayerId::Fog,
            };
            self.events.push_back(RuntimeEvent::LayerSnapshotStarted {
                layer,
            });
            self.events.push_back(RuntimeEvent::LayerSnapshotProgress {
                layer,
                completed_chunks: 1,
                total_chunks: 1,
            });
            self.events
                .push_back(RuntimeEvent::LayerSnapshotComplete { layer });
        }

        let mut updates = Vec::new();
        let sim_start_ms = now_millis();
        for command in self.pending_commands.drain(..) {
            if let Some(update) = self.world.apply_command(command) {
                updates.push(WorldUpdate::Delta(update));
            }
        }
        if let Some(update) = self.world.advance_active_movements_one_tick() {
            updates.push(WorldUpdate::Delta(update));
        }
        if !updates.is_empty() {
            self.events
                .push_back(RuntimeEvent::EntityPatchBatch(EntityPatchBatch {
                    worker_frame_id: self.worker_frame_id,
                    updates,
                }));
        }
        let worker_sim_ms = now_millis().saturating_sub(sim_start_ms) as u64;

        let patch_start_ms = now_millis();
        let snapshot = self.world.snapshot();
        let patch = self.snapshot_to_patch(
            &snapshot,
            ChunkKey::new(0, 0, 0),
            LayerId::Floor,
            SnapshotKind::Initial,
        );
        self.events.push_back(RuntimeEvent::ChunkLayerPatch(patch));
        let patch_build_ms = now_millis().saturating_sub(patch_start_ms) as u64;

        let ser_start_ms = now_millis();
        let _serialized =
            bincode::serde::encode_to_vec(&snapshot, bincode::config::standard())
                .expect("snapshot should serialize");
        let serialization_ms = now_millis().saturating_sub(ser_start_ms) as u64;
        let patch_apply_ms = 0;

        let snapshot_progress_percent = if self.initial_snapshot_sent {
            100
        } else {
            0
        };

        let frame_ms = now_millis().saturating_sub(frame_start_ms) as u64;
        let telemetry = TelemetryFrame {
            frame_ms,
            worker_sim_ms,
            fov_ms,
            patch_build_ms,
            serialization_ms,
            patch_apply_ms,
            queue_depth: self.pending_commands.len() as u32,
            hot_chunks: 1,
            warm_chunks: 0,
            cold_chunks: 0,
            stale_chunks: 0,
            dropped_superseded_patches: 0,
            coalesced_patches: 0,
            snapshot_progress_percent,
        };
        self.session.record_frame(telemetry.clone());
        self.events.push_back(RuntimeEvent::TelemetryFrame(telemetry));

        self.session.set_status(SessionStatus::Running, None);
        self.sync_shared_session();

        if frame_ms < 50 {
            self.next_tick_at_ms = now_millis() + 50;
        } else {
            self.next_tick_at_ms = now_millis();
        }
    }

    fn drain_events(&mut self) -> Vec<RuntimeEvent> {
        if self.initial_snapshot_sent {
            while now_millis() >= self.next_tick_at_ms {
                self.step();
                if self.next_tick_at_ms <= now_millis() {
                    break;
                }
            }
        }
        self.events.drain(..).collect()
    }

    fn shutdown(&mut self, status: SessionStatus) {
        self.active = false;
        self.session.set_status(status, None);
        self.events.push_back(RuntimeEvent::SessionEnded(status));
        self.sync_shared_session();
    }
}

fn now_millis() -> u128 {
    #[cfg(target_arch = "wasm32")]
    {
        return js_sys::Date::now() as u128;
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};

        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_millis()
    }
}

#[cfg(target_arch = "wasm32")]
fn start_worker_backend(config: RuntimeConfig) -> Backend {
    let shared_session = Arc::new(Mutex::new(TelemetrySession::new(
        config.session_id.clone(),
        config.build_id.clone(),
        format!("{:?}", config.mode),
        format!("{:?}", config.transport),
    )));
    let event_queue = Arc::new(Mutex::new(VecDeque::new()));
    let worker_script_url = config
        .worker_script_url
        .as_ref()
        .expect("worker transport requires a worker script url")
        .clone();
    let worker = spawn_runtime_worker(&worker_script_url);

    let worker_event_queue = Arc::clone(&event_queue);
    let worker_shared_session = Arc::clone(&shared_session);
    let message_closure = Closure::wrap(Box::new(move |event: web_sys::MessageEvent| {
        if let Some(response) = decode_worker_response(event.data()) {
            let mut session = worker_shared_session
                .lock()
                .expect("runtime shared session lock should be available");
            match response {
                RuntimeResponse::Batch { events, session: snapshot } => {
                    *session = snapshot;
                    let mut queue = worker_event_queue
                        .lock()
                        .expect("runtime worker event queue should be available");
                    for event in events {
                        queue.push_back(event);
                    }
                }
            }
        }
    }) as Box<dyn FnMut(web_sys::MessageEvent)>);
    worker.set_onmessage(Some(message_closure.as_ref().unchecked_ref()));

    if let Err(err) = post_worker_message(&worker, &RuntimeMessage::Start(config)) {
        eprintln!("Failed to start runtime worker: {}", err);
    }

    Backend::Worker {
        worker,
        _message_closure: message_closure,
        shared_session,
        event_queue,
    }
}

#[cfg(target_arch = "wasm32")]
fn spawn_runtime_worker(worker_script_url: &str) -> web_sys::Worker {
    use web_sys::{Worker, WorkerOptions, WorkerType};

    let options = WorkerOptions::new();
    options.set_type(WorkerType::Module);
    Worker::new_with_options(worker_script_url, &options)
        .expect("runtime worker should be created")
}

#[cfg(target_arch = "wasm32")]
fn post_worker_message(worker: &web_sys::Worker, message: &RuntimeMessage) -> Result<(), String> {
    let bytes = bincode::serde::encode_to_vec(message, bincode::config::standard())
        .expect("runtime message should serialize");
    let payload = js_sys::Uint8Array::from(bytes.as_slice());
    worker
        .post_message(&JsValue::from(payload))
        .map_err(|err| {
            err.as_string()
                .unwrap_or_else(|| String::from("worker postMessage failed"))
        })
}

#[cfg(target_arch = "wasm32")]
fn decode_worker_response(value: JsValue) -> Option<RuntimeResponse> {
    let payload = js_sys::Uint8Array::new(&value);
    if payload.length() == 0 {
        return None;
    }

    let mut bytes = vec![0; payload.length() as usize];
    payload.copy_to(&mut bytes);
    bincode::serde::decode_from_slice(&bytes, bincode::config::standard())
        .ok()
        .map(|(message, _)| message)
}

#[cfg(target_arch = "wasm32")]
thread_local! {
    static WORKER_RUNTIME_STATE: RefCell<Option<RuntimeWorkerState>> = const { RefCell::new(None) };
}

#[cfg(target_arch = "wasm32")]
struct RuntimeWorkerState {
    core: Option<RuntimeCore>,
    shared_session: Option<Arc<Mutex<TelemetrySession>>>,
    scope: web_sys::DedicatedWorkerGlobalScope,
    _on_message: Closure<dyn FnMut(web_sys::MessageEvent)>,
    _on_tick: Closure<dyn FnMut()>,
}

#[cfg(target_arch = "wasm32")]
impl RuntimeWorkerState {
    fn new() -> Self {
        let scope: web_sys::DedicatedWorkerGlobalScope = js_sys::global().unchecked_into();
        let on_message = Closure::wrap(Box::new(move |event: web_sys::MessageEvent| {
            WORKER_RUNTIME_STATE.with(|state| {
                let mut state = state.borrow_mut();
                if let Some(runtime_state) = state.as_mut() {
                    runtime_state.handle_message(event);
                }
            });
        }) as Box<dyn FnMut(web_sys::MessageEvent)>);
        scope.set_onmessage(Some(on_message.as_ref().unchecked_ref()));

        let on_tick = Closure::wrap(Box::new(move || {
            WORKER_RUNTIME_STATE.with(|state| {
                let mut state = state.borrow_mut();
                if let Some(runtime_state) = state.as_mut() {
                    runtime_state.tick();
                }
            });
        }) as Box<dyn FnMut()>);
        scope
            .set_interval_with_callback_and_timeout_and_arguments_0(
                on_tick.as_ref().unchecked_ref(),
                16,
            )
            .expect("runtime worker interval should start");

        Self {
            core: None,
            shared_session: None,
            scope,
            _on_message: on_message,
            _on_tick: on_tick,
        }
    }

    fn handle_message(&mut self, event: web_sys::MessageEvent) {
        let Some(message) = decode_worker_message(event.data()) else {
            eprintln!("runtime worker received an undecodable message");
            return;
        };

        match message {
            RuntimeMessage::Start(config) => {
                let shared_session = Arc::new(Mutex::new(TelemetrySession::new(
                    config.session_id.clone(),
                    config.build_id.clone(),
                    format!("{:?}", config.mode),
                    format!("{:?}", config.transport),
                )));
                self.shared_session = Some(Arc::clone(&shared_session));
                self.core = Some(RuntimeCore::new(config, shared_session));
                self.flush();
            }
            RuntimeMessage::Input(input) => {
                if let Some(core) = self.core.as_mut() {
                    core.queue_input(input);
                    self.flush();
                }
            }
            RuntimeMessage::Viewport(viewport) => {
                if let Some(core) = self.core.as_mut() {
                    core.queue_viewport(viewport);
                    self.flush();
                }
            }
            RuntimeMessage::Control(control) => {
                if let Some(core) = self.core.as_mut() {
                    match control {
                        RuntimeControl::Shutdown => {
                            core.shutdown(SessionStatus::Completed);
                            self.flush();
                        }
                        RuntimeControl::RequestResync { reason, viewport } => {
                            core.queue_viewport(viewport);
                            core.request_resync(reason);
                            self.flush();
                        }
                    }
                }
            }
        }
    }

    fn tick(&mut self) {
        if self.core.is_some() {
            self.flush();
        }
    }

    fn flush(&mut self) {
        let Some(core) = self.core.as_mut() else {
            return;
        };

        let events = core.drain_events();
        if events.is_empty() {
            return;
        }

        self.push_response(events);
    }

    fn push_response(&self, events: Vec<RuntimeEvent>) {
        let Some(shared_session) = self.shared_session.as_ref() else {
            return;
        };
        let session = shared_session
            .lock()
            .expect("runtime worker session lock should be available")
            .clone();
        let response = RuntimeResponse::Batch {
            events,
            session,
        };
        let bytes = bincode::serde::encode_to_vec(&response, bincode::config::standard())
            .expect("runtime response should serialize");
        self.scope
            .post_message(&JsValue::from(js_sys::Uint8Array::from(
                bytes.as_slice(),
            )))
            .expect("runtime worker should post response");
    }
}

#[cfg(target_arch = "wasm32")]
fn decode_worker_message(value: JsValue) -> Option<RuntimeMessage> {
    let payload = js_sys::Uint8Array::new(&value);
    if payload.length() == 0 {
        return None;
    }

    let mut bytes = vec![0; payload.length() as usize];
    payload.copy_to(&mut bytes);
    bincode::serde::decode_from_slice(&bytes, bincode::config::standard())
        .ok()
        .map(|(message, _)| message)
}

#[cfg(target_arch = "wasm32")]
pub fn runtime_worker_main() {
    WORKER_RUNTIME_STATE.with(|state| {
        let mut state = state.borrow_mut();
        if state.is_none() {
            *state = Some(RuntimeWorkerState::new());
        }
    });
}

pub struct RuntimeHandle {
    backend: Backend,
}

impl RuntimeHandle {
    #[must_use]
    pub fn start(config: RuntimeConfig) -> Self {
        #[cfg(target_arch = "wasm32")]
        {
            if matches!(config.transport, crate::protocol::RuntimeTransport::Worker) {
                return Self {
                    backend: start_worker_backend(config),
                };
            }

            let shared_session = Arc::new(Mutex::new(TelemetrySession::new(
                config.session_id.clone(),
                config.build_id.clone(),
                format!("{:?}", config.mode),
                format!("{:?}", config.transport),
            )));
            Self {
                backend: Backend::Inline {
                    core: Mutex::new(RuntimeCore::new(config, shared_session)),
                },
            }
        }

        #[cfg(not(target_arch = "wasm32"))]
        {
            let (control_tx, control_rx) = std::sync::mpsc::channel::<ControlMessage>();
            let (event_tx, event_rx) = std::sync::mpsc::channel::<RuntimeEvent>();
            let shared_session = Arc::new(Mutex::new(TelemetrySession::new(
                config.session_id.clone(),
                config.build_id.clone(),
                format!("{:?}", config.mode),
                format!("{:?}", config.transport),
            )));
            let worker_shared_session = Arc::clone(&shared_session);
            std::thread::spawn(move || {
                let mut core = RuntimeCore::new(config, worker_shared_session);
                core.events.drain(..).for_each(|event| {
                    let _ = event_tx.send(event);
                });

                loop {
                    while let Ok(message) = control_rx.try_recv() {
                        match message {
                            ControlMessage::Input(input) => core.queue_input(input),
                            ControlMessage::Viewport(viewport) => core.queue_viewport(viewport),
                            ControlMessage::Control(RuntimeControl::Shutdown) => {
                                core.shutdown(SessionStatus::Completed);
                                core.drain_events().into_iter().for_each(|event| {
                                    let _ = event_tx.send(event);
                                });
                                return;
                            }
                            ControlMessage::Control(RuntimeControl::RequestResync {
                                reason,
                                viewport,
                            }) => {
                                core.queue_viewport(viewport);
                                core.request_resync(reason);
                            }
                        }
                    }

                    core.step();
                    for event in core.drain_events() {
                        let _ = event_tx.send(event);
                    }

                    std::thread::sleep(Duration::from_millis(16));
                }
            });

            Self {
                backend: Backend::Threaded {
                    control_tx,
                    event_rx: Mutex::new(event_rx),
                    shared_session,
                },
            }
        }
    }

    pub fn send_input(&self, input: InputBatch) -> Result<(), String> {
        match &self.backend {
            #[cfg(not(target_arch = "wasm32"))]
            Backend::Threaded { control_tx, .. } => control_tx
                .send(ControlMessage::Input(input))
                .map_err(|err| err.to_string()),
            #[cfg(target_arch = "wasm32")]
            Backend::Worker { worker, .. } => post_worker_message(worker, &RuntimeMessage::Input(input)),
            Backend::Inline { core } => {
                core.lock()
                    .expect("runtime core lock should be available")
                    .queue_input(input);
                Ok(())
            }
        }
    }

    pub fn send_viewport_intent(&self, viewport: ViewportIntent) -> Result<(), String> {
        match &self.backend {
            #[cfg(not(target_arch = "wasm32"))]
            Backend::Threaded { control_tx, .. } => control_tx
                .send(ControlMessage::Viewport(viewport))
                .map_err(|err| err.to_string()),
            #[cfg(target_arch = "wasm32")]
            Backend::Worker { worker, .. } => {
                post_worker_message(worker, &RuntimeMessage::Viewport(viewport))
            }
            Backend::Inline { core } => {
                core.lock()
                    .expect("runtime core lock should be available")
                    .queue_viewport(viewport);
                Ok(())
            }
        }
    }

    pub fn request_resync(
        &self,
        reason: String,
        viewport: ViewportIntent,
    ) -> Result<(), String> {
        match &self.backend {
            #[cfg(not(target_arch = "wasm32"))]
            Backend::Threaded { control_tx, .. } => control_tx
                .send(ControlMessage::Control(RuntimeControl::RequestResync {
                    reason,
                    viewport,
                }))
                .map_err(|err| err.to_string()),
            #[cfg(target_arch = "wasm32")]
            Backend::Worker { worker, .. } => post_worker_message(
                worker,
                &RuntimeMessage::Control(RuntimeControl::RequestResync {
                    reason,
                    viewport,
                }),
            ),
            Backend::Inline { core } => {
                let mut core = core
                    .lock()
                    .expect("runtime core lock should be available");
                core.queue_viewport(viewport);
                core.request_resync(reason);
                Ok(())
            }
        }
    }

    pub fn shutdown(&self) -> Result<(), String> {
        match &self.backend {
            #[cfg(not(target_arch = "wasm32"))]
            Backend::Threaded { control_tx, .. } => control_tx
                .send(ControlMessage::Control(RuntimeControl::Shutdown))
                .map_err(|err| err.to_string()),
            #[cfg(target_arch = "wasm32")]
            Backend::Worker { worker, .. } => {
                post_worker_message(worker, &RuntimeMessage::Control(RuntimeControl::Shutdown))
            }
            Backend::Inline { core } => {
                core.lock()
                    .expect("runtime core lock should be available")
                    .shutdown(SessionStatus::Completed);
                Ok(())
            }
        }
    }

    #[must_use]
    pub fn poll_events(&self) -> Vec<RuntimeEvent> {
        match &self.backend {
            #[cfg(not(target_arch = "wasm32"))]
            Backend::Threaded { event_rx, .. } => {
                let mut events = Vec::new();
                let receiver = event_rx
                    .lock()
                    .expect("runtime event receiver should be available");
                while let Ok(event) = receiver.try_recv() {
                    events.push(event);
                }
                events
            }
            #[cfg(target_arch = "wasm32")]
            Backend::Worker {
                event_queue,
                ..
            } => {
                let mut events = Vec::new();
                {
                    let mut queue = event_queue
                        .lock()
                        .expect("runtime worker event queue should be available");
                    while let Some(event) = queue.pop_front() {
                        events.push(event);
                    }
                }
                events
            }
            Backend::Inline { core } => core
                .lock()
                .expect("runtime core lock should be available")
                .drain_events(),
        }
    }

    #[must_use]
    pub fn session_snapshot(&self) -> TelemetrySession {
        match &self.backend {
            #[cfg(not(target_arch = "wasm32"))]
            Backend::Threaded { shared_session, .. } => shared_session
                .lock()
                .expect("runtime shared session lock should be available")
                .clone(),
            #[cfg(target_arch = "wasm32")]
            Backend::Worker { shared_session, .. } => shared_session
                .lock()
                .expect("runtime shared session lock should be available")
                .clone(),
            Backend::Inline { core } => core
                .lock()
                .expect("runtime core lock should be available")
                .session
                .clone(),
        }
    }

    #[must_use]
    pub fn current_report_short(&self) -> String {
        crate::reports::build_short_report(&self.session_snapshot())
    }

    #[must_use]
    pub fn current_report_long(&self) -> String {
        crate::reports::build_long_report(&self.session_snapshot())
    }

    #[must_use]
    pub fn current_report_json(&self) -> String {
        self.session_snapshot().to_json_string()
    }
}
