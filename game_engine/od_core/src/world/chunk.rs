//! Fixed-edge chunk indexing shared by authoritative storage and future views.
//!
//! The engine supports exactly one chunk edge ([`SUPPORTED_CHUNK_EDGE`]).
//! World coordinates are centered: the world minimum corner per axis is
//! `-(world_size_in_voxels / 2)` and the chunk-grid center offset per axis is
//! `floor(world_chunks / 2)`. All conversions go through the centered world
//! minimum and then non-negative division/remainder; truncating division is
//! never applied to negative world coordinates.
//!
//! Canonical orderings:
//!
//! ```text
//! local_chunk = chunk_coord + floor(world_chunks / 2)
//! chunk_index = local_chunk_z * world_chunks.y * world_chunks.x
//!             + local_chunk_y * world_chunks.x
//!             + local_chunk_x
//! voxel_index = voxel_z * 16 * 16 + voxel_y * 16 + voxel_x
//! ```

use super::{Vec3i, Vec3u};

/// The single chunk edge (voxels per axis) supported by this engine.
pub const SUPPORTED_CHUNK_EDGE: u32 = 16;
/// Voxels in one z-slice of a chunk.
pub const CHUNK_AREA: usize = 16 * 16;
/// Voxels in one chunk.
pub const CHUNK_VOLUME: usize = 16 * 16 * 16;
/// `u64` words needed for a one-bit-per-voxel chunk visibility mask.
pub const VISIBILITY_WORDS: usize = CHUNK_VOLUME / 64;

const _: () = assert!(std::mem::size_of::<super::BlockType>() == 1);
const _: () = assert!(CHUNK_AREA == 256);
const _: () = assert!(CHUNK_VOLUME == 4096);
const _: () = assert!(VISIBILITY_WORDS == 64);

/// Convert a centered chunk coordinate into its canonical `Vec` index.
///
/// Returns [`None`] when the chunk lies outside the `dims` chunk grid.
#[must_use]
pub fn chunk_coord_to_index(chunk: Vec3i, dims: Vec3u) -> Option<usize> {
    let local_x = local_chunk_axis(chunk.x, dims.x)?;
    let local_y = local_chunk_axis(chunk.y, dims.y)?;
    let local_z = local_chunk_axis(chunk.z, dims.z)?;
    let dims_x = usize::try_from(dims.x).ok()?;
    let dims_y = usize::try_from(dims.y).ok()?;
    local_z
        .checked_mul(dims_y)?
        .checked_mul(dims_x)?
        .checked_add(local_y.checked_mul(dims_x)?)?
        .checked_add(local_x)
}

/// Convert a canonical chunk `Vec` index back into a centered chunk coordinate.
///
/// Returns [`None`] when `index` is outside the `dims` chunk grid.
#[must_use]
pub fn chunk_index_to_coord(index: usize, dims: Vec3u) -> Option<Vec3i> {
    let dims_x = usize::try_from(dims.x).ok()?;
    let dims_y = usize::try_from(dims.y).ok()?;
    let dims_z = usize::try_from(dims.z).ok()?;
    let volume = dims_x.checked_mul(dims_y)?.checked_mul(dims_z)?;
    if index >= volume {
        return None;
    }
    let local_x = index % dims_x;
    let local_y = (index / dims_x) % dims_y;
    let local_z = index / (dims_x * dims_y);
    Some(Vec3i::new(
        centered_chunk_axis(local_x, dims.x)?,
        centered_chunk_axis(local_y, dims.y)?,
        centered_chunk_axis(local_z, dims.z)?,
    ))
}

/// Convert a world voxel position into `(centered chunk coordinate, voxel index)`.
///
/// Returns [`None`] when the position lies outside the centered world bounds.
#[must_use]
pub fn world_position_to_chunk_voxel(position: Vec3i, dims: Vec3u) -> Option<(Vec3i, usize)> {
    let (local_x, voxel_x) = local_voxel_axis(position.x, dims.x)?;
    let (local_y, voxel_y) = local_voxel_axis(position.y, dims.y)?;
    let (local_z, voxel_z) = local_voxel_axis(position.z, dims.z)?;
    let chunk = Vec3i::new(
        centered_chunk_axis(local_x, dims.x)?,
        centered_chunk_axis(local_y, dims.y)?,
        centered_chunk_axis(local_z, dims.z)?,
    );
    let edge = SUPPORTED_CHUNK_EDGE as usize;
    let voxel_index = voxel_z * edge * edge + voxel_y * edge + voxel_x;
    Some((chunk, voxel_index))
}

