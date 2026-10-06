// @ts-check

import { UNLOAD_GRACE_MS, UNLOAD_RADIUS } from "./generation.js";
import { chunkCoord, chunkKey, parseChunkKey, unloadChunk } from "./terrain.js";

/**
 * Chunk unloading (ADR 0005). The unloader remembers when each loaded chunk
 * last had a player within `radius` chunks. A chunk with none for `graceMs`
 * unloads. The clock is an argument, so tests can pass a fake one.
 * @param {{radius?:number,graceMs?:number}} [options]
 */
export function createChunkUnloader(options = {}) {
  const radius = options.radius ?? UNLOAD_RADIUS;
  const graceMs = options.graceMs ?? UNLOAD_GRACE_MS;
  /** @type {Map<string,number>} chunk key → time a player was last near */
  const lastNear = new Map();
  return {
    /**
     * Count the players as near their chunks, then unload the chunks that have
     * waited out the grace period. A world without a generator unloads nothing.
     * @param {import('./terrain.js').TerrainStore} world
     * @param {{x:number,y:number}[]} tiles every player, master view and NPCs included
     * @param {number} now milliseconds
     * @returns {number} how many chunks unloaded
     */
    update(world, tiles, now) {
      if (!world.generateChunk) return 0;
      for (const tile of tiles) {
        const px = chunkCoord(Math.floor(tile.x));
        const py = chunkCoord(Math.floor(tile.y));
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const key = chunkKey(px + dx, py + dy);
            if (world.chunks.has(key)) lastNear.set(key, now);
          }
        }
      }
      let unloaded = 0;
      for (const key of [...world.chunks.keys()]) {
        if (world.pinned?.has(key)) continue;
        const seen = lastNear.get(key);
        if (seen === undefined) {
          // A chunk first seen here starts its grace period now.
          lastNear.set(key, now);
          continue;
        }
        if (now - seen < graceMs) continue;
        const parsed = parseChunkKey(key);
        if (parsed && unloadChunk(world, parsed.cx, parsed.cy)) unloaded++;
        lastNear.delete(key);
      }
      for (const key of lastNear.keys()) {
        if (!world.chunks.has(key)) lastNear.delete(key);
      }
      return unloaded;
    },
  };
}
