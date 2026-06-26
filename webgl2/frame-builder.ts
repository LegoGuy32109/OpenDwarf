/// <reference lib="dom" />

import { TILE_SIZE_PX } from "../lib/webgl-chunk-gen.ts";
import {
  createWorldSim,
  entityRenderPosition,
  type WorldSimState,
} from "../lib/webgl-world-sim.ts";
import {
  rebuildTopmostCache,
  syncFloorAndSolidCaches,
} from "./caches/topmost.ts";
import { syncFovCache } from "./caches/fov.ts";
import { updateVisibleRegion } from "./caches/visible-region.ts";
import type { FrameContext } from "./frame-context.ts";
import type { Programs } from "./gpu-types.ts";

export type FrameBuilderInput = {
  gl: WebGL2RenderingContext;
  programs: Programs;
  scratch: Float32Array;
  instanceBuffer: WebGLBuffer;
  maxInstances: number;
  batchStats: { drawCalls: number; instances: number };
  canvas: HTMLCanvasElement;
  world: WorldSimState;
  frameNumber: number;
  dtSeconds: number;
  simTick: number;
  viewMode: "entity" | "free";
};

export function createFrameBuilderWorld(seed = "rocks-aabb-v1") {
  return createWorldSim(seed);
}

export function buildFrameContext(input: FrameBuilderInput): FrameContext {
  const { canvas, world, frameNumber, dtSeconds, simTick, viewMode } = input;
  const [entityX, entityY] = entityRenderPosition(world.entity);
  const camera = {
    x: (entityX + 0.5) * TILE_SIZE_PX,
    y: (entityY + 0.5) * TILE_SIZE_PX,
    zoom: 1,
  };
  const viewZ = world.entity.position.z;
  const viewport = {
    cssWidth: canvas.clientWidth,
    cssHeight: canvas.clientHeight,
    dpr: globalThis.devicePixelRatio || 1,
    fbWidth: canvas.width,
    fbHeight: canvas.height,
  };
  const region = updateVisibleRegion(camera, {
    fbWidth: canvas.width,
    fbHeight: canvas.height,
  }, viewZ);
  syncFloorAndSolidCaches(world.seed, region.streamingChunkKeys, viewZ);
  syncFovCache(world, viewMode);
  rebuildTopmostCache(region.visibleChunkKeys, viewZ);

  return {
    gl: input.gl,
    programs: input.programs,
    scratch: input.scratch,
    instanceBuffer: input.instanceBuffer,
    maxInstances: input.maxInstances,
    batchStats: input.batchStats,
    frame: {
      camera,
      viewport,
      viewZ,
      dtSeconds,
      simTick,
      frameNumber,
      visibleTileBounds: region.visibleTileBounds,
      visibleChunkKeys: region.visibleChunkKeys,
      world,
    },
    policy: {
      viewMode,
      layers: {
        floor: true,
        edgeShadow: true,
        ceilShadow: true,
        depthTint: true,
      },
    },
  };
}
