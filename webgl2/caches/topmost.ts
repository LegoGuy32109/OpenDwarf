import {
  CHUNK_EDGE_TILES,
  type ChunkKey,
  chunkKeyString,
  tileKeyString,
  updateFloorCache,
  updateSolidCache,
  Z_LEVELS_BELOW,
} from "../../lib/webgl-chunk-gen.ts";
import type { WorldSimState } from "../../lib/webgl-world-sim.ts";
import type { WebGl2ViewMode } from "../game-state.ts";

const floorCache = new Map<string, Uint16Array>();
const solidCache = new Map<string, Uint8Array>();
let topmostOffsetsCache = new Map<string, Int8Array>();

function expandShadowChunkKeys(visibleChunkKeys: ChunkKey[]): ChunkKey[] {
  const next = new Map<string, ChunkKey>();
  for (const vis of visibleChunkKeys) {
    for (const dx of [0, 1]) {
      for (const dy of [0, 1]) {
        const chunkX = vis.chunkX + dx;
        const chunkY = vis.chunkY + dy;
        next.set(
          `${chunkX},${chunkY},${vis.chunkZ}`,
          { chunkX, chunkY, chunkZ: vis.chunkZ },
        );
      }
    }
  }
  return [...next.values()];
}

function localTileSolidAt(
  tileX: number,
  tileY: number,
  tileZ: number,
): boolean {
  const chunkX = Math.floor(tileX / CHUNK_EDGE_TILES);
  const chunkY = Math.floor(tileY / CHUNK_EDGE_TILES);
  const chunk = solidCache.get(
    chunkKeyString({ chunkX, chunkY, chunkZ: tileZ }),
  );
  if (!chunk) {
    return true;
  }
  const localX = tileX - chunkX * CHUNK_EDGE_TILES;
  const localY = tileY - chunkY * CHUNK_EDGE_TILES;
  return chunk[localY * CHUNK_EDGE_TILES + localX] === 1;
}

function renderTileSolidAt(
  tileX: number,
  tileY: number,
  tileZ: number,
  world: Readonly<WorldSimState>,
  viewMode: WebGl2ViewMode,
): boolean {
  if (viewMode !== "entity") {
    return localTileSolidAt(tileX, tileY, tileZ);
  }

  const key = tileKeyString({ tileX, tileY, tileZ });
  if (world.visible.has(key)) {
    return localTileSolidAt(tileX, tileY, tileZ);
  }
  return world.memory.get(key)?.block === "solid";
}

export function syncFloorAndSolidCaches(
  seed: string,
  streamingXYKeys: ChunkKey[],
  viewZ: number,
): boolean {
  const floorChanged = updateFloorCache(
    floorCache,
    seed,
    streamingXYKeys,
    viewZ,
  );
  const solidChanged = updateSolidCache(
    solidCache,
    seed,
    streamingXYKeys,
    viewZ,
  );
  return floorChanged || solidChanged;
}

export function syncFloorCache(
  seed: string,
  streamingXYKeys: ChunkKey[],
  viewZ: number,
): boolean {
  return updateFloorCache(floorCache, seed, streamingXYKeys, viewZ);
}

export function rebuildTopmostCache(
  visibleChunkKeys: ChunkKey[],
  viewZ: number,
  world: Readonly<WorldSimState>,
  viewMode: WebGl2ViewMode,
) {
  const next = new Map<string, Int8Array>();
  for (const vis of expandShadowChunkKeys(visibleChunkKeys)) {
    const chunkKey = chunkKeyString(vis);
    const tmo = new Int8Array(CHUNK_EDGE_TILES * CHUNK_EDGE_TILES).fill(127);
    for (let ty = 0; ty < CHUNK_EDGE_TILES; ty++) {
      for (let tx = 0; tx < CHUNK_EDGE_TILES; tx++) {
        const idx = ty * CHUNK_EDGE_TILES + tx;
        for (let zo = 0; zo >= -Z_LEVELS_BELOW; zo--) {
          const tileX = vis.chunkX * CHUNK_EDGE_TILES + tx;
          const tileY = vis.chunkY * CHUNK_EDGE_TILES + ty;
          if (renderTileSolidAt(tileX, tileY, viewZ + zo, world, viewMode)) {
            tmo[idx] = zo;
            break;
          }
        }
      }
    }
    next.set(chunkKey, tmo);
  }
  topmostOffsetsCache = next;
}

export function getFloorCache() {
  return floorCache;
}

export function getTopmostOffsetsCache() {
  return topmostOffsetsCache;
}

export function getSolidCache() {
  return solidCache;
}
