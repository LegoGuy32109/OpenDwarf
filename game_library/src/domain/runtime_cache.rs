use bevy::prelude::*;
use std::collections::{HashMap, VecDeque};
use world_runtime::protocol::ChunkLayerPatch;
use world_runtime::{ChunkKey, InputBatch, LayerId, RuntimeEvent, ViewportIntent, WorldCommand};

#[derive(Resource, Default)]
pub struct RuntimeInputQueue {
    commands: Vec<WorldCommand>,
}

impl RuntimeInputQueue {
    pub fn push(&mut self, command: WorldCommand) {
        self.commands.push(command);
    }

    pub fn move_entity(&mut self, id: u64, direction: world_runtime::Vec3i) {
        self.push(WorldCommand::MoveEntity { id, direction });
    }

    #[must_use]
    pub fn drain(&mut self) -> Vec<WorldCommand> {
        std::mem::take(&mut self.commands)
    }
}

#[derive(Resource, Default)]
pub struct RuntimePatchApplyQueue {
    events: VecDeque<RuntimeEvent>,
    latest_patch_index: HashMap<(ChunkKey, LayerId), usize>,
    dropped_superseded: u64,
    coalesced: u64,
}

impl RuntimePatchApplyQueue {
    pub fn push(&mut self, event: RuntimeEvent) {
        if let Some(patch) = patch_from_event(&event) {
            let key = (patch.chunk, patch.layer);
            if let Some(&existing_index) = self.latest_patch_index.get(&key) {
                let existing = &self.events[existing_index];
                let existing_revision = patch_from_event(existing).map(|p| p.revision).unwrap_or(0);
                if patch.revision >= existing_revision {
                    self.events[existing_index] = RuntimeEvent::RuntimeWarning(String::new());
                    self.dropped_superseded = self.dropped_superseded.saturating_add(1);
                    self.coalesced = self.coalesced.saturating_add(1);
                    let index = self.events.len();
                    self.events.push_back(event);
                    self.latest_patch_index.insert(key, index);
                } else {
                    self.dropped_superseded = self.dropped_superseded.saturating_add(1);
                }
                return;
            }
            let index = self.events.len();
            self.events.push_back(event);
            self.latest_patch_index.insert(key, index);
            return;
        }
        self.events.push_back(event);
    }

    #[must_use]
    pub fn drain_ordered_by_camera(&mut self, camera_center: Option<IVec3>) -> Vec<RuntimeEvent> {
        self.latest_patch_index.clear();
        let events: Vec<RuntimeEvent> = self
            .events
            .drain(..)
            .filter(|event| !is_empty_warning_placeholder(event))
            .collect();
        let Some(camera) = camera_center else {
            return events;
        };
        // Sort patch events by manhattan distance from camera while keeping the
        // relative order of non-patch events. We achieve this by extracting the
        // patch events, sorting them, and re-inserting them back into the slots
        // their predecessors occupied.
        let mut patch_slots: Vec<usize> = Vec::new();
        let mut patches: Vec<(i64, RuntimeEvent)> = Vec::new();
        let mut ordered: Vec<Option<RuntimeEvent>> = events.into_iter().map(Some).collect();
        for (i, slot) in ordered.iter_mut().enumerate() {
            if let Some(event) = slot.as_ref() {
                if let Some(patch) = patch_from_event(event) {
                    let distance = manhattan_chunk_distance(patch.chunk, camera);
                    patches.push((distance, slot.take().expect("slot should be present")));
                    patch_slots.push(i);
                }
            }
        }
        patches.sort_by_key(|(distance, _)| *distance);
        for (slot_index, (_, event)) in patch_slots.into_iter().zip(patches.into_iter()) {
            ordered[slot_index] = Some(event);
        }
        ordered
            .into_iter()
            .filter_map(|slot| slot)
            .collect()
    }

    #[must_use]
    pub fn take_counters(&mut self) -> (u64, u64) {
        let counters = (self.dropped_superseded, self.coalesced);
        self.dropped_superseded = 0;
        self.coalesced = 0;
        counters
    }
}

fn patch_from_event(event: &RuntimeEvent) -> Option<&ChunkLayerPatch> {
    match event {
        RuntimeEvent::InitialSnapshotChunkLayer(patch)
        | RuntimeEvent::ChunkLayerPatch(patch)
        | RuntimeEvent::ResyncChunkLayer(patch) => Some(patch),
        _ => None,
    }
}

fn is_empty_warning_placeholder(event: &RuntimeEvent) -> bool {
    matches!(event, RuntimeEvent::RuntimeWarning(message) if message.is_empty())
}

fn manhattan_chunk_distance(chunk: ChunkKey, camera: IVec3) -> i64 {
    let dx = (chunk.x as i64).saturating_sub(camera.x as i64).abs();
    let dy = (chunk.y as i64).saturating_sub(camera.y as i64).abs();
    let dz = (chunk.z as i64).saturating_sub(camera.z as i64).abs();
    dx.saturating_add(dy).saturating_add(dz)
}

