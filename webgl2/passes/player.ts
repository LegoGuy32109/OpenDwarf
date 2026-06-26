/// <reference lib="dom" />

import {
  CHUNK_EDGE_TILES,
  chunkKeyString,
  chunkOfTile,
  TILE_SIZE_PX,
  Z_LEVELS_BELOW,
} from "../../lib/webgl-chunk-gen.ts";
import {
  entityRenderPosition,
  type EntityState,
} from "../../lib/webgl-world-sim.ts";
import { isTileVisible } from "../caches/fov.ts";
import { getSolidCache } from "../caches/topmost.ts";
import type { FrameContext } from "../frame-context.ts";
import { flushInstanceBatch } from "../instance-batch.ts";
import type { Pass } from "../gpu-types.ts";

const PLAYER_STRIDE_FLOATS = 12;
const PLAYER_SMOOTHING_RATE = 10;

const DEPTH_TINTS: [number, number, number][] = [
  [1, 1, 1],
  [0.75, 0.75, 0.75],
  [0.65, 0.65, 0.8],
  [0.43, 0.45, 0.61],
  [0.32, 0.34, 0.61],
  [0.2, 0.2, 0.4],
];

let smoothPlayerWorldPos: [number, number] | null = null;

function writePlayerInstance(
  scratch: Float32Array,
  entity: EntityState,
  index: number,
  x: number,
  y: number,
  tint: [number, number, number],
) {
  const off = index * PLAYER_STRIDE_FLOATS;
  const facingLeft = entity.facingLeft;
  scratch[off + 0] = x;
  scratch[off + 1] = y;
  scratch[off + 2] = TILE_SIZE_PX;
  scratch[off + 3] = TILE_SIZE_PX;
  scratch[off + 4] = facingLeft ? 1 : 0;
  scratch[off + 5] = 0;
  scratch[off + 6] = facingLeft ? -1 : 1;
  scratch[off + 7] = 1;
  scratch[off + 8] = tint[0];
  scratch[off + 9] = tint[1];
  scratch[off + 10] = tint[2];
  scratch[off + 11] = 1;
}

function tileSolidAt(
  solidCache: ReadonlyMap<string, Uint8Array>,
  tileX: number,
  tileY: number,
  tileZ: number,
): boolean {
  const { chunkX, chunkY } = chunkOfTile(tileX, tileY);
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

function isPlayerOccluded(
  solidCache: ReadonlyMap<string, Uint8Array>,
  player: EntityState["position"],
  viewZ: number,
): boolean {
  if (player.z === viewZ) {
    return false;
  }
  const lo = player.z < viewZ ? player.z + 1 : viewZ + 1;
  const hi = player.z < viewZ ? viewZ : player.z;
  for (let checkZ = lo; checkZ <= hi; checkZ++) {
    if (tileSolidAt(solidCache, player.x, player.y, checkZ)) {
      return true;
    }
  }
  return false;
}

export function resetPlayerRenderState() {
  smoothPlayerWorldPos = null;
}

export const PlayerPass: Pass<FrameContext> = {
  name: "player",
  program: "sprite",
  state: { blend: "alpha" },
  enabled: (ctx) =>
    ctx.frame.world.entity.position.z >= ctx.frame.viewZ - Z_LEVELS_BELOW,
  prepare(ctx) {
    const [targetX, targetY] = entityRenderPosition(ctx.frame.world.entity);
    if (!smoothPlayerWorldPos) {
      smoothPlayerWorldPos = [targetX, targetY];
      return;
    }

    const rate = 1 - Math.exp(-PLAYER_SMOOTHING_RATE * ctx.frame.dtSeconds);
    smoothPlayerWorldPos[0] += (targetX - smoothPlayerWorldPos[0]) * rate;
    smoothPlayerWorldPos[1] += (targetY - smoothPlayerWorldPos[1]) * rate;
  },
  draw(ctx) {
    const world = ctx.frame.world;
    const player = world.entity.position;
    const zOffset = player.z - ctx.frame.viewZ;
    const solidCache = getSolidCache();
    const visibleToEntity = ctx.policy.viewMode !== "entity" ||
      isTileVisible(world, player.x, player.y, player.z);
    if (
      !visibleToEntity ||
      isPlayerOccluded(solidCache, player, ctx.frame.viewZ)
    ) {
      return;
    }

    const tint: [number, number, number] = ctx.policy.layers.depthTint &&
        zOffset < 0
      ? DEPTH_TINTS[Math.min(-zOffset, DEPTH_TINTS.length - 1)]
      : [1, 1, 1];

    const [x, y] = smoothPlayerWorldPos ?? entityRenderPosition(world.entity);
    const gl = ctx.gl;
    const scratch = ctx.scratch;

    writePlayerInstance(
      scratch,
      world.entity,
      0,
      x * TILE_SIZE_PX,
      y * TILE_SIZE_PX,
      tint,
    );
    flushInstanceBatch(
      gl,
      ctx.instanceBuffer,
      scratch,
      1,
      PLAYER_STRIDE_FLOATS,
      ctx.batchStats,
    );
  },
};
