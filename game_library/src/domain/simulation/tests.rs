use super::{FogData, input::direction_contains, sync::snapshot_visibility_changed};
use bevy::math::IVec3;
use std::{collections::HashMap, sync::Arc};
use world_sim::world_api::{
    BlockType, TileMemory, Vec3i, Vec3u, VisibilitySnapshot, WorldSnapshot,
};

use crate::resources::view_mode::ViewMode;

#[test]
fn direction_contains_requires_active_direction_to_still_be_held() {
    assert!(direction_contains(
        IVec3::new(1, -1, 0),
        IVec3::new(0, -1, 0)
    ));
    assert!(direction_contains(IVec3::new(1, 1, 0), IVec3::new(1, 0, 0)));
    assert!(!direction_contains(
        IVec3::new(1, 0, 0),
        IVec3::new(0, -1, 0)
    ));
    assert!(!direction_contains(
        IVec3::new(0, -1, 0),
        IVec3::new(0, -1, 1)
    ));
}

#[test]
fn snapshot_visibility_changed_detects_same_tick_fov_update() {
    let position = Vec3i::new(1, 2, 3);
    let mut fog = FogData::default();
    fog.memory.insert(
        position,
        TileMemory {
            block: BlockType::Air,
            tick_observed: 1,
        },
    );

    let snapshot = WorldSnapshot {
        tick: 7,
        chunk_edge: 16,
        world_chunks: Vec3u::new(3, 3, 3),
        terrain_blocks: Arc::new(HashMap::new()),
        entities: Vec::new(),
        visibility: Some(VisibilitySnapshot {
            entity_id: 1,
            visible: vec![position],
            memory: HashMap::new(),
        }),
    };

    assert!(snapshot_visibility_changed(
        ViewMode::Entity,
        &fog,
        &snapshot
    ));
    assert!(!snapshot_visibility_changed(
        ViewMode::Master,
        &fog,
        &snapshot
    ));
}
