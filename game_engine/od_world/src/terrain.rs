//! Terrain generation and cave noise (ported from `world_sim::world_core`).
//!
//! Uses f64 Perlin-like noise as-is. Native↔wasm bit identity is an accepted
//! risk for Increment 2; see `docs/design/sim-replay.md` §6.

use std::collections::HashMap;

use od_core::world::{BlockType, TerrainConfig, Vec3i, Vec3u};

const PLAYABLE_NOISE_BAND_HALF_THICKNESS: i32 = 1;
const STARTER_ROOM_HALF_EXTENT: i32 = 3;
const STARTER_ROOM_HALF_HEIGHT: i32 = 1;

#[must_use]
pub(crate) fn make_initial_blocks(
    chunk_edge: u32,
    world_chunks: Vec3u,
    block_count: usize,
    terrain: &TerrainConfig,
) -> Vec<BlockType> {
    let world_size = Vec3u::new(
        world_chunks
            .x
            .checked_mul(chunk_edge)
            .expect("world x-size overflowed"),
        world_chunks
            .y
            .checked_mul(chunk_edge)
            .expect("world y-size overflowed"),
        world_chunks
            .z
            .checked_mul(chunk_edge)
            .expect("world z-size overflowed"),
    );
    let min = world_min_for_size(world_size);
    let world_size_x = usize::try_from(world_size.x).expect("world size x does not fit in usize");
    let world_size_y = usize::try_from(world_size.y).expect("world size y does not fit in usize");
    let seed = seed_to_u64(&terrain.seed);

    let mut blocks = vec![BlockType::SolidStone; block_count];
    for z in 0..world_size.z {
        let world_z = min.z + i32::try_from(z).expect("z does not fit in i32");
        for y in 0..world_size_y {
            let world_y = min.y + i32::try_from(y).expect("y does not fit in i32");
            for x in 0..world_size_x {
                let world_x = min.x + i32::try_from(x).expect("x does not fit in i32");
                let world_position = Vec3i::new(world_x, world_y, world_z);
                let index = world_position_to_index(world_position, world_size)
                    .expect("world position should be in bounds");
                if is_within_starter_room(world_position)
                    || (is_within_playable_noise_band(world_position)
                        && sample_cave_density(world_position, terrain, seed)
                            > terrain.cave_threshold)
                {
                    blocks[index] = BlockType::Air;
                }
            }
        }
    }
    blocks
}

#[must_use]
pub(crate) fn build_terrain_blocks_cache(
    blocks: &[BlockType],
    chunk_edge: u32,
    world_chunks: Vec3u,
) -> HashMap<Vec3i, BlockType> {
    let world_size = Vec3u::new(
        world_chunks
            .x
            .checked_mul(chunk_edge)
            .expect("world x-size overflowed"),
        world_chunks
            .y
            .checked_mul(chunk_edge)
            .expect("world y-size overflowed"),
        world_chunks
            .z
            .checked_mul(chunk_edge)
            .expect("world z-size overflowed"),
    );
    let min = world_min_for_size(world_size);

    let mut map = HashMap::with_capacity(blocks.len());
    let world_size_x = usize::try_from(world_size.x).expect("world size x does not fit in usize");
    let world_size_y = usize::try_from(world_size.y).expect("world size y does not fit in usize");
    let layer_size = world_size_x
        .checked_mul(world_size_y)
        .expect("world layer size overflowed");

    for z in 0..world_size.z {
        let z_offset = usize::try_from(z).expect("z does not fit in usize") * layer_size;
        for y in 0..world_size.y {
            let y_offset =
                z_offset + usize::try_from(y).expect("y does not fit in usize") * world_size_x;
            for x in 0..world_size.x {
                let index = y_offset + usize::try_from(x).expect("x does not fit in usize");
                let block = blocks[index];
                if block == BlockType::SolidStone {
                    map.insert(
                        Vec3i::new(
                            min.x + i32::try_from(x).expect("x does not fit in i32"),
                            min.y + i32::try_from(y).expect("y does not fit in i32"),
                            min.z + i32::try_from(z).expect("z does not fit in i32"),
                        ),
                        block,
                    );
                }
            }
        }
    }

    map
}

#[must_use]
pub(crate) fn world_min_for_size(world_size: Vec3u) -> Vec3i {
    Vec3i::new(
        -(i32::try_from(world_size.x).expect("world size x does not fit in i32") / 2),
        -(i32::try_from(world_size.y).expect("world size y does not fit in i32") / 2),
        -(i32::try_from(world_size.z).expect("world size z does not fit in i32") / 2),
    )
}

#[must_use]
pub(crate) fn world_position_to_index(
    world_position: Vec3i,
    world_size: Vec3u,
) -> Option<usize> {
    let min = world_min_for_size(world_size);
    let local_x = world_position.x - min.x;
    let local_y = world_position.y - min.y;
    let local_z = world_position.z - min.z;
    if local_x < 0 || local_y < 0 || local_z < 0 {
        return None;
    }

    let local_x = usize::try_from(local_x).ok()?;
    let local_y = usize::try_from(local_y).ok()?;
    let local_z = usize::try_from(local_z).ok()?;
    let world_size_x = usize::try_from(world_size.x).ok()?;
    let world_size_y = usize::try_from(world_size.y).ok()?;
    let world_size_z = usize::try_from(world_size.z).ok()?;
    if local_x >= world_size_x || local_y >= world_size_y || local_z >= world_size_z {
        return None;
    }

    let layer_size = world_size_x.checked_mul(world_size_y)?;
    local_z
        .checked_mul(layer_size)
        .and_then(|offset| offset.checked_add(local_y.checked_mul(world_size_x)?))
        .and_then(|offset| offset.checked_add(local_x))
}