/// World position of a chunk's minimum-corner voxel (`voxel_index == 0`).
///
/// Returns [`None`] when the chunk lies outside the `dims` chunk grid.
#[must_use]
pub fn chunk_min_world_position(chunk: Vec3i, dims: Vec3u) -> Option<Vec3i> {
    Some(Vec3i::new(
        chunk_min_world_axis(chunk.x, dims.x)?,
        chunk_min_world_axis(chunk.y, dims.y)?,
        chunk_min_world_axis(chunk.z, dims.z)?,
    ))
}

/// Convert a world voxel position into `(chunk coordinate, voxel index)` on
/// the **unbounded** chunk grid aligned to the centered world (Stage 5).
///
/// Inside the world this agrees exactly with
/// [`world_position_to_chunk_voxel`]. Outside the world it extends the same
/// grid, so perspective bitmaps can key positions beyond the world bounds
/// (the legacy FOV set legitimately contains out-of-world air).
///
/// Returns [`None`] only on arithmetic overflow of a degenerate grid.
#[must_use]
pub fn position_to_chunk_voxel_unbounded(position: Vec3i, dims: Vec3u) -> Option<(Vec3i, usize)> {
    let (chunk_x, voxel_x) = unbounded_axis(position.x, dims.x)?;
    let (chunk_y, voxel_y) = unbounded_axis(position.y, dims.y)?;
    let (chunk_z, voxel_z) = unbounded_axis(position.z, dims.z)?;
    let edge = SUPPORTED_CHUNK_EDGE as usize;
    let voxel_index = voxel_z * edge * edge + voxel_y * edge + voxel_x;
    Some((Vec3i::new(chunk_x, chunk_y, chunk_z), voxel_index))
}

/// World position of a chunk's minimum-corner voxel on the **unbounded**
/// grid aligned to the centered world. Agrees with
/// [`chunk_min_world_position`] for in-grid chunks.
#[must_use]
pub fn chunk_min_world_position_unbounded(chunk: Vec3i, dims: Vec3u) -> Option<Vec3i> {
    Some(Vec3i::new(
        unbounded_chunk_min_axis(chunk.x, dims.x)?,
        unbounded_chunk_min_axis(chunk.y, dims.y)?,
        unbounded_chunk_min_axis(chunk.z, dims.z)?,
    ))
}

/// World coordinate of chunk `0`'s minimum voxel on one axis (the grid
/// alignment offset shared by the bounded and unbounded mappings).
fn grid_offset_axis(dim: u32) -> Option<i32> {
    let min = world_min_axis(dim)?;
    let center = i32::try_from(dim).ok()? / 2;
    min.checked_add(center.checked_mul(16)?)
}

/// Map a world coordinate on one axis to `(unbounded chunk coord, voxel)`.
fn unbounded_axis(position: i32, dim: u32) -> Option<(i32, usize)> {
    let offset = grid_offset_axis(dim)?;
    let rel = i64::from(position) - i64::from(offset);
    let chunk = i32::try_from(rel.div_euclid(16)).ok()?;
    let voxel = usize::try_from(rel.rem_euclid(16)).ok()?;
    Some((chunk, voxel))
}

/// Minimum world coordinate of an unbounded-grid chunk on one axis.
fn unbounded_chunk_min_axis(chunk: i32, dim: u32) -> Option<i32> {
    let offset = grid_offset_axis(dim)?;
    i32::try_from(i64::from(chunk) * 16 + i64::from(offset)).ok()
}

/// Centered world minimum for one axis (in voxels).
fn world_min_axis(dim: u32) -> Option<i32> {
    let size = dim.checked_mul(SUPPORTED_CHUNK_EDGE)?;
    Some(-(i32::try_from(size).ok()? / 2))
}

/// Map a centered chunk coordinate on one axis to its non-negative local index.
fn local_chunk_axis(chunk: i32, dim: u32) -> Option<usize> {
    let center = i32::try_from(dim).ok()? / 2;
    let local = chunk.checked_add(center)?;
    if local < 0 {
        return None;
    }
    let local = usize::try_from(local).ok()?;
    if local >= usize::try_from(dim).ok()? {
        return None;
    }
    Some(local)
}

