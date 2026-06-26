/// <reference lib="dom" />

import {
  CHUNK_EDGE_TILES,
  TILE_SIZE_PX,
} from "../../../lib/webgl-chunk-gen.ts";
import type { FrameContext } from "../frame-context.ts";
import { flushInstanceBatch } from "../instance-batch.ts";
import { getTopmostOffsetsCache } from "../caches/topmost.ts";
import type { Pass } from "../gpu-types.ts";

const EDGE_SEGMENT_DARK_ALPHA = 0.28;
const EDGE_SEGMENT_LIGHT_ALPHA = 0.11;
const EDGE_SEGMENT_BAND_PX = 4;
const EDGE_SHADOW_STRIDE_FLOATS = 5;

function writeEdgeShadowInstance(
  scratch: Float32Array,
  index: number,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha: number,
) {
  const off = index * EDGE_SHADOW_STRIDE_FLOATS;
  scratch[off + 0] = x;
  scratch[off + 1] = y;
  scratch[off + 2] = w;
  scratch[off + 3] = h;
  scratch[off + 4] = alpha;
}

export const EdgeShadowPass: Pass<FrameContext> = {
  name: "edge-shadow",
  program: "edgeShadow",
  state: { blend: "alpha" },
  enabled: (ctx) => ctx.policy.layers.edgeShadow,
  draw(ctx) {
    const gl = ctx.gl;
    const stats = ctx.batchStats;
    const scratch = ctx.scratch;
    const topmostOffsets = getTopmostOffsetsCache();
    let count = 0;

    const flush = () => {
      flushInstanceBatch(
        gl,
        ctx.instanceBuffer,
        scratch,
        count,
        EDGE_SHADOW_STRIDE_FLOATS,
        stats,
      );
      count = 0;
    };

    const emit = (
      x: number,
      y: number,
      w: number,
      h: number,
      alpha: number,
    ) => {
      if (count >= ctx.maxInstances) {
        flush();
      }
      writeEdgeShadowInstance(scratch, count, x, y, w, h, alpha);
      count++;
    };

    const getTopmostOffset = (
      chunkX: number,
      chunkY: number,
      tx: number,
      ty: number,
    ): number => {
      const cx = chunkX + Math.floor(tx / CHUNK_EDGE_TILES);
      const cy = chunkY + Math.floor(ty / CHUNK_EDGE_TILES);
      const lx = ((tx % CHUNK_EDGE_TILES) + CHUNK_EDGE_TILES) %
        CHUNK_EDGE_TILES;
      const ly = ((ty % CHUNK_EDGE_TILES) + CHUNK_EDGE_TILES) %
        CHUNK_EDGE_TILES;
      const offsets = topmostOffsets.get(`${cx},${cy},${ctx.frame.viewZ}`);
      return offsets ? offsets[ly * CHUNK_EDGE_TILES + lx] : 127;
    };

    const addVerticalShadow = (
      edgeX: number,
      topY: number,
      lowerIsRight: boolean,
    ) => {
      const darkX = lowerIsRight ? edgeX : edgeX - EDGE_SEGMENT_BAND_PX;
      const lightX = lowerIsRight
        ? edgeX + EDGE_SEGMENT_BAND_PX
        : edgeX - EDGE_SEGMENT_BAND_PX * 2;
      emit(
        darkX,
        topY,
        EDGE_SEGMENT_BAND_PX,
        TILE_SIZE_PX,
        EDGE_SEGMENT_DARK_ALPHA,
      );
      emit(
        lightX,
        topY,
        EDGE_SEGMENT_BAND_PX,
        TILE_SIZE_PX,
        EDGE_SEGMENT_LIGHT_ALPHA,
      );
    };

    const addHorizontalShadow = (
      leftX: number,
      edgeY: number,
      lowerIsDown: boolean,
    ) => {
      const darkY = lowerIsDown ? edgeY : edgeY - EDGE_SEGMENT_BAND_PX;
      const lightY = lowerIsDown
        ? edgeY + EDGE_SEGMENT_BAND_PX
        : edgeY - EDGE_SEGMENT_BAND_PX * 2;
      emit(
        leftX,
        darkY,
        TILE_SIZE_PX,
        EDGE_SEGMENT_BAND_PX,
        EDGE_SEGMENT_DARK_ALPHA,
      );
      emit(
        leftX,
        lightY,
        TILE_SIZE_PX,
        EDGE_SEGMENT_BAND_PX,
        EDGE_SEGMENT_LIGHT_ALPHA,
      );
    };

    for (const vis of ctx.frame.visibleChunkKeys) {
      const baseX = vis.chunkX * CHUNK_EDGE_TILES;
      const baseY = vis.chunkY * CHUNK_EDGE_TILES;
      for (let ty = 0; ty < CHUNK_EDGE_TILES; ty++) {
        for (let tx = 0; tx < CHUNK_EDGE_TILES; tx++) {
          const here = getTopmostOffset(vis.chunkX, vis.chunkY, tx, ty);
          if (here === 127) {
            continue;
          }
          const right = getTopmostOffset(vis.chunkX, vis.chunkY, tx + 1, ty);
          if (right !== here) {
            addVerticalShadow(
              (baseX + tx + 1) * TILE_SIZE_PX,
              (baseY + ty) * TILE_SIZE_PX,
              right === 127 || right < here,
            );
          }
          const down = getTopmostOffset(vis.chunkX, vis.chunkY, tx, ty + 1);
          if (down !== here) {
            addHorizontalShadow(
              (baseX + tx) * TILE_SIZE_PX,
              (baseY + ty + 1) * TILE_SIZE_PX,
              down === 127 || down < here,
            );
          }
        }
      }
    }

    flush();
  },
};
