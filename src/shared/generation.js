// @ts-check

import {
  CHUNK_EDGE,
  chunkCoord,
  chunkIndex,
  createChunkData,
  ensureChunk,
  hasChunk,
  OPEN,
  STONE,
  WORLD_TOP,
} from "./terrain.js";
import {
  COAL,
  DIAMOND,
  EMERALD,
  GOLD_ORE,
  IRON_ORE,
  LAPIS,
  REDSTONE,
} from "./materials.js";

/**
 * Generated terrain (ADR 0003): solid stone with caves, and ores in clusters by
 * depth band. The world host calls the generator through `world.generateChunk`.
 * It is a pure function of the session seed and the chunk coordinates, so the
 * same seed always gives the same chunk. Caves read global tile coordinates, so
 * they continue across chunk borders; ore clusters stay inside their chunk.
 */

/**
 * An ore cluster rule. `attempts` is the average number of clusters per chunk
 * in the band, and each cluster is a random walk of `min` to `max` tiles.
 * @typedef {{material:number,zMin:number,zMax:number,attempts:number,min:number,max:number}} OreBand
 */

/** @type {readonly OreBand[]} */
export const ORE_BANDS = Object.freeze([
  { material: COAL, zMin: 5, zMax: 7, attempts: 6, min: 5, max: 10 },
  { material: IRON_ORE, zMin: 5, zMax: 7, attempts: 3, min: 3, max: 7 },
  { material: IRON_ORE, zMin: 2, zMax: 4, attempts: 1, min: 3, max: 6 },
  { material: GOLD_ORE, zMin: 2, zMax: 4, attempts: 1.5, min: 2, max: 5 },
  { material: LAPIS, zMin: 2, zMax: 4, attempts: 1.5, min: 3, max: 6 },
  { material: REDSTONE, zMin: 2, zMax: 4, attempts: 2, min: 3, max: 7 },
  { material: DIAMOND, zMin: 0, zMax: 1, attempts: 0.7, min: 1, max: 3 },
  { material: EMERALD, zMin: 0, zMax: 1, attempts: 0.4, min: 1, max: 2 },
]);

/** Chunks generated around a player: every chunk within this many chunks. */
export const GENERATE_RADIUS = 1;

/**
 * The world host unloads a chunk once no player has been within this many
 * chunks of it for `UNLOAD_GRACE_MS` (ADR 0005). One ring beyond the generate
 * radius, so pacing across a chunk border does not reload chunks.
 */
export const UNLOAD_RADIUS = 2;
export const UNLOAD_GRACE_MS = 30_000;

/** @param {number} a @param {number} b @param {number} c @param {number} d */
function hash(a, b, c, d) {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^
    Math.imul(c | 0, 0xc2b2ae3d) ^ Math.imul(d | 0, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Turn any text into a 32-bit seed. @param {string} text */
export function seedFromText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  }
  return hash(h, text.length, 0, 0);
}

/** A small seeded random generator returning floats in [0, 1). @param {number} seed */
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in [0, 1) at a point, one lattice cell per unit. */
/** @param {number} seed @param {number} channel @param {number} x @param {number} y @param {number} z */
function noise(seed, channel, x, y, z) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const s = seed ^ Math.imul(channel, 0x9e3779b1);
  /** @param {number} dx @param {number} dy @param {number} dz */
  const corner = (dx, dy, dz) =>
    hash(s, x0 + dx, y0 + dy, z0 + dz) / 4294967296;
  const lerp = (
    /** @type {number} */ a,
    /** @type {number} */ b,
    /** @type {number} */ t,
  ) => a + (b - a) * t;
  return lerp(
    lerp(
      lerp(corner(0, 0, 0), corner(1, 0, 0), sx),
      lerp(corner(0, 1, 0), corner(1, 1, 0), sx),
      sy,
    ),
    lerp(
      lerp(corner(0, 0, 1), corner(1, 0, 1), sx),
      lerp(corner(0, 1, 1), corner(1, 1, 1), sx),
      sy,
    ),
    sz,
  );
}

/** Horizontal and vertical size of one noise cell, in tiles. */
const CAVE_SCALE_XY = 11;
const CAVE_SCALE_Z = 3;
/** Tunnels form where both noise fields sit near 0.5; a wider band opens more cave. */
const TUNNEL_WIDTH = 0.085;

