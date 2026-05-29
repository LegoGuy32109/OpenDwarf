/// <reference lib="dom" />

import {
  CHUNK_EDGE_TILES,
  chunkKeyString,
  chunkOfTile,
  computeCeilingShadowIds,
  computeVisibleChunks,
  FLOOR_FRAMES,
  SHADOW_FRAMES,
  shadowMaskToAtlasId,
  TILE_SIZE_PX,
  tileKeyString,
  updateFloorCache,
  Z_LEVELS_BELOW,
} from "../../lib/webgl-chunk-gen.ts";
import {
  entityRenderPosition,
  generateWorldSolidChunk,
  isTileRemembered,
  isTileVisible,
  type WorldSimState,
} from "../../lib/webgl-world-sim.ts";
import { flushInstanceBatch, type InstanceBatchStats } from "./render-batch.ts";
import { getTileUniformLocations } from "./gl-resources.ts";
import { renderVgaUi } from "./render-ui.ts";
import {
  type CameraLookOffset,
  type ChatBubbleRecord,
  EDGE_SEGMENT_BAND_PX,
  EDGE_SEGMENT_DARK_ALPHA,
  EDGE_SEGMENT_LIGHT_ALPHA,
  type FrameMetric,
  type PlayerState,
  type ReplayPreview,
  SHADOW_ALPHA_MULTIPLIER,
  type WebGlCapabilityReport,
  type WebGlCheckpointRecord,
  type WebGlUiMode,
  type WebGlViewMode,
} from "./webgl-core.ts";
import type { VgaFontAtlas } from "../webgl-ui-text-vga.ts";

type Ref<T> = { current: T };

type SceneState = {
  camera: { x: number; y: number; zoom: number };
  player: PlayerState;
  viewMode: WebGlViewMode;
  uiMode: WebGlUiMode;
  fullscreen: boolean;
  viewport: {
    cssWidth: number;
    cssHeight: number;
    devicePixelRatio: number;
    framebufferWidth: number;
    framebufferHeight: number;
  };
  visibleChunks: string[];
  streamingChunks: string[];
  residentChunks: number;
  assetsLoaded: string[];
  chatBuffer: string;
  submittedChatMessages: string[];
  visibleTileCount: number;
  rememberedTileCount: number;
  drawOrderLabels: string[];
};

