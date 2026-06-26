/// <reference lib="dom" />

import { chunkKeyString } from "../lib/webgl-chunk-gen.ts";
import type { WorldSimState } from "../lib/webgl-world-sim.ts";
import { rebuildTopmostCache } from "./caches/topmost.ts";
import { syncFovCache } from "./caches/fov.ts";
import { updateVisibleRegion } from "./caches/visible-region.ts";
import type { FrameContext } from "./frame-context.ts";
import type { Programs } from "./gpu-types.ts";
import type { WebGl2GameState } from "./game-state.ts";

export type FrameBuilderInput = {
  state: WebGl2GameState;
  gl: WebGL2RenderingContext;
  programs: Programs;
  scratch: Float32Array;
  instanceBuffer: WebGLBuffer;
  maxInstances: number;
  batchStats: { drawCalls: number; instances: number };
  canvas: HTMLCanvasElement;
  uiFontAtlas: FrameContext["ui"]["fontAtlas"];
  dtSeconds: number;
};

export function buildFrameContext(input: FrameBuilderInput): FrameContext {
  const { state, canvas, uiFontAtlas, dtSeconds } = input;
  const camera = state.scene.camera;
  const viewZ = state.viewZ;
  const viewport = {
    cssWidth: canvas.clientWidth,
    cssHeight: canvas.clientHeight,
    dpr: globalThis.devicePixelRatio || 1,
    fbWidth: canvas.width,
    fbHeight: canvas.height,
  };
  state.scene.viewport = {
    cssWidth: viewport.cssWidth,
    cssHeight: viewport.cssHeight,
    devicePixelRatio: viewport.dpr,
    framebufferWidth: viewport.fbWidth,
    framebufferHeight: viewport.fbHeight,
  };

  const region = updateVisibleRegion(
    camera,
    { fbWidth: canvas.width, fbHeight: canvas.height },
    viewZ,
  );

  state.scene.visibleChunks = region.visibleChunkKeys.map((key) =>
    chunkKeyString(key)
  );

  syncFovCache(state.world, state.scene.viewMode, state.fovDirty);
  state.scene.visibleTileCount = state.world.visible.size;
  state.scene.rememberedTileCount = state.world.memory.size;
  if (state.topmostDirty) {
    rebuildTopmostCache(
      region.visibleChunkKeys,
      viewZ,
      state.world,
      state.scene.viewMode,
    );
    state.topmostDirty = false;
  }

  state.scene.drawOrderLabels = [
    "floor",
    "edgeShadow",
    "ceilingShadow",
    ...(state.scene.viewMode === "entity" ? ["fog"] : []),
    "player",
    "chat",
    "ui",
  ];

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
      simTick: state.simTick,
      frameNumber: state.frameNumber,
      visibleTileBounds: region.visibleTileBounds,
      visibleChunkKeys: region.visibleChunkKeys,
      world: state.world as Readonly<WorldSimState>,
    },
    ui: {
      uiMode: state.scene.uiMode,
      chatBuffer: state.scene.chatBuffer,
      chatBubbles: state.scene.chatBubbles,
      fpsHistory: state.fpsHistory,
      simTpsDisplay: state.simTpsDisplay,
      fontAtlas: uiFontAtlas,
      uiOverlayVisible: state.uiOverlayVisible,
    },
    policy: {
      viewMode: state.scene.viewMode,
      layers: state.layers,
    },
  };
}
