/// <reference lib="dom" />

import {
  CHUNK_EDGE_TILES,
  chunkKeyString,
  computeCeilingShadowIds,
  shadowMaskToAtlasId,
  TILE_SIZE_PX,
  tileKeyString,
} from "../../lib/webgl-chunk-gen.ts";
import type { FrameContext } from "../frame-context.ts";
import { flushInstanceBatch } from "../instance-batch.ts";
import { getSolidCache, getTopmostOffsetsCache } from "../caches/topmost.ts";
import type { Pass } from "../gpu-types.ts";

const SHADOW_ALPHA_MULTIPLIER = 0.55;
const CEIL_SHADOW_STRIDE_FLOATS = 4;
const CEIL_SHADOW_OFFSET_PX = TILE_SIZE_PX * 0.5;

function writeCeilShadowInstance(
  scratch: Float32Array,
  index: number,
  x: number,
  y: number,
  frame: number,
  alpha: number,
) {
  const off = index * CEIL_SHADOW_STRIDE_FLOATS;
  scratch[off + 0] = x;
  scratch[off + 1] = y;
  scratch[off + 2] = frame;
  scratch[off + 3] = alpha;
}

function localTileSolidAt(
  solidCache: ReadonlyMap<string, Uint8Array>,
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
  ctx: FrameContext,
  solidCache: ReadonlyMap<string, Uint8Array>,
  tileX: number,
  tileY: number,
  tileZ: number,
): boolean {
  if (ctx.policy.viewMode !== "entity") {
    return localTileSolidAt(solidCache, tileX, tileY, tileZ);
  }

  const key = tileKeyString({ tileX, tileY, tileZ });
  if (ctx.frame.world.visible.has(key)) {
    return localTileSolidAt(solidCache, tileX, tileY, tileZ);
  }
  return ctx.frame.world.memory.get(key)?.block === "solid";
}

function topmostOffsetAt(
  topmostOffsets: ReadonlyMap<string, Int8Array>,
  viewZ: number,
  tileX: number,
  tileY: number,
): number {
  const chunkX = Math.floor(tileX / CHUNK_EDGE_TILES);
  const chunkY = Math.floor(tileY / CHUNK_EDGE_TILES);
  const offsets = topmostOffsets.get(
    chunkKeyString({ chunkX, chunkY, chunkZ: viewZ }),
  );
  if (!offsets) {
    return 127;
  }
  const localX = tileX - chunkX * CHUNK_EDGE_TILES;
  const localY = tileY - chunkY * CHUNK_EDGE_TILES;
  return offsets[localY * CHUNK_EDGE_TILES + localX];
}

function entityModeCeilingFrameId(
  ctx: FrameContext,
  solidCache: ReadonlyMap<string, Uint8Array>,
  topmostOffsets: ReadonlyMap<string, Int8Array>,
  tileX: number,
  tileY: number,
): number {
  let mask = 0;
  const checkCorner = (dx: number, dy: number) => {
    const cornerX = tileX + dx;
    const cornerY = tileY + dy;
    const isCurrentTopmost = topmostOffsetAt(
      topmostOffsets,
      ctx.frame.viewZ,
      cornerX,
      cornerY,
    ) === 0;
    return isCurrentTopmost &&
      renderTileSolidAt(
        ctx,
        solidCache,
        cornerX,
        cornerY,
        ctx.frame.viewZ + 1,
      );
  };

  if (checkCorner(0, 0)) mask |= 1;
  if (checkCorner(1, 0)) mask |= 2;
  if (checkCorner(0, 1)) mask |= 4;
  if (checkCorner(1, 1)) mask |= 8;
  return mask === 0 ? 0 : shadowMaskToAtlasId(mask);
}

export const CeilShadowPass: Pass<FrameContext> = {
  name: "ceil-shadow",
  program: "ceilShadow",
  state: { blend: "alpha" },
  enabled: (ctx) => ctx.policy.layers.ceilShadow,
  draw(ctx) {
    const gl = ctx.gl;
    const stats = ctx.batchStats;
    const scratch = ctx.scratch;
    const solidCache = getSolidCache();
    const topmostOffsets = getTopmostOffsetsCache();
    const entityMode = ctx.policy.viewMode === "entity";
    let count = 0;

    const flush = () => {
      flushInstanceBatch(
        gl,
        ctx.instanceBuffer,
        scratch,
        count,
        CEIL_SHADOW_STRIDE_FLOATS,
        stats,
      );
      count = 0;
    };

    const emit = (
      x: number,
      y: number,
      frame: number,
      alpha: number,
    ) => {
      if (count >= ctx.maxInstances) {
        flush();
      }
      writeCeilShadowInstance(scratch, count, x, y, frame, alpha);
      count++;
    };

    for (const vis of ctx.frame.visibleChunkKeys) {
      const ceilIds = entityMode ? null : computeCeilingShadowIds(
        vis.chunkX,
        vis.chunkY,
        ctx.frame.viewZ,
        solidCache,
      );
      const baseX = vis.chunkX * CHUNK_EDGE_TILES;
      const baseY = vis.chunkY * CHUNK_EDGE_TILES;
      for (let ty = 0; ty < CHUNK_EDGE_TILES; ty++) {
        for (let tx = 0; tx < CHUNK_EDGE_TILES; tx++) {
          const tileX = baseX + tx;
          const tileY = baseY + ty;
          const frameId = entityMode
            ? entityModeCeilingFrameId(
              ctx,
              solidCache,
              topmostOffsets,
              tileX,
              tileY,
            )
            : ceilIds![ty * CHUNK_EDGE_TILES + tx];
          if (frameId === 0) {
            continue;
          }
          emit(
            tileX * TILE_SIZE_PX + CEIL_SHADOW_OFFSET_PX,
            tileY * TILE_SIZE_PX + CEIL_SHADOW_OFFSET_PX,
            frameId - 1,
            SHADOW_ALPHA_MULTIPLIER,
          );
        }
      }
    }

    flush();
  },
};
