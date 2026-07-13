//! Terrain generation and cave noise (ported from `world_sim::world_core`).
//!
//! Uses f64 Perlin-like noise as-is. Native↔wasm bit identity is an accepted
//! risk for Increment 2; see `docs/design/sim-replay.md` §6.
//!
//! Generation fills fixed chunk-local typed arrays directly from world
//! coordinates; the noise samples depend only on the world position, so the
//! generated blocks are identical to the legacy world-major fill.

use od_core::world::chunk::{CHUNK_VOLUME, SUPPORTED_CHUNK_EDGE, chunk_min_world_position};
use od_core::world::{BlockType, TerrainConfig, Vec3i, Vec3u};

const PLAYABLE_NOISE_BAND_HALF_THICKNESS: i32 = 1;
const STARTER_ROOM_HALF_EXTENT: i32 = 3;
const STARTER_ROOM_HALF_HEIGHT: i32 = 1;

/// Generate the blocks of one chunk in canonical local-voxel order
/// (z-major, x fastest).
///
/// `seed` is the precomputed [`seed_to_u64`] of the terrain seed string.
#[must_use]
pub(crate) fn generate_chunk_blocks(
    chunk: Vec3i,
    world_chunks: Vec3u,
    terrain: &TerrainConfig,
    seed: u64,
) -> Box<[BlockType; CHUNK_VOLUME]> {
    let base = chunk_min_world_position(chunk, world_chunks)
        .expect("generated chunk coordinate should be inside the chunk grid");
    let edge = i32::try_from(SUPPORTED_CHUNK_EDGE).expect("chunk edge fits in i32");
    let mut blocks = Box::new([BlockType::SolidStone; CHUNK_VOLUME]);
    let mut index = 0_usize;
    for vz in 0..edge {
        let world_z = base.z + vz;
        for vy in 0..edge {
            let world_y = base.y + vy;
            for vx in 0..edge {
                let world_position = Vec3i::new(base.x + vx, world_y, world_z);
                if is_within_starter_room(world_position)
                    || (is_within_playable_noise_band(world_position)
                        && sample_cave_density(world_position, terrain, seed)
                            > terrain.cave_threshold)
                {
                    blocks[index] = BlockType::Air;
                }
                index += 1;
            }
        }
    }
    blocks
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

#[must_use]
pub(crate) fn seed_to_u64(seed: &str) -> u64 {
    let mut hash = 0xCBF2_9CE4_8422_2325_u64;
    for byte in seed.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01B3);
    }
    mix_u64(hash)
}
