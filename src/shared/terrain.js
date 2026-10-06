// @ts-check

/**
 * Chunked terrain storage (ADR 0003). A chunk is a 16×16 horizontal region
 * across all eight levels, keyed by chunk coordinates that can be negative.
 * A tile in a chunk that does not exist reads as solid stone.
 *
 * Later tickets use `readTile`, `writeTile`, `world.generateChunk` and
 * `drainTileChanges`. Everything else here is plumbing for those.
 */

export const CHUNK_EDGE = 16;
export const WORLD_TOP = 7;
export const LEVELS = WORLD_TOP + 1;
export const CHUNK_CELLS = CHUNK_EDGE * CHUNK_EDGE * LEVELS;
/** Largest chunk coordinate the wire accepts, so keys stay short and finite. */
export const MAX_CHUNK_COORD = 1 << 20;

/** Tile materials. `UNKNOWN` fills a remembered chunk where nothing was seen. */
export const UNKNOWN = 0;
export const OPEN = 1;
export const STONE = 2;

/** @typedef {Uint8Array} ChunkData One material byte per tile, `z * 256 + localY * 16 + localX`. */
/** @typedef {{x:number,y:number,z:number,material:number}} TileChange */
/** @typedef {{chunks:Map<string,ChunkData>,generateChunk?:((cx:number,cy:number)=>ChunkData)|null,changes?:Map<string,TileChange>,pinned?:Set<string>,edits?:Map<string,Map<number,number>>}} TerrainStore */

/** @param {number} cx @param {number} cy */
export function chunkKey(cx, cy) {
  return `${cx},${cy}`;
}

/** Parse a canonical chunk key, or return null. */
/** @param {string} key @returns {{cx:number,cy:number}|null} */
export function parseChunkKey(key) {
  const match = /^(-?(?:0|[1-9]\d{0,6})),(-?(?:0|[1-9]\d{0,6}))$/.exec(key);
  if (!match) return null;
  const cx = Number(match[1]);
  const cy = Number(match[2]);
  if (
    Object.is(cx, -0) || Object.is(cy, -0) ||
    Math.abs(cx) > MAX_CHUNK_COORD || Math.abs(cy) > MAX_CHUNK_COORD
  ) return null;
  return { cx, cy };
}

/** Chunk coordinate of a tile coordinate; -1 belongs to chunk -1, 16 to chunk 1. */
/** @param {number} tile */
export function chunkCoord(tile) {
  return Math.floor(tile / CHUNK_EDGE);
}

/** Position inside a chunk, 0 through 15, for any integer tile coordinate. */
/** @param {number} tile */
export function localCoord(tile) {
  return ((tile % CHUNK_EDGE) + CHUNK_EDGE) % CHUNK_EDGE;
}

/** Index into `ChunkData` for local x, y and level z. */
/** @param {number} localX @param {number} localY @param {number} z */
export function chunkIndex(localX, localY, z) {
  return z * CHUNK_EDGE * CHUNK_EDGE + localY * CHUNK_EDGE + localX;
}

/** @param {number} [material] @returns {ChunkData} */
export function createChunkData(material = STONE) {
  return new Uint8Array(CHUNK_CELLS).fill(material);
}

const CACHE_SIZE = 16;
/** @type {(Map<string,ChunkData>|null)[]} */
const cacheChunks = Array(CACHE_SIZE + 1).fill(null);
const cacheX = new Int32Array(CACHE_SIZE + 1);
const cacheY = new Int32Array(CACHE_SIZE + 1);
/** @type {(ChunkData|null)[]} */
const cacheData = Array(CACHE_SIZE + 1).fill(null);
const cacheGeneration = new Uint32Array(CACHE_SIZE + 1);
let generation = 1;
/** Slot 16 holds the last lookup, checked first; slots 0 through 15 are direct mapped. */
const LAST = CACHE_SIZE;

/** @param {number} slot @param {Map<string,ChunkData>} chunks @param {number} cx @param {number} cy @param {ChunkData|null} data */
function remember(slot, chunks, cx, cy, data) {
  cacheChunks[slot] = chunks;
  cacheX[slot] = cx;
  cacheY[slot] = cy;
  cacheData[slot] = data;
  cacheGeneration[slot] = generation;
}

/**
 * Look up a chunk, or return null. Sight, collision and drawing read tiles in
 * tight loops, so a small cache avoids building a string key for each read.
 * It remembers misses too; `setChunk` invalidates it. Add chunks with `setChunk`.
 * @param {TerrainStore} world @param {number} cx @param {number} cy
 */
export function getChunk(world, cx, cy) {
  if (
    cacheChunks[LAST] === world.chunks && cacheX[LAST] === cx &&
    cacheY[LAST] === cy && cacheGeneration[LAST] === generation
  ) return cacheData[LAST];
  const slot = ((cx * 7) ^ cy) & (CACHE_SIZE - 1);
  let data;
  if (
    cacheChunks[slot] === world.chunks && cacheX[slot] === cx &&
    cacheY[slot] === cy && cacheGeneration[slot] === generation
  ) {
    data = cacheData[slot];
  } else {
    data = world.chunks.get(chunkKey(cx, cy)) ?? null;
    remember(slot, world.chunks, cx, cy, data);
  }
  remember(LAST, world.chunks, cx, cy, data);
  return data;
}

