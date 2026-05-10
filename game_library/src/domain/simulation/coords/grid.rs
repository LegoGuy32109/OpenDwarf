use bevy::prelude::*;
use bevy::sprite_render::TileData;
use std::collections::HashSet;

use crate::domain::simulation::{ChunkStreamingState, Z_LEVELS_BELOW_RENDERED};
use crate::resources::render_viewport::RenderViewport;
use world_sim::world_api::{Vec3i, Vec3u};

pub(crate) fn active_chunks_xy(
    replay_active: bool,
    world_chunks: Vec3u,
    chunk_streaming_state: Option<&ChunkStreamingState>,
) -> HashSet<IVec2> {
    if replay_active {
        all_world_chunk_coords(world_chunks)
            .into_iter()
            .map(|c| IVec2::new(c.x, c.y))
            .collect()
    } else if let Some(streaming) = chunk_streaming_state {
        if streaming.loaded_chunks.is_empty() {
            all_world_chunk_coords(world_chunks)
                .into_iter()
                .map(|c| IVec2::new(c.x, c.y))
                .collect()
        } else {
            streaming
                .loaded_chunks
                .iter()
                .map(|c| IVec2::new(c.x, c.y))
                .collect()
        }
    } else {
        all_world_chunk_coords(world_chunks)
            .into_iter()
            .map(|c| IVec2::new(c.x, c.y))
            .collect()
    }
}

pub(crate) fn z_levels_to_render(view_z_current: i32) -> Vec<i32> {
    (0..=Z_LEVELS_BELOW_RENDERED)
        .map(|offset| view_z_current - offset)
        .collect()
}

pub(crate) fn chunk_local_tile_index(local_x: u32, local_y: u32, chunk_edge: u32) -> usize {
    usize::try_from(local_y)
        .expect("local_y does not fit in usize")
        .checked_mul(usize::try_from(chunk_edge).expect("chunk edge does not fit in usize"))
        .and_then(|offset| {
            offset.checked_add(usize::try_from(local_x).expect("local_x does not fit in usize"))
        })
        .expect("chunk-local tile index overflowed")
}

pub(crate) fn empty_chunk_tile_data(chunk_edge: u32) -> Vec<Option<TileData>> {
    vec![
        None;
        usize::try_from(chunk_edge)
            .expect("chunk_edge overflowed")
            .checked_mul(usize::try_from(chunk_edge).expect("chunk_edge overflowed"))
            .expect("chunk tile count overflowed")
    ]
}

pub(crate) fn world_pos_in_chunk(
    chunk_coord: Vec3i,
    chunk_edge: u32,
    x: u32,
    y: u32,
    z: i32,
) -> Vec3i {
    let edge_i = i32::try_from(chunk_edge).expect("chunk edge does not fit in i32");
    let half = edge_i / 2;
    Vec3i::new(
        chunk_coord
            .x
            .checked_mul(edge_i)
            .and_then(|base| base.checked_add(i32::try_from(x).expect("x does not fit in i32")))
            .and_then(|value| value.checked_sub(half))
            .expect("world x in chunk overflowed"),
        chunk_coord
            .y
            .checked_mul(edge_i)
            .and_then(|base| base.checked_add(i32::try_from(y).expect("y does not fit in i32")))
            .and_then(|value| value.checked_sub(half))
            .expect("world y in chunk overflowed"),
        z,
    )
}

pub(crate) fn all_world_chunk_coords(world_chunks: Vec3u) -> HashSet<Vec3i> {
    let mut result = HashSet::new();
    let center_x = i32::try_from(world_chunks.x).expect("world_chunks.x too large") / 2;
    let center_y = i32::try_from(world_chunks.y).expect("world_chunks.y too large") / 2;
    let center_z = i32::try_from(world_chunks.z).expect("world_chunks.z too large") / 2;

    for z in 0..world_chunks.z {
        for y in 0..world_chunks.y {
            for x in 0..world_chunks.x {
                result.insert(Vec3i::new(
                    i32::try_from(x).expect("x too large") - center_x,
                    i32::try_from(y).expect("y too large") - center_y,
                    i32::try_from(z).expect("z too large") - center_z,
                ));
            }
        }
    }

    result
}

pub(crate) fn desired_streaming_window(
    viewport: &RenderViewport,
    world_chunks: Vec3u,
) -> HashSet<Vec3i> {
    let z_min = viewport
        .visible_z_levels
        .iter()
        .min()
        .copied()
        .unwrap_or(0)
        .saturating_sub(1);
    let z_max = viewport
        .visible_z_levels
        .iter()
        .max()
        .copied()
        .unwrap_or(0)
        .saturating_add(1);

    let all_chunks = all_world_chunk_coords(world_chunks);
    let mut window = HashSet::new();

    for &chunk_xy in &viewport.visible_chunks_xy {
        for z in z_min..=z_max {
            let chunk = Vec3i::new(chunk_xy.x, chunk_xy.y, z);
            if all_chunks.contains(&chunk) {
                window.insert(chunk);
            }
        }
    }

    window
}
