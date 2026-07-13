#![warn(clippy::pedantic)]

use std::collections::BTreeSet;

use od_core::{
    ClientView, Dir, DrawCmd, EntityPerspective, EventKind, InputArena, KeyCode, LocalWorldView,
    ProgramId, Vec3i, Vec3u, ViewGlobals, WorldAtlasQuadInstance, WorldCommand, WorldConfig,
    WorldIntent, WorldReplay, WorldReplayEvent, WorldSolidQuadInstance, WorldViewMode,
    chunk_index_to_coord, draw_hash_with_world, draw_state_hash_with_world, format_state_hash,
    world_state_hash,
};
#[cfg(target_arch = "wasm32")]
use od_ui::HostEffect;
use od_ui::input::{HeldSet, decode};
use od_ui::{DomainEngine, MonospaceVga};
use od_world::WorldSim;
use od_world::project::{
    ProjectionSyncStats, compute_projection_window, project_entities, recompute_entity_perspective,
    sync_view_chunks, visible_chunk_layer,
};
use od_world::render::{RenderCaches, RenderInput, RenderStats, entity_render_position_xy};
use serde_json::{Value, json};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

const SIM_TICK_MS: f32 = 1000.0 / 20.0;
const MAX_SIM_TICKS_PER_FRAME: u32 = 3;
/// Accumulated sim lag is capped at the per-frame tick budget; anything past
/// it is discarded and counted in `droppedSimTimeMs` (no catch-up spiral).
const MAX_ACCUMULATED_SIM_MS: f32 = SIM_TICK_MS * MAX_SIM_TICKS_PER_FRAME as f32;
const TILE_SIZE_PX: f32 = 64.0;
const CAMERA_PAN_PX_PER_SEC: f32 = 480.0;
const ENTITY_CAMERA_SMOOTH_RATE: f32 = 10.0;
const LOOK_OFFSET_DECAY_RATE: f32 = 5.0;
const WORLD_ATLAS_CAPACITY: usize = 16_384;
const WORLD_SOLID_CAPACITY: usize = 4_096;
const COMBINED_DRAWCMD_CAPACITY: usize = 32;

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
    /// Render-owned caches (topmost columns this stage); derived data only.
    render_caches: RenderCaches,
    world_render_stats: RenderStats,
    world_atlas_quads: Vec<WorldAtlasQuadInstance>,
    world_solid_quads: Vec<WorldSolidQuadInstance>,
    draw_cmds: Vec<DrawCmd>,
    world_input: WorldInputState,
    smooth_player_world_pos: Option<[f32; 2]>,
    counters: FrameCounters,
    sim_accumulator_ms: f32,
    last_sampled_dpr: f32,
    /// Local read model consumed by `render()` (Stage 4): rebuilt after
    /// fixed ticks and lifecycle operations only, never on the RAF path.
    client_view: ClientView,
    /// Per-chunk visibility bitmaps + persistent memory (Stage 5).
    /// Recomputed at tick exit / lifecycle / explicit view-mode changes;
    /// render consumes it immutably.
    entity_perspective: EntityPerspective,
    last_projection_stats: ProjectionSyncStats,
    perspective_entity_position: Option<Vec3i>,
    perspective_view_mode: Option<WorldViewMode>,
    /// Simulated time discarded by the accumulated-lag cap.
    dropped_sim_time_ms: f64,
    /// Interpolation alpha handed to the most recent render (unused until
    /// the Stage 6 interpolation change).
    last_render_alpha: f32,
    /// Number of leading `draw_cmds` produced by the world renderer.
    world_draw_cmd_count: usize,
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
impl UiEngine {
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen(constructor))]
    pub fn new() -> Self {
        let mut engine = Self {
            engine: DomainEngine::new(),
            input: InputArena::default(),
            world: WorldSim::new(play_world_config(), true),
            view: LocalWorldView::default(),
            view_globals: ViewGlobals::default(),
            render_caches: RenderCaches::default(),
            world_render_stats: RenderStats::default(),
            world_atlas_quads: Vec::with_capacity(WORLD_ATLAS_CAPACITY),
            world_solid_quads: Vec::with_capacity(WORLD_SOLID_CAPACITY),
            draw_cmds: Vec::with_capacity(COMBINED_DRAWCMD_CAPACITY),
            world_input: WorldInputState::default(),
            smooth_player_world_pos: None,
            counters: FrameCounters::default(),
            sim_accumulator_ms: 0.0,
            last_sampled_dpr: 1.0,
            client_view: ClientView::default(),
            entity_perspective: EntityPerspective::default(),
            last_projection_stats: ProjectionSyncStats::default(),
            perspective_entity_position: None,
            perspective_view_mode: None,
            dropped_sim_time_ms: 0.0,
            last_render_alpha: 0.0,
            world_draw_cmd_count: 0,
        };
        // Boot is a lifecycle operation: project the ClientView before the
        // first frame so render never has to touch WorldState.
        engine.project_lifecycle_client_view();
        engine
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

    pub fn world_atlas_ptr(&self) -> u32 {
        self.world_atlas_quads.as_ptr() as u32
    }

    pub fn world_atlas_capacity(&self) -> u32 {
        self.world_atlas_quads.capacity() as u32
    }

    pub fn world_solid_ptr(&self) -> u32 {
        self.world_solid_quads.as_ptr() as u32
    }

    pub fn world_solid_capacity(&self) -> u32 {
        self.world_solid_quads.capacity() as u32
    }

    pub fn drawlist_ptr(&self) -> u32 {
        self.draw_cmds.as_ptr() as *const u8 as u32
    }

    pub fn drawlist_capacity(&self) -> u32 {
        self.draw_cmds.capacity() as u32
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

    pub fn abi_world_atlas_stride(&self) -> u32 {
        od_core::WORLD_ATLAS_QUAD_STRIDE_BYTES
    }

    pub fn abi_world_atlas_stride_floats(&self) -> u32 {
        od_core::WORLD_ATLAS_QUAD_STRIDE_FLOATS
    }

    pub fn abi_world_solid_stride(&self) -> u32 {
        od_core::WORLD_SOLID_QUAD_STRIDE_BYTES
    }

    pub fn abi_world_solid_stride_floats(&self) -> u32 {
        od_core::WORLD_SOLID_QUAD_STRIDE_FLOATS
    }

    pub fn abi_program_rect(&self) -> u32 {
        ProgramId::Rect.as_u32()
    }

    pub fn abi_program_text(&self) -> u32 {
        ProgramId::Text.as_u32()
    }

    pub fn abi_program_world_atlas_quad(&self) -> u32 {
        ProgramId::WorldAtlasQuad.as_u32()
    }

    pub fn abi_program_world_solid_quad(&self) -> u32 {
        ProgramId::WorldSolidQuad.as_u32()
    }

    pub fn debug_snapshot_json(&self) -> String {
        self.combined_debug_snapshot_json()
    }

    pub fn debug_world_snapshot_json(&self) -> String {
        self.world_debug_value().to_string()
    }

    /// Compute-on-call draw hash (`"fnv1a64:<hex>"`). Not paid on the RAF path.
    pub fn debug_draw_hash(&self) -> String {
        self.combined_draw_hash()
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

    /// Ingest pending input once, run exactly `n` fixed ticks, render once.
    pub fn step_sim_ticks(&mut self, n: u32) {
        let sampled = self.ingest_world_input_from_arena();
        if let Some((sampled, world_context)) = sampled {
            self.last_sampled_dpr = sanitize_dpr(sampled.dpr);
            if world_context {
                self.apply_view_key_presses();
                self.update_view_motion(SIM_TICK_MS, sampled.framebuffer_w, sampled.framebuffer_h);
            }
        }
        for _ in 0..n {
            self.run_fixed_tick(self.last_framebuffer_size());
        }
        self.sync_local_view(SIM_TICK_MS, self.last_framebuffer_size());
        self.render(0.0);
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
        let mut world = WorldSim::try_new(
            replay.metadata.world_config.clone(),
            replay.metadata.spawn_default_player,
        )
        .map_err(|err| format!("unsupported WorldReplay world config: {err}"))?;
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
        self.render_caches.reset();
        self.world_render_stats = RenderStats::default();
        self.world_atlas_quads.clear();
        self.world_solid_quads.clear();
        self.draw_cmds.clear();
        self.smooth_player_world_pos = None;
        self.sim_accumulator_ms = 0.0;
        self.reset_projection_state();
        self.engine.reset_session_shell();
        self.sync_local_view(0.0, self.last_framebuffer_size());
        // Lifecycle rebuild: fresh projection state means every entity starts
        // with prev_xy == curr_xy and every chunk is copied anew.
        self.project_lifecycle_client_view();
        self.render(0.0);
        Ok(self.combined_debug_snapshot_json())
    }

    pub fn frame(&mut self) -> u32 {
        self.world_render_stats.snapshot_calls_last_frame = 0;
        let input_bytes = unsafe {
            std::slice::from_raw_parts(
                (&self.input as *const InputArena).cast::<u8>(),
                od_core::INPUT_ARENA_SIZE_BYTES as usize,
            )
        };
        let decoded_sample = if let Some(decoded) = decode(input_bytes) {
            let world_context = !self.engine.shell.open && !self.engine.session_capture_active();
            self.world_input.ingest(&decoded, world_context);
            self.last_sampled_dpr = sanitize_dpr(decoded.sampled.dpr);
            if world_context {
                self.apply_view_key_presses();
                self.update_view_motion(
                    decoded.sampled.dt_ms,
                    decoded.sampled.framebuffer_w,
                    decoded.sampled.framebuffer_h,
                );
            }
            self.advance_frame_sim_ticks(
                decoded.sampled.dt_ms,
                (decoded.sampled.framebuffer_w, decoded.sampled.framebuffer_h),
            );
            Some(decoded.sampled)
        } else {
            None
        };
        let alpha = (self.sim_accumulator_ms / SIM_TICK_MS).clamp(0.0, 1.0);
        self.sync_local_view(
            decoded_sample.map_or(0.0, |sample| sample.dt_ms),
            decoded_sample.map_or_else(
                || self.last_framebuffer_size(),
                |sample| (sample.framebuffer_w, sample.framebuffer_h),
            ),
        );
        self.render(alpha);
        self.engine.set_session_hud_lines(self.session_hud_lines());
        let out = self.engine.frame(input_bytes);
        self.append_ui_draw_cmds();
        self.apply_submitted_chat(out.submitted_chat);
        self.input.clear_queue();

        #[cfg(target_arch = "wasm32")]
        {
            for effect in out.host_effects {
                dispatch_host_effect(effect);
            }
        }

        self.draw_cmds.len() as u32
    }

    /// World render (Stage 5): consumes only the projected [`ClientView`],
    /// the local view, the **immutable** entity perspective, and render
    /// caches. Performs zero `WorldSim::snapshot()` calls, never reads
    /// `WorldState`, and never recomputes FOV; it mutates render
    /// caches/arenas only. `alpha` is recorded but unused until the Stage 6
    /// interpolation change.
    fn render(&mut self, alpha: f32) -> u32 {
        self.last_render_alpha = alpha;
        self.world_atlas_quads.clear();
        self.world_solid_quads.clear();
        self.draw_cmds.clear();
        let output = od_world::render::render(
            RenderInput {
                client: &self.client_view,
                view: &self.view,
                smooth_player_xy: self.smooth_player_world_pos,
            },
            &self.entity_perspective,
            &mut self.render_caches,
            &mut self.world_atlas_quads,
            &mut self.draw_cmds,
        );
        self.world_render_stats = output.stats;
        self.world_draw_cmd_count = self.draw_cmds.len();
        self.draw_cmds.len() as u32
    }

    fn append_ui_draw_cmds(&mut self) {
        for cmd in self.engine.draw_cmds() {
            if self.draw_cmds.len() >= self.draw_cmds.capacity() {
                self.world_render_stats.dropped_draw_cmds =
                    self.world_render_stats.dropped_draw_cmds.saturating_add(1);
                continue;
            }
            self.draw_cmds.push(*cmd);
        }
    }

    fn combined_draw_hash(&self) -> String {
        draw_state_hash_with_world(
            &self.draw_cmds,
            self.engine.rects(),
            self.engine.glyphs(),
            &self.world_atlas_quads,
            &self.world_solid_quads,
        )
    }

    /// Compute-on-call hash (`"fnv1a64:<hex>"`) over only the world `DrawCmd`
    /// prefix plus the world arenas. Stage 4 uses it for renderer-cutover
    /// parity checks; it is never paid on the RAF path.
    fn world_draw_hash(&self) -> String {
        let world_cmds = &self.draw_cmds[..self.world_draw_cmd_count.min(self.draw_cmds.len())];
        format_state_hash(draw_hash_with_world(
            world_cmds,
            &[],
            &[],
            &self.world_atlas_quads,
            &self.world_solid_quads,
        ))
    }

    fn ingest_world_input_from_arena(&mut self) -> Option<(od_core::InputSampled, bool)> {
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
            return Some((sampled, world_context));
        }
        self.input.clear_queue();
        None
    }

    fn advance_frame_sim_ticks(&mut self, dt_ms: f32, framebuffer: (u32, u32)) {
        let pending = self.sim_accumulator_ms + dt_ms.max(0.0);
        // Bounded lag: a tab restore or one long frame must not create an
        // unbounded catch-up spiral. Discarded lag is observable.
        self.sim_accumulator_ms = pending.min(MAX_ACCUMULATED_SIM_MS);
        let dropped = pending - self.sim_accumulator_ms;
        if dropped > 0.0 {
            self.dropped_sim_time_ms += f64::from(dropped);
        }
        let mut ticks = 0_u32;
        while self.sim_accumulator_ms >= SIM_TICK_MS && ticks < MAX_SIM_TICKS_PER_FRAME {
            self.run_fixed_tick(framebuffer);
            self.sim_accumulator_ms -= SIM_TICK_MS;
            ticks = ticks.saturating_add(1);
        }
    }

    /// One fixed 50 ms simulation tick.
    ///
    /// 1. Apply queued gameplay intents (view input emits no `WorldCommand`).
    /// 2. Advance `WorldSim` exactly one tick.
    /// 3-4. Project the `ClientView` from the final tick state.
    /// 5. Recompute the entity perspective at tick exit when dirty.
    fn run_fixed_tick(&mut self, framebuffer: (u32, u32)) {
        self.process_player_movement();
        self.world.step_ticks(1);
        self.counters.record_sim_tick();
        self.project_client_view(framebuffer);
    }

    /// Fixed-tick projection: observes the final state of the tick and syncs
    /// the local projection window. Camera/zoom/view-z/viewport/view-mode
    /// input alters only this window, never authoritative residency.
    fn project_client_view(&mut self, framebuffer: (u32, u32)) {
        let window = compute_projection_window(
            &self.view,
            self.world.world_chunks(),
            self.primary_entity_position(),
            framebuffer,
        );
        self.project_client_view_window(&window.resident);
    }

    /// Lifecycle (boot/reset/import) projection rebuild: project every
    /// simulation-resident chunk so the first rendered frame after a
    /// lifecycle operation is complete for any camera/viewport. The next
    /// fixed tick trims the ClientView back to the local projection window.
    fn project_lifecycle_client_view(&mut self) {
        let dims = self.world.world_chunks();
        let count = usize::try_from(dims.x)
            .unwrap_or(0)
            .saturating_mul(usize::try_from(dims.y).unwrap_or(0))
            .saturating_mul(usize::try_from(dims.z).unwrap_or(0));
        let desired: BTreeSet<Vec3i> = (0..count)
            .filter_map(|index| chunk_index_to_coord(index, dims))
            .collect();
        self.project_client_view_window(&desired);
    }

    /// Sync projected chunks/entities for `desired`, update the local view's
    /// projected-chunk debug list, then perform the tick-exit perspective
    /// maintenance (Stage 5): recompute the FOV bitmaps when the entity's
    /// discrete origin, view mode, or projected terrain changed; master mode
    /// clears visible state while preserving memory.
    ///
    /// Idle frames never reach this path, so they never recompute FOV.
    fn project_client_view_window(&mut self, desired: &BTreeSet<Vec3i>) {
        let primary_position = self.primary_entity_position();
        self.client_view.tick = self.world.tick_count();
        self.client_view.world_chunks = self.world.world_chunks();
        let stats = sync_view_chunks(&mut self.client_view, self.world.state(), desired);
        project_entities(
            &mut self.client_view,
            self.world.state(),
            self.world.primary_entity_id(),
        );
        let mut projected: Vec<Vec3i> = self.client_view.chunks.keys().copied().collect();
        projected.sort_unstable();
        self.view.projected_chunks = projected;
        // Perspective scheduling: dirty when the entity's discrete FOV
        // origin, view mode, or projected terrain changed. Interpolation-only
        // movement progress changes none of these.
        let mode = self.view.view_mode;
        let terrain_changed = stats.inserted > 0 || stats.recopied > 0 || stats.removed > 0;
        if primary_position != self.perspective_entity_position
            || self.perspective_view_mode != Some(mode)
            || terrain_changed
        {
            self.entity_perspective.fov_dirty = true;
        }
        self.perspective_entity_position = primary_position;
        self.perspective_view_mode = Some(mode);
        self.last_projection_stats = stats;
        self.update_entity_perspective();
    }

    /// Tick-exit / lifecycle perspective maintenance. Entity mode recomputes
    /// the FOV bitmaps when dirty (counted); master mode clears visible
    /// state while preserving memory (not counted as a recompute).
    fn update_entity_perspective(&mut self) {
        match self.view.view_mode {
            WorldViewMode::Entity => {
                if self.entity_perspective.fov_dirty {
                    recompute_entity_perspective(&mut self.entity_perspective, &self.client_view);
                }
            }
            WorldViewMode::Master => {
                self.entity_perspective.clear_visible_preserve_memory();
            }
        }
    }

    /// Reset all shadow projection/scheduler observability state.
    fn reset_projection_state(&mut self) {
        self.client_view = ClientView::default();
        self.entity_perspective.reset();
        self.last_projection_stats = ProjectionSyncStats::default();
        self.perspective_entity_position = None;
        self.perspective_view_mode = None;
        self.dropped_sim_time_ms = 0.0;
        self.last_render_alpha = 0.0;
        self.world_draw_cmd_count = 0;
    }

    fn process_player_movement(&mut self) {
        let Some(entity_id) = self.world.primary_entity_id() else {
            self.world_input.clear_just_pressed();
            return;
        };
        let active_entity = self.world.entity_snapshot(entity_id);
        let is_moving = active_entity
            .as_ref()
            .is_some_and(|entity| entity.movement.is_some());
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
                .as_ref()
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

    fn primary_entity_position(&self) -> Option<Vec3i> {
        let primary_entity_id = self.world.primary_entity_id()?;
        self.world.entity_position(primary_entity_id)
    }

    fn reset_world(&mut self, config: WorldConfig) {
        self.world = WorldSim::new(config, true);
        self.world_input.clear();
        self.view = LocalWorldView::default();
        self.view_globals = ViewGlobals::default();
        self.render_caches.reset();
        self.world_render_stats = RenderStats::default();
        self.world_atlas_quads.clear();
        self.world_solid_quads.clear();
        self.draw_cmds.clear();
        self.smooth_player_world_pos = None;
        self.sim_accumulator_ms = 0.0;
        self.reset_projection_state();
        self.last_sampled_dpr = 1.0;
        self.engine.reset_session_shell();
        self.sync_local_view(0.0, self.last_framebuffer_size());
        // Lifecycle rebuild of the projection (prev_xy == curr_xy).
        self.project_lifecycle_client_view();
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
        let (min, max) = self.world.world_bounds();
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

    /// Per-frame local view maintenance: camera smoothing/follow, HUD
    /// counters, the visible-chunk window, and view globals. Never sends a
    /// `WorldCommand`; reads only narrow entity accessors.
    fn sync_local_view(&mut self, dt_ms: f32, framebuffer: (u32, u32)) {
        self.counters.record_frame(dt_ms);
        let Some(primary_entity_id) = self.world.primary_entity_id() else {
            self.write_view_globals(framebuffer.0, framebuffer.1);
            return;
        };
        let Some(entity) = self.world.entity_snapshot(primary_entity_id) else {
            self.write_view_globals(framebuffer.0, framebuffer.1);
            return;
        };

        let entity_pos = entity_render_position_xy(&entity);
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

        // The visible window follows the camera at frame rate; the projected
        // window is sampled by fixed ticks, so render fails closed on chunks
        // entering the visible window for at most one tick.
        self.view.visible_chunks =
            visible_chunk_layer(&self.view, self.world.world_chunks(), framebuffer)
                .iter()
                .copied()
                .collect();
        self.view.fps = self.counters.fps();
        self.view.tps = self.counters.tps();
        self.write_view_globals(framebuffer.0, framebuffer.1);
    }

    fn write_view_globals(&mut self, framebuffer_w: u32, framebuffer_h: u32) {
        self.view_globals = ViewGlobals {
            camera: [
                self.view.camera.x,
                self.view.camera.y,
                self.view.camera.zoom,
                0.0,
            ],
            canvas: [
                framebuffer_w as f32,
                framebuffer_h as f32,
                self.last_sampled_dpr,
                0.0,
            ],
            sim: [
                self.world.tick_count() as f32,
                self.view.view_z as f32,
                self.view.view_mode.as_abi_f32(),
                0.0,
            ],
        };
    }

    /// Chat view-mode effects apply for the following frame/tick. A mode
    /// change performs the same perspective maintenance as a tick exit so
    /// the next render observes the new mode's visibility immediately
    /// (legacy parity: the set-based renderer recomputed/cleared lazily on
    /// its next frame).
    fn apply_submitted_chat(&mut self, submitted: Vec<String>) {
        for text in submitted {
            match text.trim().to_ascii_lowercase().as_str() {
                "/master" => {
                    if self.view.view_mode != WorldViewMode::Master {
                        self.view.view_mode = WorldViewMode::Master;
                        self.perspective_view_mode = Some(WorldViewMode::Master);
                        self.update_entity_perspective();
                    }
                }
                "/entity" => {
                    if self.view.view_mode != WorldViewMode::Entity {
                        self.view.view_mode = WorldViewMode::Entity;
                        self.perspective_view_mode = Some(WorldViewMode::Entity);
                        self.entity_perspective.fov_dirty = true;
                        self.update_entity_perspective();
                    }
                }
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
                "chunks: {} visible / {} projected",
                self.view.visible_chunks.len(),
                self.view.projected_chunks.len()
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
            if let Some(frame) = object.get_mut("frame").and_then(Value::as_object_mut) {
                frame.insert("drawCount".to_owned(), json!(self.draw_cmds.len() as u32));
                frame.insert(
                    "droppedDrawCmds".to_owned(),
                    json!(
                        self.engine
                            .dropped_draw_cmds()
                            .saturating_add(self.world_render_stats.dropped_draw_cmds)
                    ),
                );
                frame.insert("drawHash".to_owned(), json!(self.combined_draw_hash()));
            }
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
            object.insert(
                "worldRender".to_owned(),
                json!({
                    "atlasQuadCount": self.world_atlas_quads.len(),
                    "solidQuadCount": self.world_solid_quads.len(),
                    "floorQuadCount": self.world_render_stats.floor_quads,
                    "playerQuadCount": self.world_render_stats.player_quads,
                    "droppedAtlasQuads": self.world_render_stats.dropped_atlas_quads,
                    "droppedSolidQuads": 0,
                    "droppedDrawCmds": self.world_render_stats.dropped_draw_cmds,
                    "visibleTileCount": self.world_render_stats.visible_tiles,
                    "rememberedTileCount": self.world_render_stats.remembered_tiles,
                    "fovDirty": self.entity_perspective.fov_dirty,
                    "fovRecomputeCount": self.entity_perspective.fov_recompute_count,
                    "snapshotCallsLastFrame": self.world_render_stats.snapshot_calls_last_frame,
                    "droppedSimTimeMs": self.dropped_sim_time_ms,
                    "worldDrawHash": self.world_draw_hash(),
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
        (-1, -1) => Some(Dir::NW),
        (1, -1) => Some(Dir::NE),
        (1, 1) => Some(Dir::SE),
        (-1, 1) => Some(Dir::SW),
        (-1, 0) => Some(Dir::W),
        (1, 0) => Some(Dir::E),
        (0, -1) => Some(Dir::N),
        (0, 1) => Some(Dir::S),
        _ => None,
    }
}

fn play_world_config() -> WorldConfig {
    WorldConfig {
        world_chunks: Vec3u::new(9, 9, 1),
        ..WorldConfig::default()
    }
}

fn sanitize_dpr(dpr: f32) -> f32 {
    if dpr.is_finite() && dpr > 0.0 {
        dpr
    } else {
        1.0
    }
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
    fn direction_from_esdf_chord_keeps_diagonal() {
        let mut held = HeldSet::default();
        held.insert(KeyCode::KeyE);
        held.insert(KeyCode::KeyF);

        assert_eq!(direction_from_keys(&held), Some(Dir::NE));
        assert_eq!(Dir::NE.to_vec3i(), Vec3i::new(1, -1, 0));
    }

    #[test]
    fn sampled_dpr_is_written_to_view_globals() {
        let mut engine = UiEngine::new();
        engine.input.sampled.framebuffer_w = 640;
        engine.input.sampled.framebuffer_h = 480;
        engine.input.sampled.dpr = 2.5;
        engine.input.sampled.dt_ms = 0.0;
        engine.input.sampled.window_focused = 1;

        let _ = engine.frame();

        assert_eq!(engine.view_globals.canvas[2], 2.5);
    }

    #[test]
    fn idle_frame_performs_zero_snapshot_calls() {
        let mut engine = UiEngine::new();
        engine.frame();
        let debug: Value = serde_json::from_str(&engine.debug_snapshot_json()).expect("debug JSON");
        assert_eq!(
            debug["worldRender"]["snapshotCallsLastFrame"].as_u64(),
            Some(0)
        );
    }

    #[test]
    fn tick_frame_performs_zero_snapshot_calls() {
        let mut engine = UiEngine::new();
        engine.input.sampled.dt_ms = SIM_TICK_MS;
        engine.input.sampled.window_focused = 1;
        let _ = engine.frame();
        let debug: Value = serde_json::from_str(&engine.debug_snapshot_json()).expect("debug JSON");
        assert_eq!(
            debug["worldRender"]["snapshotCallsLastFrame"].as_u64(),
            Some(0)
        );
    }

    #[test]
    fn import_replay_returns_hash_and_keeps_all_chunks_resident() {
        let config = play_world_config();
        let sim = WorldSim::new(config.clone(), true);
        let final_snapshot = sim.snapshot();
        let final_state_hash = world_state_hash(&final_snapshot);
        let mut json_snapshot = final_snapshot.clone();
        json_snapshot.terrain_blocks.clear();
        let replay = WorldReplay {
            metadata: od_core::replay::WorldReplayMetadata {
                format_version: od_core::WORLD_REPLAY_FORMAT_VERSION,
                name: "import_play_initial".to_owned(),
                world_config: config,
                spawn_default_player: true,
            },
            events: Vec::new(),
            final_snapshot: json_snapshot,
            final_state_hash: final_state_hash.clone(),
        };
        let bytes = serde_json::to_vec(&replay).expect("replay json");
        let mut engine = UiEngine::new();

        let snapshot: Value =
            serde_json::from_str(&engine.import_replay_json(&bytes).expect("import"))
                .expect("snapshot json");
        let world = snapshot.get("world").expect("world");

        assert_eq!(
            world.get("world_state_hash").and_then(Value::as_str),
            Some(final_state_hash.as_str())
        );
        assert_eq!(
            world.get("loadedChunkCount").and_then(Value::as_u64),
            Some(81)
        );
    }

    #[test]
    fn import_replay_rejects_unsupported_chunk_edge_with_error() {
        let config = WorldConfig::default();
        let sim = WorldSim::new(config.clone(), true);
        let final_snapshot = sim.snapshot();
        let final_state_hash = world_state_hash(&final_snapshot);
        let mut json_snapshot = final_snapshot;
        json_snapshot.terrain_blocks.clear();
        let replay = WorldReplay {
            metadata: od_core::replay::WorldReplayMetadata {
                format_version: od_core::WORLD_REPLAY_FORMAT_VERSION,
                name: "bad_chunk_edge".to_owned(),
                world_config: WorldConfig {
                    chunk_edge: 8,
                    ..config
                },
                spawn_default_player: true,
            },
            events: Vec::new(),
            final_snapshot: json_snapshot,
            final_state_hash,
        };
        let bytes = serde_json::to_vec(&replay).expect("replay json");
        let mut engine = UiEngine::new();
        let before = engine.debug_world_snapshot_json();

        let err = engine
            .import_replay_json(&bytes)
            .expect_err("chunk_edge 8 must be rejected, not panic");

        assert!(
            err.contains("unsupported WorldReplay world config"),
            "typed config mapping missing from: {err}"
        );
        assert!(
            err.contains("chunk_edge 8"),
            "error must name the edge: {err}"
        );
        // Failed import must not replace the running world.
        assert_eq!(engine.debug_world_snapshot_json(), before);
    }

    #[test]
    fn chat_capture_does_not_freeze_sim_ticks() {
        let mut engine = UiEngine::new();
        engine.input.sampled.framebuffer_w = 640;
        engine.input.sampled.framebuffer_h = 480;
        engine.input.sampled.dpr = 1.0;
        engine.input.sampled.window_focused = 1;
        engine.input.queue.count = 1;
        engine.input.events[0].kind = EventKind::KeyDown.as_u8();
        engine.input.events[0].code = KeyCode::KeyT.as_u16();
        let _ = engine.frame();
        assert!(engine.engine.session_capture_active());
        let before = engine.world.snapshot().tick;

        engine.input.sampled.dt_ms = SIM_TICK_MS;
        let _ = engine.frame();

        assert!(engine.engine.session_capture_active());
        assert!(engine.world.snapshot().tick > before);
    }

    /// Stage 4: cameras never send residency commands. Two identical play
    /// worlds advance identical tick counts while only one side pans, zooms,
    /// resizes, and switches view mode; authoritative state stays equal
    /// while only the local projection differs.
    #[test]
    fn paired_engines_view_input_never_changes_authoritative_state() {
        let mut control = focused_engine((640, 480));
        control.reset_play_world();
        let mut viewer = focused_engine((640, 480));
        viewer.reset_play_world();

        // Frame 1 (one fixed tick each): identical.
        for engine in [&mut control, &mut viewer] {
            engine.input.sampled.dt_ms = SIM_TICK_MS;
            let _ = engine.frame();
        }

        // Viewer-only view input: master mode, camera pan, zoom, viewport
        // resize, view-z, then back to entity mode. Two more tick frames on
        // both engines interleave with the view churn.
        viewer.view.view_mode = WorldViewMode::Master;
        viewer.view.camera.x = 4096.0;
        viewer.view.camera.y = 4096.0;
        viewer.view.step_zoom(-1);
        viewer.input.sampled.framebuffer_w = 1920;
        viewer.input.sampled.framebuffer_h = 1080;
        for engine in [&mut control, &mut viewer] {
            engine.input.sampled.dt_ms = SIM_TICK_MS;
            let _ = engine.frame();
        }
        viewer.view.view_z = viewer.view.view_z.saturating_sub(1);
        viewer.view.view_mode = WorldViewMode::Entity;
        for engine in [&mut control, &mut viewer] {
            engine.input.sampled.dt_ms = SIM_TICK_MS;
            let _ = engine.frame();
        }

        assert_eq!(control.world.tick_count(), viewer.world.tick_count());
        assert_eq!(control.world.tick_count(), 3);
        let control_snapshot = control.world.snapshot();
        let viewer_snapshot = viewer.world.snapshot();
        assert_eq!(
            world_state_hash(&control_snapshot),
            world_state_hash(&viewer_snapshot),
            "view input must not change the world hash"
        );
        assert_eq!(
            control_snapshot.loaded_chunks, viewer_snapshot.loaded_chunks,
            "view input must not change authoritative residency"
        );
        assert_eq!(
            control_snapshot.loaded_chunks.len(),
            81,
            "play world keeps every generated chunk simulation-resident"
        );
        // Only the local projection differs.
        assert_ne!(
            control.view.projected_chunks, viewer.view.projected_chunks,
            "projected chunk membership follows the local view"
        );
    }

    /// Stage 4 one-tick-stale bound: a camera pan changes projected chunk
    /// membership only at the next fixed tick; until then the renderer
    /// fails closed on chunks entering the visible window.
    #[test]
    fn pan_fails_closed_until_next_fixed_tick_then_projects() {
        let mut engine = focused_engine((640, 480));
        engine.reset_play_world();
        engine.input.sampled.dt_ms = SIM_TICK_MS;
        let _ = engine.frame(); // first tick trims the lifecycle projection
        let target = Vec3i::new(4, 4, 0);
        assert!(!engine.client_view.chunks.contains_key(&target));
        let residency_before = engine.world.snapshot().loaded_chunks;

        // Master-mode pan onto the far corner chunk; no fixed tick.
        engine.view.view_mode = WorldViewMode::Master;
        engine.view.camera.x = 4416.0; // tile 69 => centered chunk 4
        engine.view.camera.y = 4416.0;
        engine.input.sampled.dt_ms = 1.0;
        let _ = engine.frame();
        assert!(
            engine.view.visible_chunks.contains(&target),
            "the pan makes the target chunk visible this frame"
        );
        assert!(
            !engine.client_view.chunks.contains_key(&target),
            "projection is sampled at fixed ticks only"
        );
        let base = od_core::chunk_min_world_position(target, engine.world.world_chunks())
            .expect("target base");
        let in_target_rect = |quad: &WorldAtlasQuadInstance| {
            quad.pos[0] >= base.x as f32 * TILE_SIZE_PX
                && quad.pos[0] < (base.x + 16) as f32 * TILE_SIZE_PX
                && quad.pos[1] >= base.y as f32 * TILE_SIZE_PX
                && quad.pos[1] < (base.y + 16) as f32 * TILE_SIZE_PX
        };
        let floor_quads = engine.world_render_stats.floor_quads as usize;
        assert!(
            !engine.world_atlas_quads[..floor_quads]
                .iter()
                .any(in_target_rect),
            "renderer fails closed: no floor emitted from the stale chunk"
        );

        // The next fixed tick projects the entering chunk and emits it.
        engine.input.sampled.dt_ms = SIM_TICK_MS;
        let _ = engine.frame();
        assert!(engine.client_view.chunks.contains_key(&target));
        let floor_quads = engine.world_render_stats.floor_quads as usize;
        assert!(
            engine.world_atlas_quads[..floor_quads]
                .iter()
                .any(in_target_rect),
            "entering chunk emits after the next fixed tick"
        );
        // Authoritative residency never changed across the pan.
        assert_eq!(engine.world.snapshot().loaded_chunks, residency_before);
    }

    /// Stage 4: the world hash of a play world is independent of viewport
    /// dimensions (browser asserts the same constant for its own viewport).
    #[test]
    fn play_world_hash_is_viewport_independent() {
        let mut hashes = Vec::new();
        for framebuffer in [(640, 480), (1920, 1080)] {
            let mut engine = focused_engine(framebuffer);
            engine.reset_play_world();
            engine.input.sampled.dt_ms = 16.0;
            for _ in 0..105 {
                let _ = engine.frame();
            }
            assert_eq!(engine.world.tick_count(), 33);
            hashes.push(world_state_hash(&engine.world.snapshot()));
        }
        assert_eq!(hashes[0], hashes[1], "viewport must not affect the hash");
        // Pinned all-resident play-world hash at tick 33; the browser perf
        // fixture asserts the same value.
        assert_eq!(hashes[0], "fnv1a64:718bb0099657e9aa");
    }

    fn focused_engine(framebuffer: (u32, u32)) -> UiEngine {
        let mut engine = UiEngine::new();
        engine.input.sampled.framebuffer_w = framebuffer.0;
        engine.input.sampled.framebuffer_h = framebuffer.1;
        engine.input.sampled.dpr = 1.0;
        engine.input.sampled.window_focused = 1;
        engine
    }

    #[test]
    fn ten_second_delta_runs_at_most_three_ticks_bounds_alpha_and_drops_lag() {
        let mut engine = focused_engine((640, 480));
        engine.input.sampled.dt_ms = 10_000.0;

        let _ = engine.frame();

        assert_eq!(engine.world.tick_count(), 3, "at most three catch-up ticks");
        assert!(
            (0.0..=1.0).contains(&engine.last_render_alpha),
            "alpha {} out of range",
            engine.last_render_alpha
        );
        assert_eq!(engine.sim_accumulator_ms, 0.0, "lag budget fully consumed");
        let expected_dropped = f64::from(10_000.0_f32 - MAX_ACCUMULATED_SIM_MS);
        assert!(
            (engine.dropped_sim_time_ms - expected_dropped).abs() < 1e-6,
            "droppedSimTimeMs {} != {expected_dropped}",
            engine.dropped_sim_time_ms
        );
        let debug: Value = serde_json::from_str(&engine.debug_snapshot_json()).expect("debug JSON");
        assert_eq!(
            debug["worldRender"]["droppedSimTimeMs"].as_f64(),
            Some(expected_dropped),
            "droppedSimTimeMs must be exposed via worldRender"
        );

        // A second long frame keeps incrementing the counter.
        engine.input.sampled.dt_ms = 10_000.0;
        let _ = engine.frame();
        assert_eq!(engine.world.tick_count(), 6);
        assert!(engine.dropped_sim_time_ms > expected_dropped);
    }

    #[test]
    fn synthetic_16ms_frames_advance_at_deterministic_20_tps() {
        let mut engine = focused_engine((640, 480));
        engine.input.sampled.dt_ms = 16.0;

        for frame_index in 1..=50_u64 {
            let _ = engine.frame();
            assert_eq!(
                engine.world.tick_count(),
                frame_index * 16 / 50,
                "tick after frame {frame_index}"
            );
            assert!((0.0..=1.0).contains(&engine.last_render_alpha));
        }
        assert_eq!(
            engine.world.tick_count(),
            16,
            "50 frames * 16 ms = 16 ticks"
        );
        assert_eq!(engine.dropped_sim_time_ms, 0.0, "16 ms frames drop nothing");
    }

    #[test]
    fn step_sim_ticks_advances_exactly_n_ticks_then_renders_once() {
        let mut engine = UiEngine::new();

        engine.step_sim_ticks(5);

        assert_eq!(engine.world.tick_count(), 5);
        assert_eq!(engine.client_view.tick, 5, "projection observed every tick");
        // Exactly one render afterward, with zero snapshot calls.
        assert_eq!(engine.world_render_stats.snapshot_calls_last_frame, 0);
        assert!(engine.world_draw_cmd_count > 0, "one render happened");
        assert_eq!(engine.last_render_alpha, 0.0);

        engine.step_sim_ticks(0);
        assert_eq!(engine.world.tick_count(), 5, "zero ticks advance nothing");
    }

    #[test]
    fn shadow_client_view_matches_authoritative_chunks_after_tick_frame() {
        let mut engine = focused_engine((640, 480));
        engine.input.sampled.dt_ms = SIM_TICK_MS;
        let _ = engine.frame();

        assert_eq!(engine.client_view.tick, engine.world.tick_count());
        assert!(!engine.client_view.chunks.is_empty());
        let mut expected = Box::new([od_core::BlockType::Air; od_core::CHUNK_VOLUME]);
        for (chunk, view) in &engine.client_view.chunks {
            assert!(
                engine.world.copy_chunk_blocks(*chunk, &mut expected),
                "{chunk:?}"
            );
            assert_eq!(view.blocks[..], expected[..], "byte parity for {chunk:?}");
            assert_eq!(
                Some(view.terrain_revision),
                engine.world.chunk_terrain_revision(*chunk),
                "revision parity for {chunk:?}"
            );
        }
        // Entities were projected with primary id and prev == curr while idle.
        assert_eq!(
            engine.client_view.primary_entity_id,
            engine.world.primary_entity_id()
        );
        assert!(!engine.client_view.entities.is_empty());
    }

    #[test]
    fn projected_chunk_entering_window_is_absent_until_next_fixed_tick() {
        let mut engine = focused_engine((640, 480));
        engine.input.sampled.dt_ms = SIM_TICK_MS;
        let _ = engine.frame();
        let target = Vec3i::new(4, 4, 0);
        assert!(
            !engine.client_view.chunks.contains_key(&target),
            "far corner chunk must not be projected around spawn"
        );

        // Master-mode camera pan onto the far corner chunk. View input emits
        // no projection change until the next fixed tick samples it.
        engine.view.view_mode = WorldViewMode::Master;
        engine.view.camera.x = 4096.0; // tile 64 => chunk 4
        engine.view.camera.y = 4096.0;
        engine.input.sampled.dt_ms = 1.0; // no fixed tick this frame
        let _ = engine.frame();
        assert!(
            !engine.client_view.chunks.contains_key(&target),
            "entering chunk stays absent until a fixed tick projects it"
        );

        engine.input.sampled.dt_ms = SIM_TICK_MS; // exactly one fixed tick
        let _ = engine.frame();
        assert!(
            engine.client_view.chunks.contains_key(&target),
            "entering chunk is projected by the next fixed tick"
        );
        assert!(engine.last_projection_stats.inserted > 0);
    }

    #[test]
    fn reset_rebuilds_projection_with_prev_equal_curr() {
        let mut engine = focused_engine((640, 480));
        engine.input.sampled.dt_ms = SIM_TICK_MS;
        for _ in 0..3 {
            let _ = engine.frame();
        }
        assert!(engine.client_view.tick > 0);
        engine.dropped_sim_time_ms = 42.0;

        engine.reset_play_world();

        assert_eq!(engine.client_view.tick, 0);
        assert_eq!(engine.sim_accumulator_ms, 0.0);
        assert_eq!(engine.dropped_sim_time_ms, 0.0);
        // Lifecycle rebuild recomputes the perspective exactly once.
        assert!(!engine.entity_perspective.fov_dirty);
        assert_eq!(engine.entity_perspective.fov_recompute_count, 1);
        assert!(!engine.entity_perspective.visible.is_empty());
        assert!(engine.entity_perspective.memory.is_empty());
        assert!(
            !engine.client_view.chunks.is_empty(),
            "lifecycle rebuild projects the fresh window"
        );
        assert!(!engine.client_view.entities.is_empty());
        assert!(
            engine
                .client_view
                .entities
                .iter()
                .all(|entity| entity.prev_xy == entity.curr_xy),
            "reset reinitializes interpolation history"
        );
    }

    #[test]
    fn import_replay_rebuilds_projection_state() {
        let config = play_world_config();
        let sim = WorldSim::new(config.clone(), true);
        let final_snapshot = sim.snapshot();
        let final_state_hash = world_state_hash(&final_snapshot);
        let mut json_snapshot = final_snapshot.clone();
        json_snapshot.terrain_blocks.clear();
        let replay = WorldReplay {
            metadata: od_core::replay::WorldReplayMetadata {
                format_version: od_core::WORLD_REPLAY_FORMAT_VERSION,
                name: "projection_rebuild".to_owned(),
                world_config: config,
                spawn_default_player: true,
            },
            events: Vec::new(),
            final_snapshot: json_snapshot,
            final_state_hash,
        };
        let bytes = serde_json::to_vec(&replay).expect("replay json");

        let mut engine = focused_engine((640, 480));
        engine.input.sampled.dt_ms = SIM_TICK_MS;
        let _ = engine.frame();
        engine.dropped_sim_time_ms = 7.0;
        assert!(engine.client_view.tick > 0);

        engine.import_replay_json(&bytes).expect("import");

        assert_eq!(engine.client_view.tick, 0);
        assert_eq!(engine.sim_accumulator_ms, 0.0);
        assert_eq!(engine.dropped_sim_time_ms, 0.0);
        // Import rebuilds the perspective from scratch: one recompute, no
        // stale memory from the previous world.
        assert!(!engine.entity_perspective.fov_dirty);
        assert_eq!(engine.entity_perspective.fov_recompute_count, 1);
        assert!(engine.entity_perspective.memory.is_empty());
        assert!(
            engine
                .client_view
                .entities
                .iter()
                .all(|entity| entity.prev_xy == entity.curr_xy),
            "import reinitializes interpolation history"
        );
    }

    /// Stage 5: idle frames (no fixed tick) never recompute FOV.
    #[test]
    fn idle_frames_never_recompute_fov() {
        let mut engine = focused_engine((640, 480));
        // Boot lifecycle performed exactly one recompute.
        assert_eq!(engine.entity_perspective.fov_recompute_count, 1);
        assert!(!engine.entity_perspective.fov_dirty);

        for _ in 0..10 {
            engine.input.sampled.dt_ms = 1.0; // never reaches a fixed tick
            let _ = engine.frame();
        }

        assert_eq!(engine.world.tick_count(), 0, "no fixed tick ran");
        assert_eq!(
            engine.entity_perspective.fov_recompute_count, 1,
            "idle frames must not recompute FOV"
        );
        let debug: Value = serde_json::from_str(&engine.debug_snapshot_json()).expect("debug JSON");
        assert_eq!(debug["worldRender"]["fovRecomputeCount"].as_u64(), Some(1));
        assert_eq!(debug["worldRender"]["fovDirty"].as_bool(), Some(false));
    }

    /// Stage 5: exactly one recompute per fixed tick that changes the
    /// entity's discrete FOV origin; interpolation-only progress causes none.
    #[test]
    fn origin_changing_tick_recomputes_exactly_once() {
        let mut engine = focused_engine((640, 480));
        // Default 1x1x1 world: the projection window is always the single
        // chunk, so only discrete origin changes can schedule recomputes
        // (the play world would also recompute while the follow camera's
        // projection window settles, exactly like the legacy scheduler).
        engine.reset_for_harness();
        let base = engine.entity_perspective.fov_recompute_count;
        assert_eq!(base, 1, "lifecycle rebuild recomputed once");

        // Ticks without origin/terrain/mode changes never recompute.
        for _ in 0..3 {
            engine.input.sampled.dt_ms = SIM_TICK_MS;
            let _ = engine.frame();
        }
        assert_eq!(engine.world.tick_count(), 3);
        assert_eq!(engine.entity_perspective.fov_recompute_count, base);

        // Start a one-tile move (movement_ticks_per_tile == 10) and step one
        // fixed tick per frame: interpolation ticks recompute nothing; the
        // single tick that changes the discrete origin recomputes once.
        let start = engine.primary_entity_position().expect("player");
        engine
            .world
            .send_command(WorldCommand::MoveEntity {
                id: 1,
                direction: Vec3i::new(-1, 0, 0),
            })
            .expect("starter room west move");
        let mut origin_change_ticks = 0_u32;
        let mut count = engine.entity_perspective.fov_recompute_count;
        let mut position = start;
        for _ in 0..12 {
            engine.input.sampled.dt_ms = SIM_TICK_MS;
            let _ = engine.frame();
            let next_position = engine.primary_entity_position().expect("player");
            let next_count = engine.entity_perspective.fov_recompute_count;
            if next_position == position {
                assert_eq!(
                    next_count, count,
                    "interpolation-only tick must not recompute"
                );
            } else {
                origin_change_ticks += 1;
                assert_eq!(
                    next_count,
                    count + 1,
                    "an origin-changing tick recomputes exactly once"
                );
            }
            position = next_position;
            count = next_count;
        }
        assert_eq!(origin_change_ticks, 1, "the move landed exactly once");
        assert_ne!(position, start);
        assert_eq!(count, base + 1);
    }

    /// Stage 5: master-mode ticks clear visible state but preserve memory;
    /// returning to entity mode recomputes and restores visibility.
    #[test]
    fn master_tick_clears_visible_preserves_memory_and_entity_restores() {
        let mut engine = focused_engine((640, 480));
        // Build memory: complete a one-tile move.
        engine
            .world
            .send_command(WorldCommand::MoveEntity {
                id: 1,
                direction: Vec3i::new(-1, 0, 0),
            })
            .expect("starter room west move");
        for _ in 0..12 {
            engine.input.sampled.dt_ms = SIM_TICK_MS;
            let _ = engine.frame();
        }
        let visible = engine.entity_perspective.visible_tile_count();
        let remembered = engine.entity_perspective.remembered_tile_count();
        assert!(visible > 0);
        assert!(remembered > 0, "the move created perspective memory");
        let count = engine.entity_perspective.fov_recompute_count;

        // Master-mode fixed tick: visible cleared, memory preserved, and
        // the clear is not counted as a recompute.
        engine.view.view_mode = WorldViewMode::Master;
        engine.input.sampled.dt_ms = SIM_TICK_MS;
        let _ = engine.frame();
        assert_eq!(engine.entity_perspective.visible_tile_count(), 0);
        assert_eq!(
            engine.entity_perspective.remembered_tile_count(),
            remembered
        );
        assert_eq!(engine.entity_perspective.fov_recompute_count, count);
        assert!(!engine.entity_perspective.fov_dirty);
        assert_eq!(engine.world_render_stats.visible_tiles, 0);

        // Back to entity mode: the next fixed tick recomputes exactly once
        // and restores the same visibility; memory is unchanged (it is
        // disjoint from the restored visible set).
        engine.view.view_mode = WorldViewMode::Entity;
        engine.input.sampled.dt_ms = SIM_TICK_MS;
        let _ = engine.frame();
        assert_eq!(engine.entity_perspective.fov_recompute_count, count + 1);
        assert_eq!(engine.entity_perspective.visible_tile_count(), visible);
        assert_eq!(
            engine.entity_perspective.remembered_tile_count(),
            remembered
        );
    }

    /// Stage 4 world-layer parity anchors, captured on the Stage 3 renderer.
    ///
    /// Scripted camera/entity states whose world DrawCmd prefix + world
    /// arenas must be byte-identical (same `worldDrawHash`) after the
    /// ClientView renderer cutover. Any difference is a stage stop
    /// condition, not a re-bless.
    #[test]
    fn world_draw_hash_parity_anchors_for_scripted_states() {
        fn world_hash(engine: &UiEngine) -> String {
            let debug: Value =
                serde_json::from_str(&engine.debug_snapshot_json()).expect("debug JSON");
            debug["worldRender"]["worldDrawHash"]
                .as_str()
                .expect("worldDrawHash")
                .to_owned()
        }

        // State 1: default-world boot render (no fixed tick yet).
        let mut engine = focused_engine((640, 480));
        engine.input.sampled.dt_ms = 1.0;
        let _ = engine.frame();
        let s1 = world_hash(&engine);

        // State 2: one fixed tick in the default world (entity mode).
        engine.input.sampled.dt_ms = SIM_TICK_MS;
        let _ = engine.frame();
        let s2 = world_hash(&engine);

        // State 3: default-world entity movement (FOV motion + memory).
        engine
            .world
            .send_command(WorldCommand::MoveEntity {
                id: 1,
                direction: Vec3i::new(-1, 0, 0),
            })
            .expect("starter room west move");
        for _ in 0..12 {
            engine.input.sampled.dt_ms = SIM_TICK_MS;
            let _ = engine.frame();
        }
        let s3 = world_hash(&engine);

        // State 4: play-world master pan followed by one fixed tick.
        let mut engine = focused_engine((1280, 720));
        engine.reset_play_world();
        engine.input.sampled.dt_ms = 16.0;
        let _ = engine.frame();
        engine.view.view_mode = WorldViewMode::Master;
        engine.view.camera.x = 4096.0;
        engine.view.camera.y = 4096.0;
        engine.input.sampled.dt_ms = SIM_TICK_MS;
        let _ = engine.frame();
        let s4 = world_hash(&engine);

        // State 5: the scripted perf scenario (play world, 105 idle 16 ms
        // frames => tick 33), the Stage 3 checkpoint reference.
        let mut engine = focused_engine((1280, 720));
        engine.reset_play_world();
        engine.input.sampled.dt_ms = 16.0;
        for _ in 0..105 {
            let _ = engine.frame();
        }
        assert_eq!(engine.world.tick_count(), 33, "perf scenario tick");
        let s5 = world_hash(&engine);

        println!("parity anchors: s1={s1} s2={s2} s3={s3} s4={s4} s5={s5}");
        // Captured on the Stage 3 legacy renderer (commit f869ed1 worktree).
        assert_eq!(s1, "fnv1a64:c55ac880b00ac4d0");
        assert_eq!(s2, "fnv1a64:c55ac880b00ac4d0");
        assert_eq!(s3, "fnv1a64:ee3f36f2bdc3a71a");
        assert_eq!(s4, "fnv1a64:c6e10e16605cd905");
        // The scripted perf scenario must equal the Stage 3 checkpoint
        // reference recorded in the plan.
        assert_eq!(s5, "fnv1a64:c55ac880b00ac4d0");
    }

    #[test]
    fn world_draw_hash_covers_only_world_prefix_and_is_deterministic() {
        let mut engine = focused_engine((640, 480));
        engine.input.sampled.dt_ms = SIM_TICK_MS;
        let _ = engine.frame();

        assert!(
            engine.world_draw_cmd_count < engine.draw_cmds.len(),
            "frame appends UI DrawCmds after the world prefix"
        );
        let world_hash = engine.world_draw_hash();
        assert!(world_hash.starts_with("fnv1a64:"));
        assert_eq!(world_hash, engine.world_draw_hash(), "on-demand stable");
        assert_ne!(
            world_hash,
            engine.combined_draw_hash(),
            "world prefix hash excludes UI draw output"
        );
        let debug: Value = serde_json::from_str(&engine.debug_snapshot_json()).expect("debug JSON");
        assert_eq!(
            debug["worldRender"]["worldDrawHash"].as_str(),
            Some(world_hash.as_str())
        );

        // A different world view (master-mode pan) changes the world layer
        // and therefore the world draw hash.
        engine.view.view_mode = WorldViewMode::Master;
        engine.view.camera.x = 4096.0;
        engine.view.camera.y = 4096.0;
        engine.input.sampled.dt_ms = SIM_TICK_MS;
        let _ = engine.frame();
        assert_ne!(
            engine.world_draw_hash(),
            world_hash,
            "world-layer changes must change worldDrawHash"
        );
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