/// Map a non-negative local chunk index on one axis back to its centered coordinate.
fn centered_chunk_axis(local: usize, dim: u32) -> Option<i32> {
    let center = i32::try_from(dim).ok()? / 2;
    i32::try_from(local).ok()?.checked_sub(center)
}

/// Map a world voxel coordinate on one axis to `(local chunk index, local voxel)`.
fn local_voxel_axis(position: i32, dim: u32) -> Option<(usize, usize)> {
    let size = dim.checked_mul(SUPPORTED_CHUNK_EDGE)?;
    let min = world_min_axis(dim)?;
    let local = position.checked_sub(min)?;
    if local < 0 {
        return None;
    }
    let local = u32::try_from(local).ok()?;
    if local >= size {
        return None;
    }
    let edge = SUPPORTED_CHUNK_EDGE;
    Some((
        usize::try_from(local / edge).ok()?,
        usize::try_from(local % edge).ok()?,
    ))
}

/// World coordinate of the minimum voxel of a chunk on one axis.
fn chunk_min_world_axis(chunk: i32, dim: u32) -> Option<i32> {
    let local = local_chunk_axis(chunk, dim)?;
    let min = world_min_axis(dim)?;
    let offset = i32::try_from(local).ok()?.checked_mul(16)?;
    min.checked_add(offset)
}

#[cfg(test)]
mod tests {
    use super::super::BlockType;
    use super::*;

    const TEST_DIMS: [Vec3u; 3] = [
        Vec3u { x: 1, y: 1, z: 1 },
        Vec3u { x: 2, y: 2, z: 2 },
        Vec3u { x: 9, y: 9, z: 1 },
    ];

    fn chunk_coord_range(dim: u32) -> std::ops::RangeInclusive<i32> {
        let center = i32::try_from(dim).expect("dim fits i32") / 2;
        let min = -center;
        let max = i32::try_from(dim).expect("dim fits i32") - 1 - center;
        min..=max
    }

    #[test]
    fn block_type_is_one_byte() {
        assert_eq!(std::mem::size_of::<BlockType>(), 1);
    }

    #[test]
    fn chunk_coord_index_round_trips_every_chunk() {
        for dims in TEST_DIMS {
            let volume = (dims.x * dims.y * dims.z) as usize;
            let mut seen = vec![false; volume];
            for cz in chunk_coord_range(dims.z) {
                for cy in chunk_coord_range(dims.y) {
                    for cx in chunk_coord_range(dims.x) {
                        let chunk = Vec3i::new(cx, cy, cz);
                        let index = chunk_coord_to_index(chunk, dims)
                            .unwrap_or_else(|| panic!("{chunk:?} in bounds for {dims:?}"));
                        assert!(index < volume, "{chunk:?} index {index} in {dims:?}");
                        assert!(!seen[index], "duplicate index {index} for {dims:?}");
                        seen[index] = true;
                        assert_eq!(
                            chunk_index_to_coord(index, dims),
                            Some(chunk),
                            "inverse mapping for {chunk:?} in {dims:?}"
                        );
                    }
                }
            }
            assert!(seen.iter().all(|used| *used), "dense coverage for {dims:?}");
            assert_eq!(chunk_index_to_coord(volume, dims), None);
        }
    }

    #[test]
    fn chunk_index_order_is_z_major_x_fastest() {
        let dims = Vec3u::new(9, 9, 1);
        assert_eq!(chunk_coord_to_index(Vec3i::new(-4, -4, 0), dims), Some(0));
        assert_eq!(chunk_coord_to_index(Vec3i::new(-3, -4, 0), dims), Some(1));
        assert_eq!(chunk_coord_to_index(Vec3i::new(-4, -3, 0), dims), Some(9));
        assert_eq!(chunk_coord_to_index(Vec3i::new(4, 4, 0), dims), Some(80));
        let dims = Vec3u::new(2, 2, 2);
        assert_eq!(chunk_coord_to_index(Vec3i::new(-1, -1, -1), dims), Some(0));
        assert_eq!(chunk_coord_to_index(Vec3i::new(0, -1, -1), dims), Some(1));
        assert_eq!(chunk_coord_to_index(Vec3i::new(-1, 0, -1), dims), Some(2));
        assert_eq!(chunk_coord_to_index(Vec3i::new(-1, -1, 0), dims), Some(4));
        assert_eq!(chunk_coord_to_index(Vec3i::new(0, 0, 0), dims), Some(7));
    }

