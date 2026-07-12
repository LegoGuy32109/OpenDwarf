#![warn(clippy::pedantic)]

use std::collections::BTreeSet;

use od_core::{
    Dir, EventKind, InputArena, KeyCode, LocalWorldView, ProgramId, Vec3i, Vec3u, ViewGlobals,
    WorldCommand, WorldConfig, WorldIntent, WorldReplay, WorldReplayEvent, WorldViewMode,
    world_state_hash,
};
#[cfg(target_arch = "wasm32")]
use od_ui::HostEffect;
use od_ui::input::{HeldSet, decode};
use od_ui::{DomainEngine, MonospaceVga};
use od_world::WorldSim;
use serde_json::{Value, json};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

const SIM_TICK_MS: f32 = 1000.0 / 20.0;
const MAX_SIM_TICKS_PER_FRAME: u32 = 3;
const TILE_SIZE_PX: f32 = 16.0;
const CAMERA_PAN_PX_PER_SEC: f32 = 480.0;
const ENTITY_CAMERA_SMOOTH_RATE: f32 = 10.0;
const LOOK_OFFSET_DECAY_RATE: f32 = 5.0;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = globalThis)]
    fn host_leave_game();

    #[wasm_bindgen(js_namespace = globalThis)]
    fn host_persist_settings(ptr: u32, len: u32);

    #[wasm_bindgen(js_namespace = globalThis)]
    fn host_set_text_capture(active: u32, x: f32, y: f32, w: f32, h: f32, max_len: u32);
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub struct UiEngine {
    engine: DomainEngine<MonospaceVga>,
    input: InputArena,
    world: WorldSim,
    view: LocalWorldView,
    view_globals: ViewGlobals,
    world_input: WorldInputState,
    smooth_player_world_pos: Option<[f32; 2]>,
    counters: FrameCounters,
    sim_accumulator_ms: f32,
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
impl UiEngine {
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen(constructor))]
    pub fn new() -> Self {
        Self {
            engine: DomainEngine::new(),
            input: InputArena::default(),
            world: WorldSim::new(play_world_config(), true),
            view: LocalWorldView::default(),
            view_globals: ViewGlobals::default(),
            world_input: WorldInputState::default(),
            smooth_player_world_pos: None,
            counters: FrameCounters::default(),
            sim_accumulator_ms: 0.0,
        }
    }

    pub fn rect_ptr(&self) -> u32 {
        self.engine.rect_ptr()
    }

    pub fn rect_capacity(&self) -> u32 {
        self.engine.rect_capacity()
    }

    pub fn glyph_ptr(&self) -> u32 {
        self.engine.glyph_ptr()
    }

    pub fn glyph_capacity(&self) -> u32 {
        self.engine.glyph_capacity()
    }

    pub fn drawlist_ptr(&self) -> u32 {
        self.engine.drawlist_ptr()
    }

    pub fn drawlist_capacity(&self) -> u32 {
        self.engine.drawlist_capacity()
    }

    pub fn input_ptr(&self) -> u32 {
        (&self.input as *const InputArena).cast::<u8>() as u32
    }

    pub fn input_capacity(&self) -> u32 {
        od_core::INPUT_ARENA_SIZE_BYTES
    }

    pub fn view_globals_ptr(&self) -> u32 {
        (&self.view_globals as *const ViewGlobals).cast::<u8>() as u32
    }

    pub fn view_globals_capacity(&self) -> u32 {
        od_core::VIEW_GLOBALS_SIZE_BYTES
    }

    pub fn dropped_rects(&self) -> u32 {
        self.engine.dropped_rects()
    }

    pub fn dropped_glyphs(&self) -> u32 {
        self.engine.dropped_glyphs()
    }

    pub fn dropped_draw_cmds(&self) -> u32 {
        self.engine.dropped_draw_cmds()
    }

    pub fn abi_drawcmd_stride(&self) -> u32 {
        od_core::DRAWCMD_SIZE_BYTES
    }

    pub fn abi_rect_stride(&self) -> u32 {
        od_core::RECT_INSTANCE_STRIDE_BYTES
    }

    pub fn abi_rect_stride_floats(&self) -> u32 {
        od_core::RECT_INSTANCE_STRIDE_FLOATS
    }

    pub fn abi_glyph_stride(&self) -> u32 {
        od_core::GLYPH_INSTANCE_STRIDE_BYTES
    }

    pub fn abi_glyph_stride_floats(&self) -> u32 {
        od_core::GLYPH_INSTANCE_STRIDE_FLOATS
    }

    pub fn abi_program_rect(&self) -> u32 {
        ProgramId::Rect.as_u32()
    }

    pub fn abi_program_text(&self) -> u32 {
        ProgramId::Text.as_u32()
    }

    pub fn debug_snapshot_json(&self) -> String {
        self.combined_debug_snapshot_json()
    }

    pub fn debug_world_snapshot_json(&self) -> String {
        self.world_debug_value().to_string()
    }

    /// Compute-on-call draw hash (`"fnv1a64:<hex>"`). Not paid on the RAF path.
    pub fn debug_draw_hash(&self) -> String {
        self.engine.debug_draw_hash()
    }

    pub fn hydrate_settings(&mut self, bytes: &[u8]) {
        self.engine.hydrate_settings(bytes);
    }

    pub fn reset_for_harness(&mut self) {
        self.reset_world(WorldConfig::default());
    }

    pub fn reset_play_world(&mut self) {
        self.reset_world(play_world_config());
    }

    pub fn step_sim_ticks(&mut self, n: u32) {
        let sampled = self.ingest_world_input_from_arena();
        if let Some(sampled) = sampled {
            self.apply_view_key_presses();
            self.update_view_motion(SIM_TICK_MS, sampled.framebuffer_w, sampled.framebuffer_h);
        }
        for _ in 0..n {
            self.advance_one_sim_tick();
        }
        self.sync_local_view(SIM_TICK_MS, self.last_framebuffer_size());
    }

    pub fn import_replay_json(&mut self, bytes: &[u8]) -> Result<String, String> {
        let replay: WorldReplay = serde_json::from_slice(bytes)
            .map_err(|err| format!("failed to parse WorldReplay JSON: {err}"))?;
        if replay.metadata.format_version != od_core::WORLD_REPLAY_FORMAT_VERSION {
            return Err(format!(
                "unsupported WorldReplay format_version {} (expected {})",
                replay.metadata.format_version,
                od_core::WORLD_REPLAY_FORMAT_VERSION
            ));
        }
        let mut world = WorldSim::new(
            replay.metadata.world_config.clone(),
            replay.metadata.spawn_default_player,
        );
        for (index, event) in replay.events.iter().enumerate() {
            let WorldReplayEvent::Command {
                tick_before,
                command,
            } = event
            else {
                continue;
            };
            let actual = world.snapshot().tick;
            if actual != *tick_before {
                return Err(format!(
                    "WorldReplay tick mismatch at event {index}: expected {tick_before}, got {actual}"
                ));
            }
            world
                .send_command(command.clone())
                .map_err(|err| format!("WorldReplay command failed at event {index}: {err}"))?;
        }

        let final_snapshot = world.snapshot();
        let final_hash = world_state_hash(&final_snapshot);
        if final_hash != replay.final_state_hash {
            return Err(format!(
                "WorldReplay final hash mismatch: expected {}, got {final_hash}",
                replay.final_state_hash
            ));
        }

        self.world = world;
        self.world_input.clear();
        self.view = LocalWorldView::default();
        self.smooth_player_world_pos = None;
        self.sim_accumulator_ms = 0.0;
        self.sync_local_view(0.0, self.last_framebuffer_size());
        Ok(self.combined_debug_snapshot_json())
    }

    pub fn frame(&mut self) -> u32 {
        let input_bytes = unsafe {
            std::slice::from_raw_parts(
                (&self.input as *const InputArena).cast::<u8>(),
                od_core::INPUT_ARENA_SIZE_BYTES as usize,
            )
        };
        let decoded_sample = if let Some(decoded) = decode(input_bytes) {
            let world_context = !self.engine.shell.open && !self.engine.session_capture_active();
            self.world_input.ingest(&decoded, world_context);
            if world_context {
                self.apply_view_key_presses();
                self.update_view_motion(
                    decoded.sampled.dt_ms,
                    decoded.sampled.framebuffer_w,
                    decoded.sampled.framebuffer_h,
                );
                self.advance_frame_sim_ticks(decoded.sampled.dt_ms);
            }
            Some(decoded.sampled)
        } else {
            None
        };
        self.sync_local_view(
            decoded_sample.map_or(0.0, |sample| sample.dt_ms),
            decoded_sample.map_or_else(
                || self.last_framebuffer_size(),
                |sample| (sample.framebuffer_w, sample.framebuffer_h),
            ),
        );
        self.engine.set_session_hud_lines(self.session_hud_lines());
        let out = self.engine.frame(input_bytes);
        self.apply_submitted_chat(out.submitted_chat);
        self.input.clear_queue();

        #[cfg(target_arch = "wasm32")]
        {
            for effect in out.host_effects {
                dispatch_host_effect(effect);
            }
        }

        out.draw_list_count
    }

    fn ingest_world_input_from_arena(&mut self) -> Option<od_core::InputSampled> {
        let input_bytes = unsafe {
            std::slice::from_raw_parts(
                (&self.input as *const InputArena).cast::<u8>(),
                od_core::INPUT_ARENA_SIZE_BYTES as usize,
            )
        };
        if let Some(decoded) = decode(input_bytes) {
            let world_context = !self.engine.shell.open && !self.engine.session_capture_active();
            self.world_input.ingest(&decoded, world_context);
            let sampled = decoded.sampled;
            self.input.clear_queue();
            return Some(sampled);
        }
        self.input.clear_queue();
        None
    }

    fn advance_frame_sim_ticks(&mut self, dt_ms: f32) {
        self.sim_accumulator_ms += dt_ms.max(0.0);
        let mut ticks = 0_u32;
        while self.sim_accumulator_ms >= SIM_TICK_MS && ticks < MAX_SIM_TICKS_PER_FRAME {
            self.advance_one_sim_tick();
            self.sim_accumulator_ms -= SIM_TICK_MS;
            ticks = ticks.saturating_add(1);
        }
    }

    fn advance_one_sim_tick(&mut self) {
        self.process_player_movement();
        self.world.step_ticks(1);
        self.counters.record_sim_tick();
    }

    fn process_player_movement(&mut self) {
        let Some(entity_id) = self.world.primary_entity_id() else {
            self.world_input.clear_just_pressed();
            return;
        };
        let snapshot = self.world.snapshot();
        let active_entity = snapshot
            .entities
            .iter()
            .find(|entity| entity.id == entity_id);
        let is_moving = active_entity.is_some_and(|entity| entity.movement.is_some());
        let should_chain_held = self.world_input.was_moving_last_tick && !is_moving;
        self.world_input.was_moving_last_tick = is_moving;

        let just_pressed_dir = direction_from_keys(&self.world_input.just_pressed);
        let held_dir = direction_from_keys(&self.world_input.held);
        let just_pressed_non_zero = just_pressed_dir.is_some();
        if !is_moving {
            if let Some(direction) = just_pressed_dir {
                self.send_world_intent(WorldIntent::MovePlayer { direction });
            } else if should_chain_held && let Some(direction) = held_dir {
                self.send_world_intent(WorldIntent::MovePlayer { direction });
            }
        } else if just_pressed_non_zero {
            let active_dir = active_entity
                .and_then(|entity| entity.movement.as_ref())
                .map(|movement| {
                    Vec3i::new(
                        (movement.target.x - movement.origin.x).signum(),
                        (movement.target.y - movement.origin.y).signum(),
                        0,
                    )
                });
            let just_pressed_vec = just_pressed_dir.map(Dir::to_vec3i);
            let held_vec = held_dir.map(Dir::to_vec3i);
            let same_as_active = just_pressed_vec.is_some() && just_pressed_vec == active_dir;
            let active_in_held = match (active_dir, held_vec) {
                (Some(active), Some(held)) => {
                    (active.x == 0 || held.x.signum() == active.x)
                        && (active.y == 0 || held.y.signum() == active.y)
                }
                _ => false,
            };
            if !same_as_active
                && !active_in_held
                && let Some(direction) = just_pressed_dir
            {
                self.send_world_intent(WorldIntent::MovePlayer { direction });
            }
        }

        self.world_input.clear_just_pressed();
    }

    fn send_world_intent(&mut self, intent: WorldIntent) {
        match intent {
            WorldIntent::MovePlayer { direction } => {
                if let Some(id) = self.world.primary_entity_id() {
                    let _ = self.world.send_command(WorldCommand::MoveEntity {
                        id,
                        direction: direction.to_vec3i(),
                    });
                }
            }
            WorldIntent::WaitTicks { ticks } => {
                if ticks > 0 {
                    self.world.step_ticks(ticks);
                }
            }
        }
    }

    fn reset_world(&mut self, config: WorldConfig) {
        self.world = WorldSim::new(config, true);
        self.world_input.clear();
        self.view = LocalWorldView::default();
        self.view_globals = ViewGlobals::default();
        self.smooth_player_world_pos = None;
        self.sim_accumulator_ms = 0.0;
        self.sync_local_view(0.0, self.last_framebuffer_size());
    }

    fn apply_view_key_presses(&mut self) {
        if self.world_input.just_pressed.is_held(KeyCode::KeyR) {
            self.view.view_z = self.view.view_z.saturating_add(1);
        }
        if self.world_input.just_pressed.is_held(KeyCode::KeyV) {
            self.view.view_z = self.view.view_z.saturating_sub(1);
        }
        if self.world_input.just_pressed.is_held(KeyCode::KeyU) {
            self.view.step_zoom(-1);
        }
        if self.world_input.just_pressed.is_held(KeyCode::KeyM) {
            self.view.step_zoom(1);
        }
        let (min, max) = self.world.state().world_bounds();
        self.view.view_z = self.view.view_z.clamp(min.z, max.z);
        self.world_input.clear_view_just_pressed();
    }

    fn update_view_motion(&mut self, dt_ms: f32, framebuffer_w: u32, framebuffer_h: u32) {
        let dt_s = (dt_ms.max(0.0) / 1000.0).min(0.1);
        let up = self.world_input.held.is_held(KeyCode::KeyI);
        let down = self.world_input.held.is_held(KeyCode::KeyK);
        let left = self.world_input.held.is_held(KeyCode::KeyJ);
        let right = self.world_input.held.is_held(KeyCode::KeyL);
        let step = CAMERA_PAN_PX_PER_SEC * dt_s;

        if self.view.view_mode == WorldViewMode::Entity {
            if up && !down {
                self.view.look_offset.y -= step;
            }
            if down && !up {
                self.view.look_offset.y += step;
            }
            if left && !right {
                self.view.look_offset.x -= step;
            }
            if right && !left {
                self.view.look_offset.x += step;
            }
            if !up && !down && !left && !right {
                let rate = 1.0 - (-LOOK_OFFSET_DECAY_RATE * dt_s).exp();
                self.view.look_offset.x += (0.0 - self.view.look_offset.x) * rate;
                self.view.look_offset.y += (0.0 - self.view.look_offset.y) * rate;
                if self.view.look_offset.x.abs() < 0.5 {
                    self.view.look_offset.x = 0.0;
                }
                if self.view.look_offset.y.abs() < 0.5 {
                    self.view.look_offset.y = 0.0;
                }
            }
        } else {
            if left && !right {
                self.view.camera.x -= step;
            }
            if right && !left {
                self.view.camera.x += step;
            }
            if up && !down {
                self.view.camera.y -= step;
            }
            if down && !up {
                self.view.camera.y += step;
            }
        }

        self.write_view_globals(framebuffer_w, framebuffer_h);
    }

    fn sync_local_view(&mut self, dt_ms: f32, framebuffer: (u32, u32)) {
        self.counters.record_frame(dt_ms);
        let snapshot = self.world.snapshot();
        let Some(primary_entity_id) = self.world.primary_entity_id() else {
            self.write_view_globals(framebuffer.0, framebuffer.1);
            return;
        };
        let Some(entity) = snapshot
            .entities
            .iter()
            .find(|entity| entity.id == primary_entity_id)
        else {
            self.write_view_globals(framebuffer.0, framebuffer.1);
            return;
        };

        let entity_pos = entity_render_position_xy(entity);
        if self.smooth_player_world_pos.is_none() {
            self.smooth_player_world_pos = Some(entity_pos);
            if self.view.camera.x == 0.0 && self.view.camera.y == 0.0 {
                self.view.camera.x = (entity_pos[0] + 0.5) * TILE_SIZE_PX;
                self.view.camera.y = (entity_pos[1] + 0.5) * TILE_SIZE_PX;
                self.view.view_z = entity.position.z;
            }
        }
        if let Some(smooth) = self.smooth_player_world_pos.as_mut() {
            let dt_s = (dt_ms.max(0.0) / 1000.0).min(0.1);
            let rate = if dt_s <= 0.0 {
                1.0
            } else {
                1.0 - (-ENTITY_CAMERA_SMOOTH_RATE * dt_s).exp()
            };
            smooth[0] += (entity_pos[0] - smooth[0]) * rate;
            smooth[1] += (entity_pos[1] - smooth[1]) * rate;
            if self.view.view_mode == WorldViewMode::Entity {
                self.view.camera.x = (smooth[0] + 0.5) * TILE_SIZE_PX + self.view.look_offset.x;
                self.view.camera.y = (smooth[1] + 0.5) * TILE_SIZE_PX + self.view.look_offset.y;
            }
        }

        let (visible, streaming) =
            streaming_chunks_for_view(&self.view, &snapshot, entity.position, framebuffer);
        self.view.visible_chunks = visible.iter().copied().collect();
        self.view.streaming_chunks = streaming.iter().copied().collect();
        self.apply_streaming_chunks(&snapshot, &streaming);
        self.view.fps = self.counters.fps();
        self.view.tps = self.counters.tps();
        self.write_view_globals(framebuffer.0, framebuffer.1);
    }

    fn apply_streaming_chunks(
        &mut self,
        snapshot: &od_core::WorldSnapshot,
        desired: &std::collections::BTreeSet<Vec3i>,
    ) {
        for chunk in &snapshot.loaded_chunks {
            if !desired.contains(chunk) {
                let _ = self.world.send_command(WorldCommand::SetChunkLoaded {
                    chunk: *chunk,
                    loaded: false,
                });
            }
        }
        for chunk in desired {
            if !snapshot.loaded_chunks.contains(chunk) {
                let _ = self.world.send_command(WorldCommand::SetChunkLoaded {
                    chunk: *chunk,
                    loaded: true,
                });
            }
        }
    }

    fn write_view_globals(&mut self, framebuffer_w: u32, framebuffer_h: u32) {
        let snapshot = self.world.snapshot();
        self.view_globals = ViewGlobals {
            camera: [
                self.view.camera.x,
                self.view.camera.y,
                self.view.camera.zoom,
                0.0,
            ],
            canvas: [framebuffer_w as f32, framebuffer_h as f32, 1.0, 0.0],
            sim: [
                snapshot.tick as f32,
                self.view.view_z as f32,
                self.view.view_mode.as_abi_f32(),
                0.0,
            ],
        };
    }

    fn apply_submitted_chat(&mut self, submitted: Vec<String>) {
        for text in submitted {
            match text.trim().to_ascii_lowercase().as_str() {
                "/master" => self.view.view_mode = WorldViewMode::Master,
                "/entity" => self.view.view_mode = WorldViewMode::Entity,
                other if other.starts_with('/') => {}
                _ => {}
            }
        }
    }

    fn session_hud_lines(&self) -> Vec<String> {
        vec![
            format!(
                "mode: {}  z: {}  zoom: {:.2}",
                self.view.view_mode.as_str(),
                self.view.view_z,
                self.view.camera.zoom
            ),
            format!("fps: {:.0}  tps: {:.0}", self.view.fps, self.view.tps),
            format!(
                "chunks: {} visible / {} streaming",
                self.view.visible_chunks.len(),
                self.view.streaming_chunks.len()
            ),
        ]
    }

    fn last_framebuffer_size(&self) -> (u32, u32) {
        (
            self.view_globals.canvas[0].max(0.0) as u32,
            self.view_globals.canvas[1].max(0.0) as u32,
        )
    }

    fn combined_debug_snapshot_json(&self) -> String {
        let mut snapshot = serde_json::from_str::<Value>(&self.engine.debug_snapshot_json())
            .unwrap_or_else(|_| json!({ "version": 2 }));
        if let Some(object) = snapshot.as_object_mut() {
            object.insert("world".to_owned(), self.world_debug_value());
            let local_view = serde_json::to_value(&self.view).unwrap_or_else(|_| json!({}));
            object.insert("localWorldView".to_owned(), local_view.clone());
            object.insert("view".to_owned(), local_view);
            object.insert(
                "viewGlobals".to_owned(),
                json!({
                    "camera": self.view_globals.camera,
                    "canvas": self.view_globals.canvas,
                    "sim": self.view_globals.sim,
                }),
            );
        }
        snapshot.to_string()
    }

    fn world_debug_value(&self) -> Value {
        let snapshot = self.world.snapshot();
        let hash = world_state_hash(&snapshot);
        let primary_entity_id = self.world.primary_entity_id();
        let primary_entity = primary_entity_id
            .and_then(|id| snapshot.entities.iter().find(|entity| entity.id == id))
            .map(|entity| {
                json!({
                    "id": entity.id,
                    "position": vec3i_json(entity.position),
                    "movement": entity.movement.as_ref().map(|movement| {
                        json!({
                            "origin": vec3i_json(movement.origin),
                            "target": vec3i_json(movement.target),
                            "progressPercent": movement.progress_percent,
                            "occupiesOrigin": movement.occupies_origin,
                            "occupiesTarget": movement.occupies_target,
                        })
                    }),
                })
            });
        let primary_entity_position = primary_entity_id
            .and_then(|id| snapshot.entities.iter().find(|entity| entity.id == id))
            .map(|entity| vec3i_json(entity.position));
        let loaded_chunks = snapshot
            .loaded_chunks
            .iter()
            .map(|chunk| vec3i_json(*chunk))
            .collect::<Vec<_>>();

        json!({
            "tick": snapshot.tick,
            "chunkEdge": snapshot.chunk_edge,
            "worldChunks": vec3u_json(snapshot.world_chunks),
            "world_state_hash": hash,
            "worldStateHash": hash,
            "primary_entity_id": primary_entity_id,
            "primaryEntityId": primary_entity_id,
            "primary_entity_position": primary_entity_position,
            "primaryEntity": primary_entity,
            "entityCount": snapshot.entities.len(),
            "loadedChunkCount": snapshot.loaded_chunks.len(),
            "loadedChunks": loaded_chunks,
        })
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct FrameCounters {
    fps_accum: f32,
    frame_count: u32,
    fps_display: f32,
    tps_accum: f32,
    sim_ticks: u32,
    tps_display: f32,
}

impl FrameCounters {
    fn record_frame(&mut self, dt_ms: f32) {
        if dt_ms > 0.0 && dt_ms < 250.0 {
            self.fps_accum += dt_ms;
            self.frame_count = self.frame_count.saturating_add(1);
            if self.fps_accum >= 1000.0 {
                self.fps_display = self.frame_count as f32 * 1000.0 / self.fps_accum;
                self.fps_accum = 0.0;
                self.frame_count = 0;
            }
        }
        self.tps_accum += dt_ms.max(0.0);
        if self.tps_accum >= 1000.0 {
            self.tps_display = self.sim_ticks as f32 * 1000.0 / self.tps_accum;
            self.tps_accum = 0.0;
            self.sim_ticks = 0;
        }
    }

    fn record_sim_tick(&mut self) {
        self.sim_ticks = self.sim_ticks.saturating_add(1);
    }

    const fn fps(self) -> f32 {
        self.fps_display
    }

    const fn tps(self) -> f32 {
        self.tps_display
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct WorldInputState {
    held: HeldSet,
    just_pressed: HeldSet,
    was_moving_last_tick: bool,
}

impl WorldInputState {
    fn ingest(&mut self, decoded: &od_ui::input::DecodedInput<'_>, world_context: bool) {
        if decoded.sampled.window_focused == 0 {
            self.clear();
            return;
        }
        if decoded.queue.overflow != 0 {
            self.clear();
        }

        for event in decoded.events {
            match EventKind::from_u8(event.kind) {
                EventKind::KeyDown => {
                    let code = KeyCode::from_u16(event.code);
                    if is_world_key(code) && self.held.insert(code) && world_context {
                        self.just_pressed.insert(code);
                    }
                }
                EventKind::KeyUp => {
                    let code = KeyCode::from_u16(event.code);
                    if code != KeyCode::Unknown {
                        self.held.remove(code);
                    }
                }
                EventKind::Blur | EventKind::Resync => self.clear(),
                EventKind::Text | EventKind::Composition | EventKind::Unknown => {}
            }
        }

        if !world_context {
            self.clear();
        }
    }

    fn clear(&mut self) {
        self.held.clear();
        self.just_pressed.clear();
        self.was_moving_last_tick = false;
    }

    fn clear_just_pressed(&mut self) {
        self.just_pressed.clear();
    }

    fn clear_view_just_pressed(&mut self) {
        for code in [KeyCode::KeyR, KeyCode::KeyV, KeyCode::KeyU, KeyCode::KeyM] {
            self.just_pressed.remove(code);
        }
    }
}

fn is_world_key(code: KeyCode) -> bool {
    matches!(
        code,
        KeyCode::KeyE
            | KeyCode::KeyS
            | KeyCode::KeyD
            | KeyCode::KeyF
            | KeyCode::KeyI
            | KeyCode::KeyJ
            | KeyCode::KeyK
            | KeyCode::KeyL
            | KeyCode::KeyR
            | KeyCode::KeyV
            | KeyCode::KeyU
            | KeyCode::KeyM
    )
}

fn direction_from_keys(keys: &HeldSet) -> Option<Dir> {
    let x = if keys.is_held(KeyCode::KeyS) && !keys.is_held(KeyCode::KeyF) {
        -1
    } else if keys.is_held(KeyCode::KeyF) && !keys.is_held(KeyCode::KeyS) {
        1
    } else {
        0
    };
    let y = if keys.is_held(KeyCode::KeyE) && !keys.is_held(KeyCode::KeyD) {
        -1
    } else if keys.is_held(KeyCode::KeyD) && !keys.is_held(KeyCode::KeyE) {
        1
    } else {
        0
    };

    match (x, y) {
        (-1, 0) => Some(Dir::W),
        (1, 0) => Some(Dir::E),
        (0, -1) => Some(Dir::N),
        (0, 1) => Some(Dir::S),
        // Prefer horizontal movement for diagonal ESDF chords, matching the
        // single-intent `WorldIntent::MovePlayer` surface.
        (-1, _) => Some(Dir::W),
        (1, _) => Some(Dir::E),
        (0, _) => None,
        _ => None,
    }
}

fn play_world_config() -> WorldConfig {
    WorldConfig {
        world_chunks: Vec3u::new(9, 9, 1),
        ..WorldConfig::default()
    }
}

fn entity_render_position_xy(entity: &od_core::EntitySnapshot) -> [f32; 2] {
    if let Some(movement) = entity.movement.as_ref() {
        let fraction = f32::from(movement.progress_percent) / 100.0;
        [
            movement.start_position[0]
                + (movement.target.x as f32 - movement.start_position[0]) * fraction,
            movement.start_position[1]
                + (movement.target.y as f32 - movement.start_position[1]) * fraction,
        ]
    } else {
        [entity.position.x as f32, entity.position.y as f32]
    }
}

fn streaming_chunks_for_view(
    view: &LocalWorldView,
    snapshot: &od_core::WorldSnapshot,
    player_position: Vec3i,
    framebuffer: (u32, u32),
) -> (BTreeSet<Vec3i>, BTreeSet<Vec3i>) {
    let visible = chunk_window_from_camera(view, snapshot, framebuffer, 0);
    let mut streaming = chunk_window_from_camera(view, snapshot, framebuffer, 1);
    if view.view_mode == WorldViewMode::Entity
        && let Some(player_chunk) = world_position_to_chunk_coord(
            player_position,
            snapshot.chunk_edge,
            snapshot.world_chunks,
        )
    {
        for dy in -1..=1 {
            for dx in -1..=1 {
                let chunk = Vec3i::new(player_chunk.x + dx, player_chunk.y + dy, player_chunk.z);
                if chunk_in_bounds(chunk, snapshot.world_chunks) {
                    streaming.insert(chunk);
                }
            }
        }
    }
    (visible, streaming)
}

fn chunk_window_from_camera(
    view: &LocalWorldView,
    snapshot: &od_core::WorldSnapshot,
    framebuffer: (u32, u32),
    padding_chunks: i32,
) -> BTreeSet<Vec3i> {
    let zoom = view.camera.zoom.max(0.01);
    let framebuffer_w = framebuffer.0.max(1) as f32;
    let framebuffer_h = framebuffer.1.max(1) as f32;
    let half_w_tiles = framebuffer_w / (2.0 * zoom * TILE_SIZE_PX);
    let half_h_tiles = framebuffer_h / (2.0 * zoom * TILE_SIZE_PX);
    let center_x = view.camera.x / TILE_SIZE_PX;
    let center_y = view.camera.y / TILE_SIZE_PX;
    let min_x = (center_x - half_w_tiles).floor() as i32;
    let max_x = (center_x + half_w_tiles).floor() as i32;
    let min_y = (center_y - half_h_tiles).floor() as i32;
    let max_y = (center_y + half_h_tiles).floor() as i32;

    let z_chunk = world_position_to_chunk_coord(
        Vec3i::new(0, 0, view.view_z),
        snapshot.chunk_edge,
        snapshot.world_chunks,
    )
    .map_or(0, |chunk| chunk.z);

    let min_chunk = world_position_to_chunk_coord(
        Vec3i::new(min_x, min_y, view.view_z),
        snapshot.chunk_edge,
        snapshot.world_chunks,
    )
    .unwrap_or(Vec3i::new(
        -((snapshot.world_chunks.x as i32) / 2),
        -((snapshot.world_chunks.y as i32) / 2),
        z_chunk,
    ));
    let max_chunk = world_position_to_chunk_coord(
        Vec3i::new(max_x, max_y, view.view_z),
        snapshot.chunk_edge,
        snapshot.world_chunks,
    )
    .unwrap_or(Vec3i::new(
        snapshot.world_chunks.x as i32 / 2,
        snapshot.world_chunks.y as i32 / 2,
        z_chunk,
    ));

    let mut chunks = BTreeSet::new();
    for y in (min_chunk.y - padding_chunks)..=(max_chunk.y + padding_chunks) {
        for x in (min_chunk.x - padding_chunks)..=(max_chunk.x + padding_chunks) {
            let chunk = Vec3i::new(x, y, z_chunk);
            if chunk_in_bounds(chunk, snapshot.world_chunks) {
                chunks.insert(chunk);
            }
        }
    }
    chunks
}

fn world_position_to_chunk_coord(
    position: Vec3i,
    chunk_edge: u32,
    world_chunks: Vec3u,
) -> Option<Vec3i> {
    let world_size_x = world_chunks.x.checked_mul(chunk_edge)?;
    let world_size_y = world_chunks.y.checked_mul(chunk_edge)?;
    let world_size_z = world_chunks.z.checked_mul(chunk_edge)?;
    let min = Vec3i::new(
        -(i32::try_from(world_size_x).ok()? / 2),
        -(i32::try_from(world_size_y).ok()? / 2),
        -(i32::try_from(world_size_z).ok()? / 2),
    );
    let local_x = position.x - min.x;
    let local_y = position.y - min.y;
    let local_z = position.z - min.z;
    if local_x < 0 || local_y < 0 || local_z < 0 {
        return None;
    }
    let local_x = u32::try_from(local_x).ok()?;
    let local_y = u32::try_from(local_y).ok()?;
    let local_z = u32::try_from(local_z).ok()?;
    if local_x >= world_size_x || local_y >= world_size_y || local_z >= world_size_z {
        return None;
    }
    Some(Vec3i::new(
        i32::try_from(local_x / chunk_edge.max(1)).ok()? - i32::try_from(world_chunks.x).ok()? / 2,
        i32::try_from(local_y / chunk_edge.max(1)).ok()? - i32::try_from(world_chunks.y).ok()? / 2,
        i32::try_from(local_z / chunk_edge.max(1)).ok()? - i32::try_from(world_chunks.z).ok()? / 2,
    ))
}

fn chunk_in_bounds(chunk: Vec3i, world_chunks: Vec3u) -> bool {
    let offset_x = i32::try_from(world_chunks.x).unwrap_or(i32::MAX) / 2;
    let offset_y = i32::try_from(world_chunks.y).unwrap_or(i32::MAX) / 2;
    let offset_z = i32::try_from(world_chunks.z).unwrap_or(i32::MAX) / 2;
    let local_x = chunk.x + offset_x;
    let local_y = chunk.y + offset_y;
    let local_z = chunk.z + offset_z;
    local_x >= 0
        && local_y >= 0
        && local_z >= 0
        && u32::try_from(local_x).is_ok_and(|x| x < world_chunks.x)
        && u32::try_from(local_y).is_ok_and(|y| y < world_chunks.y)
        && u32::try_from(local_z).is_ok_and(|z| z < world_chunks.z)
}

fn vec3i_json(value: Vec3i) -> Value {
    json!({
        "x": value.x,
        "y": value.y,
        "z": value.z,
    })
}

fn vec3u_json(value: Vec3u) -> Value {
    json!({
        "x": value.x,
        "y": value.y,
        "z": value.z,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streaming_policy_adds_entity_safety_chunks() {
        let sim = WorldSim::new(play_world_config(), true);
        let snapshot = sim.snapshot();
        let player = snapshot.entities[0].position;
        let player_chunk =
            world_position_to_chunk_coord(player, snapshot.chunk_edge, snapshot.world_chunks)
                .expect("player chunk");
        let mut view = LocalWorldView {
            view_mode: WorldViewMode::Entity,
            camera: od_core::WorldCamera {
                x: 4.0 * snapshot.chunk_edge as f32 * TILE_SIZE_PX,
                y: 4.0 * snapshot.chunk_edge as f32 * TILE_SIZE_PX,
                zoom: 2.0,
            },
            ..LocalWorldView::default()
        };
        view.view_z = player.z;

        let (_visible, streaming) = streaming_chunks_for_view(&view, &snapshot, player, (320, 240));

        for dy in -1..=1 {
            for dx in -1..=1 {
                let chunk = Vec3i::new(player_chunk.x + dx, player_chunk.y + dy, player_chunk.z);
                if chunk_in_bounds(chunk, snapshot.world_chunks) {
                    assert!(streaming.contains(&chunk), "missing safety chunk {chunk:?}");
                }
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
fn dispatch_host_effect(effect: HostEffect) {
    match effect {
        HostEffect::LeaveGame => host_leave_game(),
        HostEffect::PersistSettings(bytes) => {
            host_persist_settings(bytes.as_ptr() as u32, bytes.len() as u32);
        }
        HostEffect::SetTextCapture {
            active,
            x,
            y,
            w,
            h,
            max_len,
        } => host_set_text_capture(u32::from(active), x, y, w, h, max_len),
    }
}