type RenderLoopArgs = {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  canvas: HTMLCanvasElement;
  scratch: Float32Array;
  maxInstances: number;
  instanceBuffer: WebGLBuffer;
  viewZ: number;
  sceneReadyRef: Ref<boolean>;
  worldRef: Ref<WorldSimState>;
  sceneStateRef: Ref<SceneState>;
  frameRef: Ref<number>;
  lastFrameTimeRef: Ref<number | null>;
  simAccumulatorRef: Ref<number>;
  simTickRef: Ref<number>;
  simTicksThisSecondRef: Ref<number>;
  simTickSecondStartRef: Ref<number>;
  simTpsDisplayRef: Ref<number>;
  fpsHistoryRef: Ref<number[]>;
  frameMetricsRef: Ref<FrameMetric[]>;
  pendingChunkGenerationRef: Ref<string[]>;
  streamingKeySetRef: Ref<string>;
  smoothPlayerWorldPosRef: Ref<[number, number] | null>;
  cameraLookOffsetRef: Ref<CameraLookOffset>;
  topmostCacheDirtyRef: Ref<boolean>;
  topmostOffsetsCacheRef: Ref<Map<string, Int8Array>>;
  shadowVisibleXYCacheRef: Ref<Array<{ chunkX: number; chunkY: number }>>;
  solidCacheRef: Ref<Map<string, Uint8Array>>;
  chunkCacheRef: Ref<Map<string, Uint16Array>>;
  layersRef: Ref<
    {
      floor: boolean;
      edgeShadow: boolean;
      ceilShadow: boolean;
      depthTint: boolean;
    }
  >;
  viewModeRef: Ref<WebGlViewMode>;
  wasMovingLastTickRef: Ref<boolean>;
  textureRef: Ref<WebGLTexture | null>;
  shadowTextureRef: Ref<WebGLTexture | null>;
  ceilShadowTextureRef: Ref<WebGLTexture | null>;
  playerTextureRef: Ref<WebGLTexture | null>;
  whiteTextureRef: Ref<WebGLTexture | null>;
  vgaFontAtlasRef: Ref<VgaFontAtlas | null>;
  textureInfoRef: Ref<{ src: string; width: number; height: number } | null>;
  playerTextureInfoRef: Ref<
    { src: string; width: number; height: number } | null
  >;
  capabilityStateRef: Ref<WebGlCapabilityReport | null>;
  replayPreviewRef: Ref<ReplayPreview>;
  checkpointRecordsRef: Ref<WebGlCheckpointRecord[]>;
  logsRef: Ref<string[]>;
  chatBubblesRef: Ref<ChatBubbleRecord[]>;
  uiOverlayVisibleRef: Ref<boolean>;
  getViewZ: () => number;
  buildStreamingChunkKeys: (
    currentViewZ: number,
  ) => Array<{ chunkX: number; chunkY: number; chunkZ: number }>;
  updateWorldSolidCache: (
    streamingXYKeys: Array<{ chunkX: number; chunkY: number }>,
    currentViewZ: number,
  ) => void;
  processCameraMovement: (deltaS: number) => void;
  advanceSimulationTick: () => void;
  scheduleNextFrame: () => void;
};

