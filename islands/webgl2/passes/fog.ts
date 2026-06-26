/// <reference lib="dom" />

import {
  CHUNK_EDGE_TILES,
  TILE_SIZE_PX,
} from "../../../lib/webgl-chunk-gen.ts";
import type { FrameContext } from "../frame-context.ts";
import { flushInstanceBatch } from "../instance-batch.ts";
import { getTileVisibilityState } from "../caches/fov.ts";
import type { Pass } from "../gpu-types.ts";

const FOG_STRIDE_FLOATS = 3;
const REMEMBERED_FOG_ALPHA = 0.34;
const UNSEEN_FOG_ALPHA = 0.72;

function writeFogInstance(
  scratch: Float32Array,
  index: number,
  x: number,
  y: number,
  alpha: number,
) {
  const off = index * FOG_STRIDE_FLOATS;
  scratch[off + 0] = x;
  scratch[off + 1] = y;
  scratch[off + 2] = alpha;
}

export const FogPass: Pass<FrameContext> = {
  name: "fog",
  program: "fog",
  state: { blend: "alpha" },
  enabled: (ctx) => ctx.policy.viewMode === "entity",
  draw(ctx) {
    const gl = ctx.gl;
    const stats = ctx.batchStats;
    const scratch = ctx.scratch;
    const { world, visibleChunkKeys, viewZ } = ctx.frame;
    let count = 0;

    const flush = () => {
      flushInstanceBatch(
        gl,
        ctx.instanceBuffer,
        scratch,
        count,
        FOG_STRIDE_FLOATS,
        stats,
      );
      count = 0;
    };

    const emit = (x: number, y: number, alpha: number) => {
      if (count >= ctx.maxInstances) {
        flush();
      }
      writeFogInstance(scratch, count, x, y, alpha);
      count++;
    };

    for (const vis of visibleChunkKeys) {
      const baseX = vis.chunkX * CHUNK_EDGE_TILES;
      const baseY = vis.chunkY * CHUNK_EDGE_TILES;
      for (let ty = 0; ty < CHUNK_EDGE_TILES; ty++) {
        for (let tx = 0; tx < CHUNK_EDGE_TILES; tx++) {
          const tileX = baseX + tx;
          const tileY = baseY + ty;
          const state = getTileVisibilityState(world, tileX, tileY, viewZ);
          if (state === "visible") {
            continue;
          }
          emit(
            tileX * TILE_SIZE_PX,
            tileY * TILE_SIZE_PX,
            state === "remembered" ? REMEMBERED_FOG_ALPHA : UNSEEN_FOG_ALPHA,
          );
        }
      }
    }

    flush();
  },
};
