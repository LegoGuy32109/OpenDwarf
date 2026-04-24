use crate::protocol::{
    ChunkLayerPatch, ChunkKey, EntityPatchBatch, InputBatch, LayerId, RuntimeConfig,
    RuntimeControl, RuntimeEvent, SnapshotKind, Vec3i, ViewMode, ViewportIntent, WorldCommand,
    WorldSnapshot, WorldUpdate,
};
use crate::telemetry::{SessionStatus, TelemetryFrame, TelemetrySession};
use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::Mutex;
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
    #[allow(dead_code)]
    Inline {
        core: Mutex<RuntimeCore>,
    },
}

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

pub struct RuntimeHandle {
    backend: Backend,
}

impl RuntimeHandle {
    #[must_use]
    pub fn start(config: RuntimeConfig) -> Self {
        #[cfg(target_arch = "wasm32")]
        {
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
