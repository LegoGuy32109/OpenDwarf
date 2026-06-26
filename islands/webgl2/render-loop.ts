/// <reference lib="dom" />

import type { WebGl2Boot } from "./gpu-init.ts";
import { buildFrameContext, createFrameBuilderWorld } from "./frame-builder.ts";
import { assertNoGlError } from "./gl-errors.ts";
import { runPasses } from "./pass-runner.ts";
import { ALL_PASSES } from "./passes/index.ts";
import { compilePrograms } from "./programs/index.ts";
import {
  loadAtlasInto,
  TEXTURE_UNITS,
  uploadWhiteTo,
} from "./texture-units.ts";

const BACKGROUND_COLOR: [number, number, number, number] = [
  0.106,
  0.109,
  0.122,
  1,
];

const FLOOR_ATLAS_SRC = "/assets/sprites/StackedTextures.png";
const EDGE_SHADOW_ATLAS_SRC = "/assets/atlases/ShadowAtlas.png";
const CEIL_SHADOW_ATLAS_SRC = "/assets/atlases/ObscureAtlas.png";

function syncCanvasSize(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) {
  const dpr = globalThis.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  gl.viewport(0, 0, canvas.width, canvas.height);
}

export function startWebGl2RenderLoop(
  boot: WebGl2Boot,
  onError?: (message: string) => void,
): () => void {
  const { gl, canvas } = boot;
  const world = createFrameBuilderWorld();
  const gpu = compilePrograms(gl);
  const scratch = new Float32Array(
    gpu.maxInstances * gpu.programs.floor.strideFloats,
  );
  let rafId = 0;
  let stopped = false;
  let sceneReady = false;
  let frameNumber = 0;
  let lastFrameTime: number | null = null;

  void (async () => {
    try {
      console.info("[webgl2] phase 2 start: loading assets");
      await Promise.all([
        loadAtlasInto(
          gl,
          TEXTURE_UNITS.floor,
          FLOOR_ATLAS_SRC,
          gpu.floorTexture,
        ),
        loadAtlasInto(
          gl,
          TEXTURE_UNITS.edgeShadow,
          EDGE_SHADOW_ATLAS_SRC,
          gpu.edgeShadowTexture,
        ),
        loadAtlasInto(
          gl,
          TEXTURE_UNITS.ceilShadow,
          CEIL_SHADOW_ATLAS_SRC,
          gpu.ceilShadowTexture,
        ),
      ]);
      uploadWhiteTo(gl, TEXTURE_UNITS.white, gpu.whiteTexture);
      assertNoGlError(gl, "phase 2 init");
      sceneReady = true;
      console.info(
        "[webgl2] phase 2 done: loading assets (floor + shadow atlases ready)",
      );
      console.info("[webgl2] phase 3 start: steady state (sceneReady=true)");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(error);
      onError?.(message);
    }
  })();

  const frame = (now: number) => {
    if (stopped) {
      return;
    }

    syncCanvasSize(gl, canvas);
    gl.clearColor(
      BACKGROUND_COLOR[0],
      BACKGROUND_COLOR[1],
      BACKGROUND_COLOR[2],
      BACKGROUND_COLOR[3],
    );
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (!sceneReady) {
      rafId = globalThis.requestAnimationFrame(frame);
      return;
    }

    const dtSeconds = lastFrameTime === null
      ? 0
      : Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;

    const ctx = buildFrameContext({
      gl,
      programs: gpu.programs,
      scratch,
      instanceBuffer: gpu.instanceBuffer,
      maxInstances: gpu.maxInstances,
      batchStats: { drawCalls: 0, instances: 0 },
      canvas,
      world,
      frameNumber,
      dtSeconds,
      simTick: world.tick,
      viewMode: "entity",
    });

    runPasses(ctx, ALL_PASSES);
    frameNumber++;
    rafId = globalThis.requestAnimationFrame(frame);
  };

  rafId = globalThis.requestAnimationFrame(frame);

  return () => {
    stopped = true;
    globalThis.cancelAnimationFrame(rafId);
  };
}
