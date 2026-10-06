// @ts-check

/**
 * Pending reveal (ADR 0005). The world host keeps, for each joining player, the
 * terrain that player remembers and the tiles that entered it or changed in it
 * since the last state packet. A state packet drains them as `reveal`, so the
 * guest receives a change once instead of its whole remembered terrain on every
 * packet.
 */

import {
  CHUNK_CELLS,
  chunkCoord,
  chunkIndex,
  chunkKey,
  getChunk,
  localCoord,
  parseChunkKey,
  setChunk,
  UNKNOWN,
} from "./terrain.js";
import { encodeChunk, MAX_REVEAL_CHUNKS } from "./chunk-wire.js";
import { UNLOAD_RADIUS } from "./generation.js";
import { tileKey } from "./visibility.js";

/** @typedef {import('./terrain.js').ChunkData} ChunkData */
/** @typedef {import('./terrain.js').TerrainStore} TerrainStore */
/** Chunk key to the tile indices to send, or `true` for every tile the chunk holds. */
/** @typedef {Map<string,Set<number>|true>} PendingReveal */

/** @returns {PendingReveal} */
export function createPendingReveal() {
  return new Map();
}

/** @param {PendingReveal} pending @param {string} key @param {number} index */
export function markPending(pending, key, index) {
  const marked = pending.get(key);
  if (marked === true) return;
  if (marked) marked.add(index);
  else pending.set(key, new Set([index]));
}

/** Send every tile of the remembered terrain again, as a rejoin or view change needs. */
/** @param {PendingReveal} pending @param {Map<string,ChunkData>} remembered */
export function markAllPending(pending, remembered) {
  pending.clear();
  for (const key of remembered.keys()) pending.set(key, true);
}

/**
 * Write one changed tile into the remembered terrain and mark it pending when
 * the material differs. `create` adds the chunk when the player has none yet.
 * @param {Map<string,ChunkData>} remembered @param {PendingReveal} pending
 * @param {import('./terrain.js').TileChange} change @param {boolean} create
 */
export function rememberChange(remembered, pending, change, create) {
  const key = chunkKey(chunkCoord(change.x), chunkCoord(change.y));
  let chunk = remembered.get(key);
  if (!chunk) {
    if (!create) return false;
    chunk = new Uint8Array(CHUNK_CELLS).fill(UNKNOWN);
    remembered.set(key, chunk);
  }
  const index = chunkIndex(
    localCoord(change.x),
    localCoord(change.y),
    change.z,
  );
  if (chunk[index] === change.material) return false;
  chunk[index] = change.material;
  markPending(pending, key, index);
  return true;
}

/**
 * Add the changed tiles a guest holds or sees to its pending reveal. An entity
 * view guest takes a change only where its sight holds the tile; a master view
 * guest takes it in a chunk it already holds. Returns whether any tile is new
 * to the guest, so the host knows to publish.
 * @param {{mode:"entity"|"master",sight:import('./visibility.js').Visibility,remembered:Map<string,ChunkData>,master:Map<string,ChunkData>,pending:PendingReveal}} guest
 * @param {import('./terrain.js').TileChange[]} changes
 */
export function revealChanges(guest, changes) {
  let revealed = false;
  for (const change of changes) {
    if (guest.mode === "master") {
      revealed = rememberChange(guest.master, guest.pending, change, false) ||
        revealed;
    } else if (guest.sight.visible.has(tileKey(change.x, change.y, change.z))) {
      revealed =
        rememberChange(guest.remembered, guest.pending, change, true) ||
        revealed;
    }
  }
  return revealed;
}

/**
 * Master view: copy each loaded chunk within `UNLOAD_RADIUS` of the player that
 * the guest does not hold yet. Chunks the host has not loaded are never read.
 * @param {TerrainStore} world @param {Map<string,ChunkData>} copy
 * @param {PendingReveal} pending @param {number} cx @param {number} cy
 */
export function syncLoadedChunks(world, copy, pending, cx, cy) {
  for (let y = cy - UNLOAD_RADIUS; y <= cy + UNLOAD_RADIUS; y++) {
    for (let x = cx - UNLOAD_RADIUS; x <= cx + UNLOAD_RADIUS; x++) {
      const key = chunkKey(x, y);
      if (copy.has(key)) continue;
      const loaded = getChunk(world, x, y);
      if (!loaded) continue;
      copy.set(key, loaded.slice());
      pending.set(key, true);
    }
  }
}

/**
 * Take up to `limit` chunks out of the pending reveal and encode them. Tiles
 * that are not pending stay `UNKNOWN`, which the guest reads as no change. Call
 * it when the packet is built, because the snapshot sender may skip a publish.
 * @param {Map<string,ChunkData>} remembered @param {PendingReveal} pending
 * @param {number} [limit]
 * @returns {Record<string,string>}
 */
export function drainReveal(remembered, pending, limit = MAX_REVEAL_CHUNKS) {
  /** @type {Record<string,string>} */
  const reveal = {};
  let count = 0;
  for (const [key, marked] of pending) {
    if (count >= limit) break;
    pending.delete(key);
    const source = remembered.get(key);
    if (!source) continue;
    if (marked === true) {
      reveal[key] = encodeChunk(source);
    } else {
      const delta = new Uint8Array(CHUNK_CELLS).fill(UNKNOWN);
      for (const index of marked) delta[index] = source[index];
      reveal[key] = encodeChunk(delta);
    }
    count++;
  }
  return reveal;
}

/**
 * Guest: copy each revealed tile whose material is not `UNKNOWN` into the
 * guest's remembered terrain, and add chunks it does not hold yet. The guest
 * keeps that terrain in `world.chunks`.
 * @param {TerrainStore} world @param {Map<string,ChunkData>} reveal
 */
export function applyReveal(world, reveal) {
  for (const [key, delta] of reveal) {
    const parsed = parseChunkKey(key);
    if (!parsed) continue;
    const chunk = world.chunks.get(key);
    if (!chunk) {
      setChunk(world, parsed.cx, parsed.cy, delta);
      continue;
    }
    for (let i = 0; i < CHUNK_CELLS; i++) {
      if (delta[i] !== UNKNOWN) chunk[i] = delta[i];
    }
  }
}
