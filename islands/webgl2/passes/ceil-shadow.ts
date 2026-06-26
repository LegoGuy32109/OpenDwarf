/// <reference lib="dom" />

import {
  CHUNK_EDGE_TILES,
  computeCeilingShadowIds,
  TILE_SIZE_PX,
} from "../../../lib/webgl-chunk-gen.ts";
import type { FrameContext } from "../frame-context.ts";
import { flushInstanceBatch } from "../instance-batch.ts";
import { getSolidCache } from "../caches/topmost.ts";
import type { Pass } from "../gpu-types.ts";

const SHADOW_ALPHA_MULTIPLIER = 0.55;
const CEIL_SHADOW_STRIDE_FLOATS = 4;

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
      const ceilIds = computeCeilingShadowIds(
        vis.chunkX,
        vis.chunkY,
        ctx.frame.viewZ,
        solidCache,
      );
      const baseX = vis.chunkX * CHUNK_EDGE_TILES;
      const baseY = vis.chunkY * CHUNK_EDGE_TILES;
      for (let ty = 0; ty < CHUNK_EDGE_TILES; ty++) {
        for (let tx = 0; tx < CHUNK_EDGE_TILES; tx++) {
          const frameId = ceilIds[ty * CHUNK_EDGE_TILES + tx];
          if (frameId === 0) {
            continue;
          }
          emit(
            (baseX + tx) * TILE_SIZE_PX,
            (baseY + ty) * TILE_SIZE_PX,
            frameId - 1,
            SHADOW_ALPHA_MULTIPLIER,
          );
        }
      }
    }

    flush();
  },
};
