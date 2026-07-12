#![warn(clippy::pedantic)]

use od_core::{
    Dir, EventKind, InputArena, KeyCode, ProgramId, Vec3i, WorldCommand, WorldIntent, WorldReplay,
    WorldReplayEvent, world_state_hash,
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
    world_input: WorldInputState,
    sim_accumulator_ms: f32,
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
impl UiEngine {
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen(constructor))]
    pub fn new() -> Self {
        Self {
            engine: DomainEngine::new(),
            input: InputArena::default(),
            world: WorldSim::new(od_core::WorldConfig::default(), true),
            world_input: WorldInputState::default(),
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

    pub fn step_sim_ticks(&mut self, n: u32) {
        self.ingest_world_input_from_arena();
        for _ in 0..n {
            self.advance_one_sim_tick();
        }
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
        self.sim_accumulator_ms = 0.0;
        Ok(self.combined_debug_snapshot_json())
    }

    pub fn frame(&mut self) -> u32 {
        let input_bytes = unsafe {
            std::slice::from_raw_parts(
                (&self.input as *const InputArena).cast::<u8>(),
                od_core::INPUT_ARENA_SIZE_BYTES as usize,
            )
        };
        let out = self.engine.frame(input_bytes);
        if let Some(decoded) = decode(input_bytes) {
            let world_context = !self.engine.shell.open && !self.engine.session_capture_active();
            self.world_input.ingest(&decoded, world_context);
            if world_context {
                self.advance_frame_sim_ticks(decoded.sampled.dt_ms);
            }
        }
        self.input.clear_queue();

        #[cfg(target_arch = "wasm32")]
        {
            for effect in out.host_effects {
                dispatch_host_effect(effect);
            }
        }

        out.draw_list_count
    }

    fn ingest_world_input_from_arena(&mut self) {
        let input_bytes = unsafe {
            std::slice::from_raw_parts(
                (&self.input as *const InputArena).cast::<u8>(),
                od_core::INPUT_ARENA_SIZE_BYTES as usize,
            )
        };
        if let Some(decoded) = decode(input_bytes) {
            let world_context = !self.engine.shell.open && !self.engine.session_capture_active();
            self.world_input.ingest(&decoded, world_context);
        }
        self.input.clear_queue();
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

    fn combined_debug_snapshot_json(&self) -> String {
        let mut snapshot = serde_json::from_str::<Value>(&self.engine.debug_snapshot_json())
            .unwrap_or_else(|_| json!({ "version": 2 }));
        if let Some(object) = snapshot.as_object_mut() {
            object.insert("world".to_owned(), self.world_debug_value());
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

        json!({
            "tick": snapshot.tick,
            "world_state_hash": hash,
            "worldStateHash": hash,
            "primary_entity_id": primary_entity_id,
            "primaryEntityId": primary_entity_id,
            "primary_entity_position": primary_entity_position,
            "primaryEntity": primary_entity,
            "entityCount": snapshot.entities.len(),
            "loadedChunkCount": snapshot.loaded_chunks.len(),
        })
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
                    if is_world_move_key(code) && self.held.insert(code) && world_context {
                        self.just_pressed.insert(code);
                    }
                }
                EventKind::KeyUp => {
                    let code = KeyCode::from_u16(event.code);
                    if code != KeyCode::Unknown {
                        self.held.remove(code);
                        self.just_pressed.remove(code);
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
}

fn is_world_move_key(code: KeyCode) -> bool {
    matches!(
        code,
        KeyCode::KeyE | KeyCode::KeyS | KeyCode::KeyD | KeyCode::KeyF
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

fn vec3i_json(value: Vec3i) -> Value {
    json!({
        "x": value.x,
        "y": value.y,
        "z": value.z,
    })
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
