/// <reference lib="dom" />

import {
  CHUNK_EDGE_TILES,
  chunkKeyString,
  chunkOfTile,
} from "../../../lib/webgl-chunk-gen.ts";
import {
  recomputeFov,
  type WorldSimState,
} from "../../../lib/webgl-world-sim.ts";
import { getSolidCache } from "./topmost.ts";

export type ViewMode = "entity" | "free";
export type TileVisibilityState = "visible" | "remembered" | "unseen";

const visibleTiles = new Set<string>();
const rememberedTiles = new Set<string>();

function tileKey(x: number, y: number, z: number) {
  return `${x},${y},${z}`;
}

function syncSnapshot(world: WorldSimState) {
  visibleTiles.clear();
  rememberedTiles.clear();
  for (const key of world.visible) {
    visibleTiles.add(key);
  }
  for (const key of world.memory.keys()) {
    rememberedTiles.add(key);
  }
}

function clearVisible(world: WorldSimState) {
  if (world.visible.size > 0) {
    world.visible = new Set();
  }
}

export function syncFovCache(world: WorldSimState, viewMode: ViewMode) {
  if (viewMode === "entity") {
    const solidCache = getSolidCache();
    recomputeFov(world, (x, y, z) => {
      const { chunkX, chunkY } = chunkOfTile(x, y);
      const chunk = solidCache.get(
        chunkKeyString({ chunkX, chunkY, chunkZ: z }),
      );
      if (!chunk) return undefined;
      const localX = ((x % CHUNK_EDGE_TILES) + CHUNK_EDGE_TILES) %
        CHUNK_EDGE_TILES;
      const localY = ((y % CHUNK_EDGE_TILES) + CHUNK_EDGE_TILES) %
        CHUNK_EDGE_TILES;
      return chunk[localY * CHUNK_EDGE_TILES + localX] === 1;
    });
  } else {
    clearVisible(world);
  }
  syncSnapshot(world);
}

export function getTileVisibilityState(
  world: Readonly<WorldSimState>,
  x: number,
  y: number,
  z: number,
): TileVisibilityState {
  const key = tileKey(x, y, z);
  if (visibleTiles.has(key) || world.visible.has(key)) {
    return "visible";
  }
  if (rememberedTiles.has(key) || world.memory.has(key)) {
    return "remembered";
  }
  return "unseen";
}

export function isTileVisible(
  world: Readonly<WorldSimState>,
  x: number,
  y: number,
  z: number,
) {
  return getTileVisibilityState(world, x, y, z) === "visible";
}

export function isTileRemembered(
  world: Readonly<WorldSimState>,
  x: number,
  y: number,
  z: number,
) {
  return getTileVisibilityState(world, x, y, z) === "remembered";
}

export function getVisibleTileCount() {
  return visibleTiles.size;
}

export function getRememberedTileCount() {
  return rememberedTiles.size;
}

export function getVisibilityStateSummary() {
  return {
    visible: visibleTiles.size,
    remembered: rememberedTiles.size,
  };
}