export function renderWebGlFrame(args: RenderLoopArgs) {
  const {
    gl,
    program,
    canvas,
    scratch,
    maxInstances,
    instanceBuffer,
    sceneReadyRef,
    worldRef,
    sceneStateRef,
    frameRef,
    lastFrameTimeRef,
    simAccumulatorRef,
    simTickRef,
    simTicksThisSecondRef,
    simTickSecondStartRef,
    simTpsDisplayRef,
    fpsHistoryRef,
    frameMetricsRef,
    pendingChunkGenerationRef,
    streamingKeySetRef,
    smoothPlayerWorldPosRef,
    cameraLookOffsetRef,
    topmostCacheDirtyRef,
    topmostOffsetsCacheRef,
    shadowVisibleXYCacheRef,
    solidCacheRef,
    chunkCacheRef,
    layersRef,
    viewModeRef,
    textureRef,
    shadowTextureRef,
    ceilShadowTextureRef,
    playerTextureRef,
    whiteTextureRef,
    playerTextureInfoRef,
    vgaFontAtlasRef,
    capabilityStateRef,
    replayPreviewRef,
    checkpointRecordsRef,
    logsRef,
    chatBubblesRef,
    uiOverlayVisibleRef,
    getViewZ,
    buildStreamingChunkKeys,
    updateWorldSolidCache,
    processCameraMovement,
    advanceSimulationTick,
    scheduleNextFrame,
  } = args;

  const viewZ = getViewZ();
  const t0 = performance.now();

  if (
    !gl || !program || !textureRef.current || !shadowTextureRef.current ||
    !ceilShadowTextureRef.current
  ) {
    lastFrameTimeRef.current = performance.now();
    frameMetricsRef.current.push({
      cpuMs: performance.now() - t0,
      drawCalls: 0,
      uploadBytes: 0,
      visibleChunks: sceneStateRef.current.visibleChunks.length,
    });
    scheduleNextFrame();
    return;
  }

  const lastGl = lastFrameTimeRef.current;
  lastFrameTimeRef.current = performance.now();
  const rawDeltaMs = lastGl !== null ? lastFrameTimeRef.current - lastGl : 0;
  const deltaMs = Math.min(rawDeltaMs, 100);

  const SIM_TICK_MS = 1000 / 20;
  simAccumulatorRef.current += deltaMs;
  let ticksThisFrame = 0;
  while (simAccumulatorRef.current >= SIM_TICK_MS && ticksThisFrame < 3) {
    advanceSimulationTick();
    simAccumulatorRef.current -= SIM_TICK_MS;
    ticksThisFrame++;
  }

  const deltaS = Math.min(deltaMs / 1000, 0.1);
  processCameraMovement(deltaS);

  const [spTargetX, spTargetY] = entityRenderPosition(worldRef.current.entity);
  if (!smoothPlayerWorldPosRef.current) {
    smoothPlayerWorldPosRef.current = [spTargetX, spTargetY];
  } else {
    const sf = 1 - Math.exp(-10 * deltaS);
    const sp = smoothPlayerWorldPosRef.current;
    sp[0] += (spTargetX - sp[0]) * sf;
    sp[1] += (spTargetY - sp[1]) * sf;
  }
  if (viewModeRef.current === "entity") {
    const [sx, sy] = smoothPlayerWorldPosRef.current;
    const lkOff = cameraLookOffsetRef.current;
    sceneStateRef.current.camera = {
      x: (sx + 0.5) * TILE_SIZE_PX + lkOff.x,
      y: (sy + 0.5) * TILE_SIZE_PX + lkOff.y,
      zoom: sceneStateRef.current.camera.zoom,
    };
  }
  frameRef.current += 1;

  if (sceneReadyRef.current) {
    const skGl = buildStreamingChunkKeys(viewZ);
    const seed = worldRef.current.seed;
    const sfpGl = skGl.map((k) =>
      chunkKeyString({ ...k, chunkZ: viewZ })
    ).join("|") +
      `|z${viewZ}`;
    if (sfpGl !== streamingKeySetRef.current) {
      streamingKeySetRef.current = sfpGl;
      updateFloorCache(chunkCacheRef.current, seed, skGl, viewZ);
      updateWorldSolidCache(skGl, viewZ);
      sceneStateRef.current.residentChunks = skGl.length;
      sceneStateRef.current.streamingChunks = skGl.map((k) =>
        chunkKeyString({ ...k, chunkZ: viewZ })
      );
      topmostCacheDirtyRef.current = true;
    }
  }

  {
    const pending = pendingChunkGenerationRef.current;
    if (pending.length > 0) {
      const batch = pending.splice(0, 5);
      const seed = worldRef.current.seed;
      for (const key of batch) {
        if (!solidCacheRef.current.has(key)) {
          const [cx, cy, cz] = key.split(",").map(Number);
          solidCacheRef.current.set(
            key,
            generateWorldSolidChunk(seed, {
              chunkX: cx,
              chunkY: cy,
              chunkZ: cz,
            }),
          );
        }
      }
      topmostCacheDirtyRef.current = true;
    }
  }

  if (rawDeltaMs > 0 && rawDeltaMs < 250) {
    fpsHistoryRef.current.push(1000 / rawDeltaMs);
    if (fpsHistoryRef.current.length > 60) fpsHistoryRef.current.shift();
  }
  if (performance.now() - simTickSecondStartRef.current >= 1000) {
    simTpsDisplayRef.current = simTicksThisSecondRef.current;
    simTicksThisSecondRef.current = 0;
    simTickSecondStartRef.current = performance.now();
  }

  const batchStats: InstanceBatchStats = { drawCalls: 0, instances: 0 };
  gl.useProgram(program);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const {
    canvasSizeLoc,
    cameraLoc,
    zoomLoc,
    textureLoc,
    tintLoc,
    alphaMultiplierLoc,
    renderModeLoc,
  } = getTileUniformLocations(gl, program);

  if (canvasSizeLoc) gl.uniform2f(canvasSizeLoc, canvas.width, canvas.height);
  if (cameraLoc) {
    gl.uniform2f(
      cameraLoc,
      sceneStateRef.current.camera.x,
      sceneStateRef.current.camera.y,
    );
  }
  if (zoomLoc) gl.uniform1f(zoomLoc, sceneStateRef.current.camera.zoom);
  gl.activeTexture(gl.TEXTURE0);
  if (textureLoc) gl.uniform1i(textureLoc, 0);

  let curRenderMode = -1;
  let curTintR = -1;
  let curTintG = -1;
  let curTintB = -1;
  let curAlpha = -1;
  const setRenderMode = (m: number) => {
    if (m !== curRenderMode) {
      if (renderModeLoc) gl.uniform1i(renderModeLoc, m);
      curRenderMode = m;
    }
  };
  const setTint = (r: number, g: number, b: number) => {
    if (r !== curTintR || g !== curTintG || b !== curTintB) {
      if (tintLoc) gl.uniform3f(tintLoc, r, g, b);
      curTintR = r;
      curTintG = g;
      curTintB = b;
    }
  };
  const setAlpha = (a: number) => {
    if (a !== curAlpha) {
      if (alphaMultiplierLoc) gl.uniform1f(alphaMultiplierLoc, a);
      curAlpha = a;
    }
  };

  const visibleXY = computeVisibleChunks(
    sceneStateRef.current.camera,
    { framebufferWidth: canvas.width, framebufferHeight: canvas.height },
  );
  const visibleChunkKeys = visibleXY
    .map((k) => ({ k, key: chunkKeyString({ ...k, chunkZ: viewZ }) }))
    .filter(({ key }) => chunkCacheRef.current.has(key));
  sceneStateRef.current.visibleChunks = visibleChunkKeys.map(({ key }) => key);

  if (topmostCacheDirtyRef.current) {
    const shadowXY = new Map<string, { chunkX: number; chunkY: number }>();
    for (const vis of visibleXY) {
      shadowXY.set(`${vis.chunkX},${vis.chunkY}`, vis);
      shadowXY.set(`${vis.chunkX},${vis.chunkY - 1}`, {
        chunkX: vis.chunkX,
        chunkY: vis.chunkY - 1,
      });
    }
    shadowVisibleXYCacheRef.current = [...shadowXY.values()];
  }
  const shadowVisibleXY = shadowVisibleXYCacheRef.current;
  const drawOrderLabels: string[] = ["floor", "edgeShadow", "ceilingShadow"];
  if (viewModeRef.current === "entity") drawOrderLabels.push("fog");
  drawOrderLabels.push("player", "chat", "ui");
  sceneStateRef.current.drawOrderLabels = drawOrderLabels;

  if (sceneReadyRef.current) {
    const HALF = TILE_SIZE_PX * 0.5;
    const INV_FLOOR = 1.0 / FLOOR_FRAMES;
    const INV_SHADOW = 1.0 / SHADOW_FRAMES;
    const DEPTH_TINTS: [number, number, number][] = [
      [1.0, 1.0, 1.0],
      [0.75, 0.75, 0.75],
      [0.65, 0.65, 0.8],
      [0.43, 0.45, 0.61],
      [0.32, 0.34, 0.61],
      [0.2, 0.2, 0.4],
    ];
    const REMEMBERED_TINT: [number, number, number] = [1.0, 0.86, 0.34];
    const entityMode = viewModeRef.current === "entity";
    const world = worldRef.current;
    const localSolidAt = (
      chunkX: number,
      chunkY: number,
      tx: number,
      ty: number,
      z: number,
    ) => {
      const cx = chunkX + Math.floor(tx / CHUNK_EDGE_TILES);
      const cy = chunkY + Math.floor(ty / CHUNK_EDGE_TILES);
      const lx = ((tx % CHUNK_EDGE_TILES) + CHUNK_EDGE_TILES) %
        CHUNK_EDGE_TILES;
      const ly = ((ty % CHUNK_EDGE_TILES) + CHUNK_EDGE_TILES) %
        CHUNK_EDGE_TILES;
      const solid = solidCacheRef.current.get(
        chunkKeyString({ chunkX: cx, chunkY: cy, chunkZ: z }),
      );
      return solid ? solid[ly * CHUNK_EDGE_TILES + lx] === 1 : true;
    };
    const visibilityState = (x: number, y: number, z: number) => {
      if (!entityMode) return "visible" as const;
      const pos = { x, y, z };
      if (isTileVisible(world, pos)) return "visible" as const;
      if (isTileRemembered(world, pos)) return "remembered" as const;
      return "unseen" as const;
    };
    const renderSolidAt = (
      chunkX: number,
      chunkY: number,
      tx: number,
      ty: number,
      z: number,
    ) => {
      const cx = chunkX + Math.floor(tx / CHUNK_EDGE_TILES);
      const cy = chunkY + Math.floor(ty / CHUNK_EDGE_TILES);
      const lx = ((tx % CHUNK_EDGE_TILES) + CHUNK_EDGE_TILES) %
        CHUNK_EDGE_TILES;
      const ly = ((ty % CHUNK_EDGE_TILES) + CHUNK_EDGE_TILES) %
        CHUNK_EDGE_TILES;
      const worldX = cx * CHUNK_EDGE_TILES + lx;
      const worldY = cy * CHUNK_EDGE_TILES + ly;
      const key = tileKeyString({ tileX: worldX, tileY: worldY, tileZ: z });
      if (entityMode) {
        if (world.visible.has(key)) {
          return localSolidAt(chunkX, chunkY, tx, ty, z);
        }
        return world.memory.get(key)?.block === "solid";
      }
      return localSolidAt(chunkX, chunkY, tx, ty, z);
    };
    const flushPass = (count: number) =>
      flushInstanceBatch(
        gl,
        instanceBuffer,
        scratch,
        count,
        batchStats,
      );

    if (topmostCacheDirtyRef.current) {
      const topmostXY = new Map<string, { chunkX: number; chunkY: number }>();
      for (const vis of shadowVisibleXY) {
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
          const chunkX = vis.chunkX + dx;
          const chunkY = vis.chunkY + dy;
          topmostXY.set(`${chunkX},${chunkY}`, { chunkX, chunkY });
        }
      }
      topmostOffsetsCacheRef.current = new Map();
      for (const vis of topmostXY.values()) {
        const chunkKey = chunkKeyString({
          chunkX: vis.chunkX,
          chunkY: vis.chunkY,
          chunkZ: viewZ,
        });
        const tmo = new Int8Array(CHUNK_EDGE_TILES * CHUNK_EDGE_TILES).fill(
          127,
        );
        for (let ty = 0; ty < CHUNK_EDGE_TILES; ty++) {
          for (let tx = 0; tx < CHUNK_EDGE_TILES; tx++) {
            const idx = ty * CHUNK_EDGE_TILES + tx;
            for (let zo = 0; zo >= -Z_LEVELS_BELOW; zo--) {
              if (renderSolidAt(vis.chunkX, vis.chunkY, tx, ty, viewZ + zo)) {
                tmo[idx] = zo;
                break;
              }
            }
          }
        }
        topmostOffsetsCacheRef.current.set(chunkKey, tmo);
      }
      topmostCacheDirtyRef.current = false;
    }
    const topmostOffsets = topmostOffsetsCacheRef.current;
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
      const tmo = topmostOffsets.get(
        chunkKeyString({ chunkX: cx, chunkY: cy, chunkZ: viewZ }),
      );
      return tmo ? tmo[ly * CHUNK_EDGE_TILES + lx] : 127;
    };

    gl.disable(gl.BLEND);
    gl.bindTexture(gl.TEXTURE_2D, textureRef.current);

    if (layersRef.current.floor) {
      for (let z = viewZ - Z_LEVELS_BELOW; z <= viewZ; z++) {
        const zOffset = z - viewZ;
        const rawTint = DEPTH_TINTS[-zOffset] ??
          DEPTH_TINTS[DEPTH_TINTS.length - 1];
        const drawFloorState = (
          state: "visible" | "remembered",
          tint: [number, number, number],
          alpha: number,
        ) => {
          setTint(tint[0], tint[1], tint[2]);
          setAlpha(alpha);
          setRenderMode(0);
          let count = 0;
          for (const { k: vis, key } of visibleChunkKeys) {
            const tmo = topmostOffsets.get(key);
            if (!tmo) continue;
            const baseX = vis.chunkX * CHUNK_EDGE_TILES;
            const baseY = vis.chunkY * CHUNK_EDGE_TILES;
            for (let ty = 0; ty < CHUNK_EDGE_TILES; ty++) {
              for (let tx = 0; tx < CHUNK_EDGE_TILES; tx++) {
                const idx = ty * CHUNK_EDGE_TILES + tx;
                if (tmo[idx] !== zOffset) continue;
                if (entityMode) {
                  const tileState = visibilityState(baseX + tx, baseY + ty, z);
                  if (tileState !== state) continue;
                } else if (state !== "visible") {
                  continue;
                }
                const off = count * 8;
                scratch[off + 0] = (baseX + tx) * TILE_SIZE_PX;
                scratch[off + 1] = (baseY + ty) * TILE_SIZE_PX;
                scratch[off + 2] = TILE_SIZE_PX;
                scratch[off + 3] = TILE_SIZE_PX;
                scratch[off + 4] = 0;
                scratch[off + 5] = 5 * INV_FLOOR;
                scratch[off + 6] = 1;
                scratch[off + 7] = INV_FLOOR;
                count++;
              }
            }
          }
          flushPass(count);
        };
        const tint = layersRef.current.depthTint
          ? rawTint
          : ([1, 1, 1] as [number, number, number]);
        drawFloorState("visible", tint, 1);
        if (entityMode) drawFloorState("remembered", REMEMBERED_TINT, 0.95);
      }
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindTexture(gl.TEXTURE_2D, shadowTextureRef.current!);
    setTint(1, 1, 1);

    if (layersRef.current.edgeShadow) {
      let count = 0;
      const addSegmentRect = (
        x: number,
        y: number,
        w: number,
        h: number,
        alpha: number,
      ) => {
        if (count >= maxInstances) {
          flushPass(count);
          count = 0;
        }
        setRenderMode(2);
        const off = count * 8;
        scratch[off + 0] = x;
        scratch[off + 1] = y;
        scratch[off + 2] = w;
        scratch[off + 3] = h;
        scratch[off + 4] = alpha;
        scratch[off + 5] = 0;
        scratch[off + 6] = 1;
        scratch[off + 7] = 1;
        count++;
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
        addSegmentRect(
          darkX,
          topY,
          EDGE_SEGMENT_BAND_PX,
          TILE_SIZE_PX,
          EDGE_SEGMENT_DARK_ALPHA,
        );
        addSegmentRect(
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
        addSegmentRect(
          leftX,
          darkY,
          TILE_SIZE_PX,
          EDGE_SEGMENT_BAND_PX,
          EDGE_SEGMENT_DARK_ALPHA,
        );
        addSegmentRect(
          leftX,
          lightY,
          TILE_SIZE_PX,
          EDGE_SEGMENT_BAND_PX,
          EDGE_SEGMENT_LIGHT_ALPHA,
        );
      };
      for (const vis of shadowVisibleXY) {
        const baseX = vis.chunkX * CHUNK_EDGE_TILES;
        const baseY = vis.chunkY * CHUNK_EDGE_TILES;
        for (let ty = 0; ty < CHUNK_EDGE_TILES; ty++) {
          for (let tx = 0; tx < CHUNK_EDGE_TILES; tx++) {
            const here = getTopmostOffset(vis.chunkX, vis.chunkY, tx, ty);
            if (here === 127) continue;
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
      flushPass(count);
    }

    gl.bindTexture(gl.TEXTURE_2D, ceilShadowTextureRef.current!);
    setAlpha(SHADOW_ALPHA_MULTIPLIER);
    setRenderMode(1);

    if (layersRef.current.ceilShadow) {
      let count = 0;
      for (const vis of shadowVisibleXY) {
        const baseX = vis.chunkX * CHUNK_EDGE_TILES;
        const baseY = vis.chunkY * CHUNK_EDGE_TILES;
        for (let ty = 0; ty < CHUNK_EDGE_TILES; ty++) {
          for (let tx = 0; tx < CHUNK_EDGE_TILES; tx++) {
            let mask = 0;
            if (entityMode) {
              const checkCorner = (dx: number, dy: number) =>
                getTopmostOffset(vis.chunkX, vis.chunkY, tx + dx, ty + dy) ===
                  0 &&
                renderSolidAt(
                  vis.chunkX,
                  vis.chunkY,
                  tx + dx,
                  ty + dy,
                  viewZ + 1,
                );
              if (checkCorner(0, 0)) mask |= 1;
              if (checkCorner(1, 0)) mask |= 2;
              if (checkCorner(0, 1)) mask |= 4;
              if (checkCorner(1, 1)) mask |= 8;
              mask = mask === 0 ? 0 : shadowMaskToAtlasId(mask);
            } else {
              const ceilIds = computeCeilingShadowIds(
                vis.chunkX,
                vis.chunkY,
                viewZ,
                solidCacheRef.current,
              );
              mask = ceilIds[ty * CHUNK_EDGE_TILES + tx];
            }
            if (mask === 0) continue;
            const off = count * 8;
            scratch[off + 0] = (baseX + tx) * TILE_SIZE_PX + HALF;
            scratch[off + 1] = (baseY + ty) * TILE_SIZE_PX + HALF;
            scratch[off + 2] = TILE_SIZE_PX;
            scratch[off + 3] = TILE_SIZE_PX;
            scratch[off + 4] = 0;
            scratch[off + 5] = (mask - 1) * INV_SHADOW;
            scratch[off + 6] = 1;
            scratch[off + 7] = INV_SHADOW;
            count++;
          }
        }
      }
      flushPass(count);
    }

    if (viewModeRef.current === "entity" && whiteTextureRef.current) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      setRenderMode(5);
      setTint(1.0, 0.78, 0.18);
      setAlpha(0.06);

      let count = 0;
      for (const { k: vis, key } of visibleChunkKeys) {
        const tmo = topmostOffsets.get(key);
        if (!tmo) continue;
        const baseX = vis.chunkX * CHUNK_EDGE_TILES;
        const baseY = vis.chunkY * CHUNK_EDGE_TILES;
        for (let ty = 0; ty < CHUNK_EDGE_TILES; ty++) {
          for (let tx = 0; tx < CHUNK_EDGE_TILES; tx++) {
            const zOffset = tmo[ty * CHUNK_EDGE_TILES + tx];
            if (zOffset === 127) continue;
            const tileX = baseX + tx;
            const tileY = baseY + ty;
            if (
              visibilityState(tileX, tileY, viewZ + zOffset) !== "remembered"
            ) {
              continue;
            }
            const off = count * 8;
            scratch[off + 0] = tileX * TILE_SIZE_PX;
            scratch[off + 1] = tileY * TILE_SIZE_PX;
            scratch[off + 2] = TILE_SIZE_PX;
            scratch[off + 3] = TILE_SIZE_PX;
            scratch[off + 4] = 1;
            scratch[off + 5] = 0;
            scratch[off + 6] = 1;
            scratch[off + 7] = 1;
            count++;
          }
        }
      }
      flushPass(count);
    }

    if (playerTextureInfoRef.current && playerTextureRef.current) {
      const player = worldRef.current.entity.position;
      const zOffset = player.z - viewZ;
      const inZRange = zOffset >= -Z_LEVELS_BELOW;
      let occluded = false;
      if (zOffset !== 0) {
        const lo = zOffset < 0 ? player.z + 1 : viewZ + 1;
        const hi = zOffset < 0 ? viewZ : player.z;
        const playerChunk = chunkOfTile(player.x, player.y);
        const lx = player.x - playerChunk.chunkX * CHUNK_EDGE_TILES;
        const ly = player.y - playerChunk.chunkY * CHUNK_EDGE_TILES;
        for (let checkZ = lo; checkZ <= hi; checkZ++) {
          if (
            localSolidAt(playerChunk.chunkX, playerChunk.chunkY, lx, ly, checkZ)
          ) {
            occluded = true;
            break;
          }
        }
      }
      const visibleToEntity = !entityMode ||
        isTileVisible(worldRef.current, player);
      if (inZRange && !occluded && visibleToEntity) {
        gl.bindTexture(gl.TEXTURE_2D, playerTextureRef.current);
        setRenderMode(0);
        const playerTint = layersRef.current.depthTint && zOffset < 0
          ? DEPTH_TINTS[Math.min(-zOffset, DEPTH_TINTS.length - 1)]
          : ([1, 1, 1] as [number, number, number]);
        setTint(playerTint[0], playerTint[1], playerTint[2]);
        setAlpha(1);
        const [rx, ry] = smoothPlayerWorldPosRef.current ??
          entityRenderPosition(worldRef.current.entity);
        const facingLeft = worldRef.current.entity.facingLeft;
        const off = 0;
        scratch[off + 0] = rx * TILE_SIZE_PX;
        scratch[off + 1] = ry * TILE_SIZE_PX;
        scratch[off + 2] = TILE_SIZE_PX;
        scratch[off + 3] = TILE_SIZE_PX;
        scratch[off + 4] = facingLeft ? 1 : 0;
        scratch[off + 5] = 0;
        scratch[off + 6] = facingLeft ? -1 : 1;
        scratch[off + 7] = 1;
        flushPass(1);
      }
    }

    if (vgaFontAtlasRef.current) {
      renderVgaUi({
        gl,
        canvas,
        vgaAtlas: vgaFontAtlasRef.current,
        whiteTexture: whiteTextureRef.current,
        scratch,
        maxInstances,
        flushPass,
        tintLoc,
        alphaMultiplierLoc,
        renderModeLoc,
        setRenderMode,
        setTint,
        setAlpha,
        sceneState: sceneStateRef.current,
        uiOverlayVisible: uiOverlayVisibleRef.current,
        capability: capabilityStateRef.current,
        replayPreview: replayPreviewRef.current,
        fpsHistory: fpsHistoryRef.current,
        simTpsDisplay: simTpsDisplayRef.current,
        solidChunkCount: solidCacheRef.current.size,
        visibleTileCount: viewModeRef.current === "entity"
          ? worldRef.current.visible.size
          : 0,
        layers: layersRef.current,
        viewMode: viewModeRef.current,
        viewZ,
        frameDrawCalls: batchStats.drawCalls,
        frameInstances: batchStats.instances,
        logs: logsRef.current,
        checkpoints: checkpointRecordsRef.current,
        chatBubbles: chatBubblesRef.current,
        simTick: simTickRef.current,
        setChatBubbles: (bubbles) => {
          chatBubblesRef.current = bubbles;
        },
      });
    }
    gl.disable(gl.BLEND);
  }

  frameMetricsRef.current.push({
    cpuMs: performance.now() - t0,
    drawCalls: batchStats.drawCalls,
    uploadBytes: 0,
    visibleChunks: sceneStateRef.current.visibleChunks.length,
  });
  scheduleNextFrame();
}