    #[test]
    fn out_of_bounds_chunk_coords_are_rejected() {
        for dims in TEST_DIMS {
            for (axis_dim, make) in [
                (dims.x, &(|v| Vec3i::new(v, 0, 0)) as &dyn Fn(i32) -> Vec3i),
                (dims.y, &|v| Vec3i::new(0, v, 0)),
                (dims.z, &|v| Vec3i::new(0, 0, v)),
            ] {
                let range = chunk_coord_range(axis_dim);
                let below = make(range.start() - 1);
                let above = make(range.end() + 1);
                assert_eq!(chunk_coord_to_index(below, dims), None, "{dims:?}");
                assert_eq!(chunk_coord_to_index(above, dims), None, "{dims:?}");
            }
            assert_eq!(chunk_coord_to_index(Vec3i::new(i32::MIN, 0, 0), dims), None);
            assert_eq!(chunk_coord_to_index(Vec3i::new(i32::MAX, 0, 0), dims), None);
        }
    }

    #[test]
    fn world_position_round_trips_min_max_and_edges() {
        for dims in TEST_DIMS {
            let size_x = i32::try_from(dims.x * 16).expect("size");
            let size_y = i32::try_from(dims.y * 16).expect("size");
            let size_z = i32::try_from(dims.z * 16).expect("size");
            let min = Vec3i::new(-(size_x / 2), -(size_y / 2), -(size_z / 2));
            let max = Vec3i::new(min.x + size_x - 1, min.y + size_y - 1, min.z + size_z - 1);

            let interesting = [
                min,
                max,
                Vec3i::new(min.x, max.y, min.z),
                Vec3i::new(max.x, min.y, max.z),
                Vec3i::new(0, 0, 0),
                Vec3i::new(-1, -1, -1),
                Vec3i::new(min.x + 15, min.y + 15, min.z),
                Vec3i::new(min.x + 16, min.y + 16, min.z),
            ];
            for position in interesting {
                if position.x > max.x || position.y > max.y || position.z > max.z {
                    continue;
                }
                let (chunk, voxel) = world_position_to_chunk_voxel(position, dims)
                    .unwrap_or_else(|| panic!("{position:?} in bounds for {dims:?}"));
                assert!(voxel < CHUNK_VOLUME);
                assert!(
                    chunk_coord_to_index(chunk, dims).is_some(),
                    "{position:?} maps to in-grid chunk for {dims:?}"
                );
                // Reconstruct the world position from the chunk base + voxel index.
                let base = chunk_min_world_position(chunk, dims).expect("chunk base");
                let vx = i32::try_from(voxel % 16).expect("vx");
                let vy = i32::try_from((voxel / 16) % 16).expect("vy");
                let vz = i32::try_from(voxel / 256).expect("vz");
                assert_eq!(
                    Vec3i::new(base.x + vx, base.y + vy, base.z + vz),
                    position,
                    "voxel inverse for {position:?} in {dims:?}"
                );
            }

            // One-past-the-edge positions are rejected on every axis.
            for outside in [
                Vec3i::new(min.x - 1, 0, 0),
                Vec3i::new(max.x + 1, 0, 0),
                Vec3i::new(0, min.y - 1, 0),
                Vec3i::new(0, max.y + 1, 0),
                Vec3i::new(0, 0, min.z - 1),
                Vec3i::new(0, 0, max.z + 1),
            ] {
                // `0` components may themselves be out of bounds only when the
                // world is thinner than the probe; clamp the probe first.
                let probe = Vec3i::new(
                    outside.x.clamp(min.x - 1, max.x + 1),
                    outside.y.clamp(min.y - 1, max.y + 1),
                    outside.z.clamp(min.z - 1, max.z + 1),
                );
                if probe.x < min.x
                    || probe.x > max.x
                    || probe.y < min.y
                    || probe.y > max.y
                    || probe.z < min.z
                    || probe.z > max.z
                {
                    assert_eq!(
                        world_position_to_chunk_voxel(probe, dims),
                        None,
                        "{probe:?} rejected for {dims:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn voxel_index_is_z_major_x_fastest_within_chunk() {
        let dims = Vec3u::new(1, 1, 1);
        assert_eq!(
            world_position_to_chunk_voxel(Vec3i::new(-8, -8, -8), dims),
            Some((Vec3i::ZERO, 0))
        );
        assert_eq!(
            world_position_to_chunk_voxel(Vec3i::new(-7, -8, -8), dims),
            Some((Vec3i::ZERO, 1))
        );
        assert_eq!(
            world_position_to_chunk_voxel(Vec3i::new(-8, -7, -8), dims),
            Some((Vec3i::ZERO, 16))
        );
        assert_eq!(
            world_position_to_chunk_voxel(Vec3i::new(-8, -8, -7), dims),
            Some((Vec3i::ZERO, 256))
        );
        assert_eq!(
            world_position_to_chunk_voxel(Vec3i::new(7, 7, 7), dims),
            Some((Vec3i::ZERO, CHUNK_VOLUME - 1))
        );
    }

    #[test]
    fn unbounded_mapping_agrees_with_bounded_inside_the_world() {
        for dims in TEST_DIMS {
            let size = |dim: u32| i32::try_from(dim * 16).expect("size");
            let min = Vec3i::new(
                -(size(dims.x) / 2),
                -(size(dims.y) / 2),
                -(size(dims.z) / 2),
            );
            let max = Vec3i::new(
                min.x + size(dims.x) - 1,
                min.y + size(dims.y) - 1,
                min.z + size(dims.z) - 1,
            );
            for position in [
                min,
                max,
                Vec3i::new(0, 0, 0),
                Vec3i::new(-1, -1, -1),
                Vec3i::new(min.x + 15, max.y - 15, min.z),
            ] {
                assert_eq!(
                    position_to_chunk_voxel_unbounded(position, dims),
                    world_position_to_chunk_voxel(position, dims),
                    "in-world agreement at {position:?} for {dims:?}"
                );
            }
        }
    }

    #[test]
    fn unbounded_mapping_extends_the_grid_outside_the_world() {
        let dims = Vec3u::new(1, 1, 1); // world spans [-8, 7] per axis
        // One voxel past the maximum edge starts the next chunk.
        assert_eq!(
            position_to_chunk_voxel_unbounded(Vec3i::new(8, 0, 0), dims),
            Some((Vec3i::new(1, 0, 0), 8 * 256 + 8 * 16)), // voxel (0, 8, 8)
        );
        // One voxel below the minimum edge is the last voxel of chunk -1.
        assert_eq!(
            position_to_chunk_voxel_unbounded(Vec3i::new(-9, -8, -8), dims),
            Some((Vec3i::new(-1, 0, 0), 15)),
        );
        // Round trip through the unbounded chunk base.
        for position in [
            Vec3i::new(27, -30, 41),
            Vec3i::new(-100, 3, -17),
            Vec3i::new(7, 8, -9),
        ] {
            let (chunk, voxel) = position_to_chunk_voxel_unbounded(position, dims).expect("mapped");
            let base = chunk_min_world_position_unbounded(chunk, dims).expect("base");
            let vx = i32::try_from(voxel % 16).expect("vx");
            let vy = i32::try_from((voxel / 16) % 16).expect("vy");
            let vz = i32::try_from(voxel / 256).expect("vz");
            assert_eq!(Vec3i::new(base.x + vx, base.y + vy, base.z + vz), position);
        }
        // In-grid chunk bases agree with the bounded helper.
        let dims = Vec3u::new(9, 9, 1);
        for chunk in [
            Vec3i::new(-4, -4, 0),
            Vec3i::new(0, 0, 0),
            Vec3i::new(4, 4, 0),
        ] {
            assert_eq!(
                chunk_min_world_position_unbounded(chunk, dims),
                chunk_min_world_position(chunk, dims),
            );
        }
    }

    #[test]
    fn chunk_min_world_position_matches_centered_bounds() {
        let dims = Vec3u::new(9, 9, 1);
        assert_eq!(
            chunk_min_world_position(Vec3i::new(-4, -4, 0), dims),
            Some(Vec3i::new(-72, -72, -8))
        );
        assert_eq!(
            chunk_min_world_position(Vec3i::new(0, 0, 0), dims),
            Some(Vec3i::new(-8, -8, -8))
        );
        assert_eq!(
            chunk_min_world_position(Vec3i::new(4, 4, 0), dims),
            Some(Vec3i::new(56, 56, -8))
        );
        assert_eq!(chunk_min_world_position(Vec3i::new(5, 0, 0), dims), None);
    }
}
