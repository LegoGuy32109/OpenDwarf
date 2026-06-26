/// <reference lib="dom" />

import { CHUNK_EDGE_TILES, TILE_SIZE_PX } from "../../lib/webgl-chunk-gen.ts";
import { Z_LEVELS_BELOW } from "../../lib/webgl-chunk-gen.ts";
import type { FrameContext } from "../frame-context.ts";
import { flushInstanceBatch } from "../instance-batch.ts";
import { getFloorCache, getTopmostOffsetsCache } from "../caches/topmost.ts";
import { getTileVisibilityState } from "../caches/fov.ts";
import type { Pass } from "../gpu-types.ts";

const DEPTH_TINTS: [number, number, number][] = [
  [1, 1, 1],
  [0.75, 0.75, 0.75],
  [0.65, 0.65, 0.8],
  [0.43, 0.45, 0.61],
  [0.32, 0.34, 0.61],
  [0.2, 0.2, 0.4],
];

const REMEMBERED_TINT: [number, number, number] = [1.0, 0.86, 0.34];
const WEBGL_PARITY_FLOOR_FRAME = 5;

const FLOOR_STRIDE_FLOATS = 7;

function writeFloorInstance(
  scratch: Float32Array,
  index: number,
  x: number,
  y: number,
  frame: number,
  tint: [number, number, number],
  alpha: number,
) {
  const off = index * FLOOR_STRIDE_FLOATS;
  scratch[off + 0] = x;
  scratch[off + 1] = y;
  scratch[off + 2] = frame;
  scratch[off + 3] = tint[0];
  scratch[off + 4] = tint[1];
  scratch[off + 5] = tint[2];
  scratch[off + 6] = alpha;
}

export const FloorPass: Pass<FrameContext> = {
  name: "floor",
  program: "floor",
  state: { blend: "off" },
  enabled: (ctx) => ctx.policy.layers.floor,
  draw(ctx) {
    const gl = ctx.gl;
    const floorCache = getFloorCache();
    const topmostOffsets = getTopmostOffsetsCache();
    const { viewZ, visibleChunkKeys, world } = ctx.frame;
    const depthTint = ctx.policy.layers.depthTint;
    const entityMode = ctx.policy.viewMode === "entity";
    const stats = ctx.batchStats;
    const scratch = ctx.scratch;
    let count = 0;

    const flush = () => {
      flushInstanceBatch(
        gl,
        ctx.instanceBuffer,
        scratch,
        count,
        FLOOR_STRIDE_FLOATS,
        stats,
      );
      count = 0;
    };

    const emit = (
      x: number,
      y: number,
      frame: number,
      tint: [number, number, number],
      alpha: number,
    ) => {
      if (count >= ctx.maxInstances) {
        flush();
      }
      writeFloorInstance(scratch, count, x, y, frame, tint, alpha);
      count++;
    };

    const zMin = viewZ - Z_LEVELS_BELOW;
    for (let z = zMin; z <= viewZ; z++) {
      const zOffset = z - viewZ;
      for (const vis of visibleChunkKeys) {
        const topmost = topmostOffsets.get(
          `${vis.chunkX},${vis.chunkY},${viewZ}`,
        );
        if (!topmost) {
          continue;
        }
        const floorChunk = floorCache.get(
          `${vis.chunkX},${vis.chunkY},${z}`,
        );
        if (!floorChunk) {
          continue;
        }
        const baseX = vis.chunkX * CHUNK_EDGE_TILES;
        const baseY = vis.chunkY * CHUNK_EDGE_TILES;
        for (let ty = 0; ty < CHUNK_EDGE_TILES; ty++) {
          for (let tx = 0; tx < CHUNK_EDGE_TILES; tx++) {
            const idx = ty * CHUNK_EDGE_TILES + tx;
            if (topmost[idx] !== zOffset) {
              continue;
            }
            const tileX = baseX + tx;
            const tileY = baseY + ty;
            const visibility = entityMode
              ? getTileVisibilityState(world, tileX, tileY, z)
              : "visible";
            if (visibility === "unseen") {
              continue;
            }
            const tint = visibility === "remembered"
              ? REMEMBERED_TINT
              : depthTint
              ? DEPTH_TINTS[Math.min(-zOffset, DEPTH_TINTS.length - 1)]
              : ([1, 1, 1] as [number, number, number]);
            emit(
              tileX * TILE_SIZE_PX,
              tileY * TILE_SIZE_PX,
              WEBGL_PARITY_FLOOR_FRAME,
              tint,
              visibility === "remembered" ? 0.95 : 1,
            );
          }
        }
      }
    }

    flush();
  },
};
