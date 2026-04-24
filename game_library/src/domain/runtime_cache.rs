use bevy::prelude::*;
use std::collections::{HashMap, VecDeque};
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
}

impl RuntimePatchApplyQueue {
    pub fn push(&mut self, event: RuntimeEvent) {
        self.events.push_back(event);
    }

    #[must_use]
    pub fn drain(&mut self) -> Vec<RuntimeEvent> {
        self.events.drain(..).collect()
    }
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
        }
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