/** @param {number} seed @param {number} cx @param {number} cy @param {Uint8Array} data */
function carveCaves(seed, cx, cy, data) {
  const originX = cx * CHUNK_EDGE;
  const originY = cy * CHUNK_EDGE;
  for (let z = 0; z <= WORLD_TOP; z++) {
    for (let y = 0; y < CHUNK_EDGE; y++) {
      for (let x = 0; x < CHUNK_EDGE; x++) {
        const nx = (originX + x) / CAVE_SCALE_XY;
        const ny = (originY + y) / CAVE_SCALE_XY;
        const nz = z / CAVE_SCALE_Z;
        const a = noise(seed, 1, nx, ny, nz) - 0.5;
        if (Math.abs(a) > TUNNEL_WIDTH) continue;
        const b = noise(seed, 2, nx, ny, nz) - 0.5;
        if (Math.abs(b) <= TUNNEL_WIDTH) {
          data[chunkIndex(x, y, z)] = OPEN;
        }
      }
    }
  }
}

/** Grow one cluster as a random walk from a start tile, replacing stone only. */
/** @param {Uint8Array} data @param {() => number} random @param {OreBand} band */
function placeCluster(data, random, band) {
  let x = Math.floor(random() * CHUNK_EDGE);
  let y = Math.floor(random() * CHUNK_EDGE);
  let z = band.zMin + Math.floor(random() * (band.zMax - band.zMin + 1));
  const size = band.min + Math.floor(random() * (band.max - band.min + 1));
  for (let placed = 0, steps = 0; placed < size && steps < size * 6; steps++) {
    const index = chunkIndex(x, y, z);
    if (data[index] === STONE) {
      data[index] = band.material;
      placed++;
    }
    const axis = Math.floor(random() * 3);
    const delta = random() < 0.5 ? -1 : 1;
    if (axis === 0) x = Math.max(0, Math.min(CHUNK_EDGE - 1, x + delta));
    else if (axis === 1) y = Math.max(0, Math.min(CHUNK_EDGE - 1, y + delta));
    else z = Math.max(band.zMin, Math.min(band.zMax, z + delta));
  }
}

/** @param {number} seed @param {number} cx @param {number} cy @param {Uint8Array} data */
function placeOres(seed, cx, cy, data) {
  ORE_BANDS.forEach((band, bandIndex) => {
    const random = createRandom(hash(seed, cx, cy, 1000 + bandIndex));
    let clusters = Math.floor(band.attempts);
    if (random() < band.attempts - clusters) clusters++;
    for (let i = 0; i < clusters; i++) placeCluster(data, random, band);
  });
}

/**
 * Generate one chunk from the seed. Pure: the same inputs give identical data.
 * @param {number} seed @param {number} cx @param {number} cy
 */
export function generateChunkData(seed, cx, cy) {
  const data = createChunkData(STONE);
  carveCaves(seed >>> 0, cx, cy, data);
  placeOres(seed >>> 0, cx, cy, data);
  return data;
}

/**
 * Make a `world.generateChunk` hook for a seed. `stats` counts chunks and
 * accumulates the time spent, so the host can report generation cost.
 * @param {number} seed
 */
export function createChunkGenerator(seed) {
  const stats = { chunks: 0, totalMs: 0, maxMs: 0 };
  /** @param {number} cx @param {number} cy */
  const generate = (cx, cy) => {
    const start = performance.now();
    const data = generateChunkData(seed, cx, cy);
    const elapsed = performance.now() - start;
    stats.chunks++;
    stats.totalMs += elapsed;
    stats.maxMs = Math.max(stats.maxMs, elapsed);
    return data;
  };
  return Object.assign(generate, { seed: seed >>> 0, stats });
}

/**
 * Create the chunks within `GENERATE_RADIUS` of each tile that are still
 * missing, nearest first, and stop after `budget` chunks so one host tick never
 * generates a whole ring at once; the rest follow on later ticks. Existing
 * chunks, including the authored area, are never replaced. Without a
 * `world.generateChunk` hook nothing is created.
 * @param {import('./terrain.js').TerrainStore} world
 * @param {{x:number,y:number}[]} tiles
 * @param {number} [budget]
 * @returns {number} how many chunks were generated
 */
export function generateAround(world, tiles, budget = 2) {
  if (!world.generateChunk) return 0;
  /** @type {{cx:number,cy:number,distance:number}[]} */
  const wanted = [];
  for (const tile of tiles) {
    const px = chunkCoord(tile.x);
    const py = chunkCoord(tile.y);
    for (let dy = -GENERATE_RADIUS; dy <= GENERATE_RADIUS; dy++) {
      for (let dx = -GENERATE_RADIUS; dx <= GENERATE_RADIUS; dx++) {
        const cx = px + dx;
        const cy = py + dy;
        if (hasChunk(world, cx, cy)) continue;
        wanted.push({ cx, cy, distance: dx * dx + dy * dy });
      }
    }
  }
  if (!wanted.length) return 0;
  wanted.sort((a, b) => a.distance - b.distance);
  let made = 0;
  for (const { cx, cy } of wanted) {
    if (made >= budget) break;
    if (hasChunk(world, cx, cy)) continue;
    ensureChunk(world, cx, cy);
    made++;
  }
  return made;
}