fn sample_cave_density(world_position: Vec3i, terrain: &TerrainConfig, seed: u64) -> f64 {
    let slice_seed =
        seed.wrapping_add((world_position.z as i64 as u64).wrapping_mul(0xD1B5_4A32_D192_ED03));
    sample_cave_density_xy(world_position, terrain, slice_seed)
}

fn sample_cave_density_xy(world_position: Vec3i, terrain: &TerrainConfig, seed: u64) -> f64 {
    let mut frequency_xy = terrain.cave_frequency_xy;
    let mut amplitude = 1.0;
    let mut total_amplitude = 0.0;
    let mut total_density = 0.0;
    let octaves = terrain.cave_octaves.max(1);
    let x = f64::from(world_position.x);
    let y = f64::from(world_position.y);

    for octave in 0..octaves {
        let octave_seed =
            seed.wrapping_add(u64::from(octave + 1).wrapping_mul(0x9E37_79B9_7F4A_7C15));
        let noise = perlin_like_noise_3d(octave_seed, x * frequency_xy, y * frequency_xy, 0.0);
        total_density += noise * amplitude;
        total_amplitude += amplitude;
        amplitude *= terrain.cave_persistence;
        frequency_xy *= terrain.cave_lacunarity;
    }

    if total_amplitude == 0.0 {
        0.0
    } else {
        total_density / total_amplitude
    }
}

fn is_within_playable_noise_band(world_position: Vec3i) -> bool {
    world_position.z.abs() <= PLAYABLE_NOISE_BAND_HALF_THICKNESS
}

fn is_within_starter_room(world_position: Vec3i) -> bool {
    world_position.x.abs() <= STARTER_ROOM_HALF_EXTENT
        && world_position.y.abs() <= STARTER_ROOM_HALF_EXTENT
        && world_position.z.abs() <= STARTER_ROOM_HALF_HEIGHT
}

fn perlin_like_noise_3d(seed: u64, x: f64, y: f64, z: f64) -> f64 {
    let x_floor = x.floor();
    let y_floor = y.floor();
    let z_floor = z.floor();

    let x0 = x_floor as i64;
    let y0 = y_floor as i64;
    let z0 = z_floor as i64;
    let x1 = x0 + 1;
    let y1 = y0 + 1;
    let z1 = z0 + 1;

    let xf = x - x_floor;
    let yf = y - y_floor;
    let zf = z - z_floor;

    let u = fade(xf);
    let v = fade(yf);
    let w = fade(zf);

    let aaa = gradient_hash(seed, x0, y0, z0);
    let aba = gradient_hash(seed, x0, y1, z0);
    let aab = gradient_hash(seed, x0, y0, z1);
    let abb = gradient_hash(seed, x0, y1, z1);
    let baa = gradient_hash(seed, x1, y0, z0);
    let bba = gradient_hash(seed, x1, y1, z0);
    let bab = gradient_hash(seed, x1, y0, z1);
    let bbb = gradient_hash(seed, x1, y1, z1);

    let x_lerp1 = lerp(u, grad(aaa, xf, yf, zf), grad(baa, xf - 1.0, yf, zf));
    let x_lerp2 = lerp(
        u,
        grad(aba, xf, yf - 1.0, zf),
        grad(bba, xf - 1.0, yf - 1.0, zf),
    );
    let y_lerp1 = lerp(v, x_lerp1, x_lerp2);

    let x_lerp3 = lerp(
        u,
        grad(aab, xf, yf, zf - 1.0),
        grad(bab, xf - 1.0, yf, zf - 1.0),
    );
    let x_lerp4 = lerp(
        u,
        grad(abb, xf, yf - 1.0, zf - 1.0),
        grad(bbb, xf - 1.0, yf - 1.0, zf - 1.0),
    );
    let y_lerp2 = lerp(v, x_lerp3, x_lerp4);

    lerp(w, y_lerp1, y_lerp2)
}

fn gradient_hash(seed: u64, x: i64, y: i64, z: i64) -> u64 {
    let mut hash = seed ^ 0x9E37_79B9_7F4A_7C15;
    hash ^= mix_u64(x as u64);
    hash = hash.rotate_left(17) ^ mix_u64(y as u64);
    hash = hash.rotate_left(17) ^ mix_u64(z as u64);
    mix_u64(hash)
}

fn grad(hash: u64, x: f64, y: f64, z: f64) -> f64 {
    match hash & 0xF {
        0 => x + y,
        1 => -x + y,
        2 => x - y,
        3 => -x - y,
        4 => x + z,
        5 => -x + z,
        6 => x - z,
        7 => -x - z,
        8 => y + z,
        9 => -y + z,
        10 => y - z,
        11 => -y - z,
        12 => x + y,
        13 => -x + y,
        14 => -y + z,
        _ => -x - z,
    }
}

fn fade(t: f64) -> f64 {
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

fn lerp(t: f64, a: f64, b: f64) -> f64 {
    a + t * (b - a)
}

fn mix_u64(mut value: u64) -> u64 {
    value ^= value >> 30;
    value = value.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94D0_49BB_1331_11EB);
    value ^ (value >> 31)
}

fn seed_to_u64(seed: &str) -> u64 {
    let mut hash = 0xCBF2_9CE4_8422_2325_u64;
    for byte in seed.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01B3);
    }
    mix_u64(hash)
}