/** @param {TerrainStore} world @param {number} cx @param {number} cy */
export function hasChunk(world, cx, cy) {
  return getChunk(world, cx, cy) !== null;
}

/** Store chunk data under its coordinates. */
/** @param {TerrainStore} world @param {number} cx @param {number} cy @param {ChunkData} data */
export function setChunk(world, cx, cy, data) {
  if (data.length !== CHUNK_CELLS) {
    throw new RangeError("chunk data has the wrong size");
  }
  world.chunks.set(chunkKey(cx, cy), data);
  generation++;
}

/**
 * Return the chunk, creating it when missing. The `world.generateChunk` hook
 * makes the new chunk; without it the chunk is solid stone, as it already read.
 * @param {TerrainStore} world @param {number} cx @param {number} cy
 */
export function ensureChunk(world, cx, cy) {
  const existing = getChunk(world, cx, cy);
  if (existing) return existing;
  if (Math.abs(cx) > MAX_CHUNK_COORD || Math.abs(cy) > MAX_CHUNK_COORD) {
    throw new RangeError("chunk is too far from the origin");
  }
  const data = world.generateChunk?.(cx, cy) ?? createChunkData();
  const diff = world.edits?.get(chunkKey(cx, cy));
  if (diff) { for (const [index, material] of diff) data[index] = material; }
  setChunk(world, cx, cy, data);
  return data;
}

/**
 * Pin every chunk that exists now, so it never unloads (ADR 0005). The host
 * calls this once before play, after the authored terrain is built.
 * @param {TerrainStore} world
 */
export function pinLoadedChunks(world) {
  world.pinned = new Set(world.chunks.keys());
  for (const key of world.pinned) world.edits?.delete(key);
}

/**
 * Drop a loaded chunk's tiles. It reads as stone until `ensureChunk` brings it
 * back from the generator and its edit diff. Pinned chunks stay, and so does
 * every chunk of a world that cannot regenerate.
 * @param {TerrainStore} world @param {number} cx @param {number} cy
 */
export function unloadChunk(world, cx, cy) {
  const key = chunkKey(cx, cy);
  if (!world.generateChunk || world.pinned?.has(key)) return false;
  if (!world.chunks.delete(key)) return false;
  generation++;
  return true;
}

/**
 * Read the material at a tile. A level below 0 reads as stone. A level above the
 * top reads as open air in an existing chunk. A missing chunk reads as stone.
 * @param {TerrainStore} world @param {number} x @param {number} y @param {number} z
 */
export function readTile(world, x, y, z) {
  const chunk = getChunk(world, chunkCoord(x), chunkCoord(y));
  if (!chunk) return STONE;
  if (z < 0) return STONE;
  if (z > WORLD_TOP) return OPEN;
  return chunk[chunkIndex(localCoord(x), localCoord(y), z)];
}

/**
 * Write one tile material on the host. A missing chunk is created first. A
 * changed tile is queued for `drainTileChanges`.
 * @param {TerrainStore} world @param {number} x @param {number} y @param {number} z @param {number} material
 */
export function writeTile(world, x, y, z, material) {
  if (
    !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z) ||
    z < 0 || z > WORLD_TOP
  ) throw new RangeError("tile is outside the world levels");
  if (!Number.isInteger(material) || material < 0 || material > 255) {
    throw new RangeError("invalid material");
  }
  const chunk = ensureChunk(world, chunkCoord(x), chunkCoord(y));
  const index = chunkIndex(localCoord(x), localCoord(y), z);
  if (chunk[index] === material) return false;
  chunk[index] = material;
  const key = chunkKey(chunkCoord(x), chunkCoord(y));
  // Only in-play edits to a chunk that can unload need a diff.
  if (world.generateChunk && !world.pinned?.has(key)) {
    world.edits ??= new Map();
    let diff = world.edits.get(key);
    if (!diff) world.edits.set(key, diff = new Map());
    diff.set(index, material);
  }
  world.changes ??= new Map();
  world.changes.set(`${x},${y},${z}`, { x, y, z, material });
  return true;
}

/**
 * Return the tiles written since the last call, newest material per tile, and
 * clear the queue. The host sends them to peers.
 * @param {TerrainStore} world @returns {TileChange[]}
 */
export function drainTileChanges(world) {
  const changes = [...(world.changes?.values() ?? [])];
  world.changes?.clear();
  return changes;
}

/** Tile extent of the loaded chunks; `max` values are exclusive. Defaults to one chunk. */
/** @param {TerrainStore} world */
export function terrainExtent(world) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const key of world.chunks.keys()) {
    const parsed = parseChunkKey(key);
    if (!parsed) continue;
    minX = Math.min(minX, parsed.cx * CHUNK_EDGE);
    minY = Math.min(minY, parsed.cy * CHUNK_EDGE);
    maxX = Math.max(maxX, (parsed.cx + 1) * CHUNK_EDGE);
    maxY = Math.max(maxY, (parsed.cy + 1) * CHUNK_EDGE);
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 16, maxY: 16 };
  return { minX, minY, maxX, maxY };
}

/** True when the tile or one of its eight neighbors lies in a loaded chunk. Stone one tile beyond loaded terrain can be seen. */
/** @param {TerrainStore} world @param {number} x @param {number} y */
export function nearLoadedTerrain(world, x, y) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (hasChunk(world, chunkCoord(x + dx), chunkCoord(y + dy))) return true;
    }
  }
  return false;
}
