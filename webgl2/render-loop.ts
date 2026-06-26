/// <reference lib="dom" />

import type { WebGl2Boot } from "./gpu-init.ts";
import { buildFrameContext } from "./frame-builder.ts";
import { assertNoGlError } from "./gl-errors.ts";
import { runPasses } from "./pass-runner.ts";
import { resetPlayerRenderState } from "./passes/player.ts";
import { ALL_PASSES } from "./passes/index.ts";
import { compilePrograms } from "./programs/index.ts";
import {
  loadAtlasInto,
  TEXTURE_UNITS,
  uploadWhiteTo,
} from "./texture-units.ts";
import { loadUiFontAtlas } from "./ui-text.ts";
import {
  advanceSimulationTick,
  buildStreamingChunkKeys,
  processCameraMovement,
  processPendingSolidChunks,
  updateWorldSolidCache,
} from "./runtime.ts";
import { syncCanvasSize } from "./canvas.ts";
import type { WebGl2GameState } from "./game-state.ts";
import { entityRenderPosition } from "../lib/webgl-world-sim.ts";
import { TILE_SIZE_PX } from "../lib/webgl-chunk-gen.ts";
import { getSolidCache, syncFloorCache } from "./caches/topmost.ts";

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
  state: WebGl2GameState,
  onError?: (message: string) => void,
): () => void {
  const { gl, canvas } = boot;
  const gpu = compilePrograms(gl);
  const scratch = new Float32Array(gpu.maxInstances * gpu.maxStrideFloats);
  let uiFontAtlas: Awaited<ReturnType<typeof loadUiFontAtlas>> | null = null;
  resetPlayerRenderState();
  let rafId = 0;
  let stopped = false;
  let sceneReady = false;
  let lastFrameTime: number | null = null;
  let smoothPlayerWorldPos: [number, number] | null = null;

  const updateCameraFromWorld = (dtSeconds: number) => {
    const [targetX, targetY] = entityRenderPosition(state.world.entity);
    if (!smoothPlayerWorldPos) {
      smoothPlayerWorldPos = [targetX, targetY];
    } else {
      const rate = 1 - Math.exp(-10 * dtSeconds);
      smoothPlayerWorldPos[0] += (targetX - smoothPlayerWorldPos[0]) * rate;
      smoothPlayerWorldPos[1] += (targetY - smoothPlayerWorldPos[1]) * rate;
    }

    if (state.scene.viewMode === "entity") {
      const [sx, sy] = smoothPlayerWorldPos;
      state.scene.camera = {
        x: (sx + 0.5) * TILE_SIZE_PX + state.cameraLookOffset.x,
        y: (sy + 0.5) * TILE_SIZE_PX + state.cameraLookOffset.y,
        zoom: state.scene.camera.zoom,
      };
      state.topmostDirty = true;
    }
  };

  const pushAssetLoaded = (src: string) => {
    if (!state.scene.assetsLoaded.includes(src)) {
      state.scene.assetsLoaded = [...state.scene.assetsLoaded, src];
    }
  };

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
        ).then((atlas) => {
          pushAssetLoaded(FLOOR_ATLAS_SRC);
          console.info(
            `[webgl2] texture ${FLOOR_ATLAS_SRC} ${atlas.width}x${atlas.height}`,
          );
          return atlas;
        }),
        loadAtlasInto(
          gl,
          TEXTURE_UNITS.edgeShadow,
          EDGE_SHADOW_ATLAS_SRC,
          gpu.edgeShadowTexture,
        ).then((atlas) => {
          pushAssetLoaded(EDGE_SHADOW_ATLAS_SRC);
          console.info(
            `[webgl2] texture ${EDGE_SHADOW_ATLAS_SRC} ${atlas.width}x${atlas.height}`,
          );
          return atlas;
        }),
        loadAtlasInto(
          gl,
          TEXTURE_UNITS.ceilShadow,
          CEIL_SHADOW_ATLAS_SRC,
          gpu.ceilShadowTexture,
        ).then((atlas) => {
          pushAssetLoaded(CEIL_SHADOW_ATLAS_SRC);
          console.info(
            `[webgl2] texture ${CEIL_SHADOW_ATLAS_SRC} ${atlas.width}x${atlas.height}`,
          );
          return atlas;
        }),
        loadAtlasInto(
          gl,
          TEXTURE_UNITS.sprite,
          SPRITE_ATLAS_SRC,
          gpu.spriteTexture,
        ).then((atlas) => {
          pushAssetLoaded(SPRITE_ATLAS_SRC);
          console.info(
            `[webgl2] texture ${SPRITE_ATLAS_SRC} ${atlas.width}x${atlas.height}`,
          );
          return atlas;
        }),
        loadUiFontAtlas(gl, gpu.fontTexture).then((atlas) => {
          uiFontAtlas = atlas;
          pushAssetLoaded("/assets/ui/JoshPerfectDosVga.png");
          console.info(
            `[webgl2] texture /assets/ui/JoshPerfectDosVga.png ${atlas.width}x${atlas.height}`,
          );
        }),
      ]);
      uploadWhiteTo(gl, TEXTURE_UNITS.white, gpu.whiteTexture);
      assertNoGlError(gl, "phase 2 init");
      sceneReady = true;
      state.status = "depth stack ready";
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
    state.scene.viewport = {
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      devicePixelRatio: globalThis.devicePixelRatio || 1,
      framebufferWidth: canvas.width,
      framebufferHeight: canvas.height,
    };
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
    state.lastFrameTime = now;

    const rawDeltaMs = dtSeconds * 1000;
    if (rawDeltaMs > 0 && rawDeltaMs < 250) {
      state.fpsHistory.push(1000 / rawDeltaMs);
      if (state.fpsHistory.length > 60) {
        state.fpsHistory.shift();
      }
    }

    const SIM_TICK_MS = 1000 / 20;
    state.simAccumulatorMs += rawDeltaMs;
    let simTicksThisFrame = 0;
    while (state.simAccumulatorMs >= SIM_TICK_MS && simTicksThisFrame < 3) {
      advanceSimulationTick(state);
      state.simAccumulatorMs -= SIM_TICK_MS;
      simTicksThisFrame++;
    }
    if (now - state.simTickSecondStart >= 1000) {
      state.simTpsDisplay = state.simTicksThisSecond;
      state.simTicksThisSecond = 0;
      state.simTickSecondStart = now;
    }

    processCameraMovement(dtSeconds, state);
    updateCameraFromWorld(dtSeconds);

    const streaming = buildStreamingChunkKeys(state, state.viewZ);
    const streamingFingerprint = streaming.streamingChunkKeys.map((k) =>
      `${k.chunkX},${k.chunkY},${k.chunkZ}`
    ).join("|");
    if (streamingFingerprint !== state.streamingKeySet) {
      state.streamingKeySet = streamingFingerprint;
      state.scene.residentChunks = streaming.streamingChunkKeys.length;
      state.scene.streamingChunks = streaming.streamingChunkKeys.map((k) =>
        `${k.chunkX},${k.chunkY},${k.chunkZ}`
      );
      syncFloorCache(
        state.world.seed,
        streaming.streamingChunkKeys,
        state.viewZ,
      );
      updateWorldSolidCache(
        state,
        streaming.streamingChunkKeys.map((k) => ({
          chunkX: k.chunkX,
          chunkY: k.chunkY,
        })),
        state.viewZ,
      );
      state.topmostDirty = true;
    }
    processPendingSolidChunks(state);
    state.scene.residentChunks = getSolidCache().size;

    state.frameNumber += 1;
    state.scene.drawOrderLabels = [
      "floor",
      "edgeShadow",
      "ceilingShadow",
      ...(state.scene.viewMode === "entity" ? ["fog"] : []),
      "player",
      "chat",
      "ui",
    ];

    const ctx = buildFrameContext({
      state,
      gl,
      programs: gpu.programs,
      scratch,
      instanceBuffer: gpu.instanceBuffer,
      maxInstances: gpu.maxInstances,
      batchStats: { drawCalls: 0, instances: 0 },
      canvas,
      uiFontAtlas,
      dtSeconds,
    });

    runPasses(ctx, ALL_PASSES);
    rafId = globalThis.requestAnimationFrame(frame);
  };

  rafId = globalThis.requestAnimationFrame(frame);

  return () => {
    stopped = true;
    globalThis.cancelAnimationFrame(rafId);
  };
}
