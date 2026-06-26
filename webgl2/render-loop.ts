/// <reference lib="dom" />

import type { WebGl2Boot } from "./gpu-init.ts";
import { buildFrameContext, createFrameBuilderWorld } from "./frame-builder.ts";
import { assertNoGlError } from "./gl-errors.ts";
import { runPasses } from "./pass-runner.ts";
import { resetPlayerRenderState } from "./passes/player.ts";
import { ALL_PASSES } from "./passes/index.ts";
import { compilePrograms } from "./programs/index.ts";
import { advanceWorldMovement } from "../lib/webgl-world-sim.ts";
import { syncCanvasSize } from "./canvas.ts";
import {
  loadAtlasInto,
  TEXTURE_UNITS,
  uploadWhiteTo,
} from "./texture-units.ts";
import { loadUiFontAtlas } from "./ui-text.ts";

const BACKGROUND_COLOR: [number, number, number, number] = [
  0.106,
  0.109,
  0.122,
  1,
];

const FLOOR_ATLAS_SRC = "/assets/sprites/StackedTextures.png";
const EDGE_SHADOW_ATLAS_SRC = "/assets/atlases/ShadowAtlas.png";
const CEIL_SHADOW_ATLAS_SRC = "/assets/atlases/ObscureAtlas.png";
const SPRITE_ATLAS_SRC = "/assets/sprites/Dwarf_16x16.png";

export function startWebGl2RenderLoop(
  boot: WebGl2Boot,
  onError?: (message: string) => void,
  getViewMode: () => "entity" | "free" = () => "entity",
): () => void {
  const { gl, canvas } = boot;
  const world = createFrameBuilderWorld();
  const gpu = compilePrograms(gl);
  const scratch = new Float32Array(
    gpu.maxInstances * gpu.maxStrideFloats,
  );
  let uiFontAtlas: Awaited<ReturnType<typeof loadUiFontAtlas>> | null = null;
  resetPlayerRenderState();
  let rafId = 0;
  let stopped = false;
  let sceneReady = false;
  let frameNumber = 0;
  let lastFrameTime: number | null = null;
  const fpsHistory: number[] = [];
  let simAccumulatorMs = 0;
  let simTicksThisSecond = 0;
  let simTpsDisplay = 0;
  let simTickSecondStart = performance.now();

  void (async () => {
    try {
      const phase2Start = performance.now();
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
        loadAtlasInto(
          gl,
          TEXTURE_UNITS.sprite,
          SPRITE_ATLAS_SRC,
          gpu.spriteTexture,
        ),
        loadUiFontAtlas(gl, gpu.fontTexture).then((atlas) => {
          uiFontAtlas = atlas;
        }),
      ]);
      uploadWhiteTo(gl, TEXTURE_UNITS.white, gpu.whiteTexture);
      assertNoGlError(gl, "phase 2 init");
      sceneReady = true;
      const phase2Elapsed = Math.round(performance.now() - phase2Start);
      console.info(
        `[webgl2] phase 2 done: assets ready (${phase2Elapsed}ms)`,
      );
      console.info("[webgl2] phase 3 start: steady state");
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
      lastFrameTime = now;
      rafId = globalThis.requestAnimationFrame(frame);
      return;
    }

    const dtSeconds = lastFrameTime === null
      ? 0
      : Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;

    const rawDeltaMs = dtSeconds * 1000;
    if (rawDeltaMs > 0 && rawDeltaMs < 250) {
      fpsHistory.push(1000 / rawDeltaMs);
      if (fpsHistory.length > 60) {
        fpsHistory.shift();
      }
    }

    const SIM_TICK_MS = 1000 / 20;
    simAccumulatorMs += rawDeltaMs;
    let simTicksThisFrame = 0;
    while (simAccumulatorMs >= SIM_TICK_MS && simTicksThisFrame < 3) {
      world.tick++;
      advanceWorldMovement(world);
      simAccumulatorMs -= SIM_TICK_MS;
      simTicksThisFrame++;
      simTicksThisSecond++;
    }
    if (now - simTickSecondStart >= 1000) {
      simTpsDisplay = simTicksThisSecond;
      simTicksThisSecond = 0;
      simTickSecondStart = now;
    }

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
      viewMode: getViewMode(),
      ui: {
        chatBuffer: "",
        chatBubbles: [],
        fpsHistory,
        simTpsDisplay,
        fontAtlas: uiFontAtlas,
      },
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