#[derive(Resource, Default, Clone, Copy)]
pub struct RuntimeViewportIntentState {
    pub current: Option<ViewportIntent>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChunkLayerResidency {
    Hot,
    Warm,
    Cold,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ChunkLayerKey {
    pub chunk: ChunkKey,
    pub layer: LayerId,
}

impl ChunkLayerKey {
    #[must_use]
    pub const fn new(chunk: ChunkKey, layer: LayerId) -> Self {
        Self { chunk, layer }
    }
}

#[derive(Debug, Clone)]
pub struct ChunkLayerCacheEntry {
    pub revision: u64,
    pub worker_frame_id: u64,
    pub residency: ChunkLayerResidency,
    pub stale_since_unix_ms: Option<u128>,
    pub last_touched_unix_ms: u128,
    pub full_chunk: bool,
    pub payload: Vec<u8>,
    pub materialized: bool,
    pub dirty: bool,
}

impl ChunkLayerCacheEntry {
    fn new(
        revision: u64,
        worker_frame_id: u64,
        full_chunk: bool,
        payload: Vec<u8>,
        now: u128,
    ) -> Self {
        Self {
            revision,
            worker_frame_id,
            residency: ChunkLayerResidency::Hot,
            stale_since_unix_ms: None,
            last_touched_unix_ms: now,
            full_chunk,
            payload,
            materialized: false,
            dirty: true,
        }
    }
}

#[derive(Resource, Default)]
pub struct ChunkLayerCacheMap {
    pub entries: HashMap<ChunkLayerKey, ChunkLayerCacheEntry>,
}

impl ChunkLayerCacheMap {
    pub fn apply_patch(
        &mut self,
        chunk: ChunkKey,
        layer: LayerId,
        revision: u64,
        worker_frame_id: u64,
        full_chunk: bool,
        payload: Vec<u8>,
        now: u128,
    ) -> bool {
        let key = ChunkLayerKey::new(chunk, layer);
        let should_replace = self
            .entries
            .get(&key)
            .map(|entry| revision >= entry.revision)
            .unwrap_or(true);
        if !should_replace {
            return false;
        }

        let new_entry =
            ChunkLayerCacheEntry::new(revision, worker_frame_id, full_chunk, payload, now);
        let entry = self.entries.entry(key).or_insert_with(|| new_entry.clone());
        *entry = new_entry;
        entry.materialized = true;
        entry.dirty = true;
        true
    }

    pub fn mark_all_stale(&mut self, now: u128, stale_after_ms: u64) {
        for entry in self.entries.values_mut() {
            let elapsed = now.saturating_sub(entry.last_touched_unix_ms);
            entry.materialized = true;
            if elapsed > u128::from(stale_after_ms) {
                if entry.stale_since_unix_ms.is_none() {
                    entry.stale_since_unix_ms = Some(now);
                }
                entry.residency = ChunkLayerResidency::Cold;
                entry.dirty = true;
            } else if elapsed > u128::from(stale_after_ms / 2) {
                entry.residency = ChunkLayerResidency::Warm;
                entry.dirty = false;
            } else {
                entry.residency = ChunkLayerResidency::Hot;
                entry.dirty = false;
            }
        }
    }

    #[must_use]
    pub fn residency_counts(&self) -> (usize, usize, usize) {
        let mut hot = 0usize;
        let mut warm = 0usize;
        let mut cold = 0usize;
        for entry in self.entries.values() {
            match entry.residency {
                ChunkLayerResidency::Hot => hot = hot.saturating_add(1),
                ChunkLayerResidency::Warm => warm = warm.saturating_add(1),
                ChunkLayerResidency::Cold => cold = cold.saturating_add(1),
            }
        }
        (hot, warm, cold)
    }

    #[must_use]
    pub fn entry_shape_counts(&self) -> (u64, usize, usize, usize) {
        let mut latest_worker_frame_id = 0u64;
        let mut full_chunk_entries = 0usize;
        let mut materialized_entries = 0usize;
        let mut dirty_entries = 0usize;

        for entry in self.entries.values() {
            latest_worker_frame_id = latest_worker_frame_id.max(entry.worker_frame_id);
            if entry.full_chunk {
                full_chunk_entries = full_chunk_entries.saturating_add(1);
            }
            if entry.materialized {
                materialized_entries = materialized_entries.saturating_add(1);
            }
            if entry.dirty {
                dirty_entries = dirty_entries.saturating_add(1);
            }
        }

        (
            latest_worker_frame_id,
            full_chunk_entries,
            materialized_entries,
            dirty_entries,
        )
    }

    #[must_use]
    pub fn payload_bytes(&self) -> usize {
        self.entries.values().map(|entry| entry.payload.len()).sum()
    }

    pub fn enforce_budgets(&mut self, max_entries: usize, max_payload_bytes: usize) -> u64 {
        let mut evicted = 0u64;
        loop {
            let entry_count = self.entries.len();
            let payload_bytes = self.payload_bytes();
            if entry_count <= max_entries && payload_bytes <= max_payload_bytes {
                break;
            }
            let Some(victim) = self.pick_eviction_victim() else {
                break;
            };
            self.entries.remove(&victim);
            evicted = evicted.saturating_add(1);
        }
        evicted
    }

    fn pick_eviction_victim(&self) -> Option<ChunkLayerKey> {
        self.entries
            .iter()
            .min_by_key(|(_, entry)| {
                let residency_rank = match entry.residency {
                    ChunkLayerResidency::Cold => 0u8,
                    ChunkLayerResidency::Warm => 1,
                    ChunkLayerResidency::Hot => 2,
                };
                (residency_rank, entry.last_touched_unix_ms)
            })
            .map(|(key, _)| key.clone())
    }
}

#[derive(Resource, Clone)]
pub struct ChunkCacheState {
    pub stale_grace_ms: u64,
    pub estimated_payload_bytes: usize,
    pub hot_chunks: usize,
    pub warm_chunks: usize,
    pub cold_chunks: usize,
    pub snapshot_progress_percent: u8,
    pub active_layers: usize,
    pub last_event_count: usize,
    pub latest_worker_frame_id: u64,
    pub full_chunk_entries: usize,
    pub materialized_entries: usize,
    pub dirty_entries: usize,
    pub overfetch_factor: f32,
    pub pressure_level: u8,
    pub target_radius_tiles: i32,
    pub dropped_superseded_patches: u64,
    pub coalesced_patches: u64,
    pub warm_budget_evictions: u64,
    pub max_warm_chunks: usize,
    pub max_payload_bytes: usize,
}

impl Default for ChunkCacheState {
    fn default() -> Self {
        Self {
            stale_grace_ms: 250,
            estimated_payload_bytes: 0,
            hot_chunks: 0,
            warm_chunks: 0,
            cold_chunks: 0,
            snapshot_progress_percent: 0,
            active_layers: 0,
            last_event_count: 0,
            latest_worker_frame_id: 0,
            full_chunk_entries: 0,
            materialized_entries: 0,
            dirty_entries: 0,
            overfetch_factor: 1.0,
            pressure_level: 0,
            target_radius_tiles: 0,
            dropped_superseded_patches: 0,
            coalesced_patches: 0,
            warm_budget_evictions: 0,
            max_warm_chunks: 256,
            max_payload_bytes: 16 * 1024 * 1024,
        }
    }
}

#[derive(Resource, Clone, Copy)]
pub struct RuntimeBackpressureState {
    pub overfetch_factor: f32,
    pub pressure_level: u8,
    pub target_radius_tiles: i32,
    pub smoothed_frame_ms: f32,
}

impl Default for RuntimeBackpressureState {
    fn default() -> Self {
        Self {
            overfetch_factor: 1.0,
            pressure_level: 0,
            target_radius_tiles: 0,
            smoothed_frame_ms: 0.0,
        }
    }
}

impl RuntimeBackpressureState {
    pub fn update_from_frame_ms(&mut self, frame_ms: u64) {
        // Exponential moving average for quick-but-stable response.
        let alpha = 0.2f32;
        let sample = frame_ms as f32;
        if self.smoothed_frame_ms == 0.0 {
            self.smoothed_frame_ms = sample;
        } else {
            self.smoothed_frame_ms = (1.0 - alpha) * self.smoothed_frame_ms + alpha * sample;
        }
        // Frame budget thresholds (ms): normal <= 22 (>= 45fps), warn <= 40, overload > 40.
        let (target_factor, level) = if self.smoothed_frame_ms <= 22.0 {
            (1.0, 0u8)
        } else if self.smoothed_frame_ms <= 40.0 {
            (0.5, 1u8)
        } else {
            (0.0, 2u8)
        };
        // Ease toward the target so changes don't snap visually.
        let ease = 0.15f32;
        self.overfetch_factor = self.overfetch_factor + (target_factor - self.overfetch_factor) * ease;
        self.overfetch_factor = self.overfetch_factor.clamp(0.0, 1.0);
        self.pressure_level = level;
    }

    pub fn scaled_overfetch_radius(&mut self, base_radius_tiles: i32, min_radius_tiles: i32) -> i32 {
        let scaled = (base_radius_tiles as f32) * self.overfetch_factor;
        let radius = scaled.round() as i32;
        let radius = radius.max(min_radius_tiles).min(base_radius_tiles);
        self.target_radius_tiles = radius;
        radius
    }
}

#[must_use]
pub fn build_input_batch(commands: Vec<WorldCommand>) -> Option<InputBatch> {
    if commands.is_empty() {
        None
    } else {
        Some(InputBatch::new(commands))
    }
}
