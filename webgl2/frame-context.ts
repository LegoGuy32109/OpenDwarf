/// <reference lib="dom" />

import type { ChunkKey } from "../lib/webgl-chunk-gen.ts";
import type { WorldSimState } from "../lib/webgl-world-sim.ts";
import type { Programs } from "./gpu-types.ts";

export type FrameContext = {
  gl: WebGL2RenderingContext;
  programs: Programs;
  scratch: Float32Array;
  instanceBuffer: WebGLBuffer;
  maxInstances: number;
  batchStats: { drawCalls: number; instances: number };
  frame: {
    camera: { x: number; y: number; zoom: number };
    viewport: {
      cssWidth: number;
      cssHeight: number;
      dpr: number;
      fbWidth: number;
      fbHeight: number;
    };
    viewZ: number;
    dtSeconds: number;
    simTick: number;
    frameNumber: number;
    visibleTileBounds: {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    };
    visibleChunkKeys: ChunkKey[];
    world: Readonly<WorldSimState>;
  };
  policy: {
    viewMode: "entity" | "free";
    layers: {
      floor: boolean;
      edgeShadow: boolean;
      ceilShadow: boolean;
      depthTint: boolean;
    };
  };
};
