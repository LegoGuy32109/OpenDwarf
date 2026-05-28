import { useEffect, useRef, useState } from "preact/hooks";
import type { FlowDescriptor, PerfWindow } from "../lib/webgl-harness-types.ts";
import {
  CHUNK_EDGE_TILES,
  chunkKeyString,
  computeVisibleChunks,
  TILE_SIZE_PX,
  updateChunkCache,
  updateFloorCache,
} from "../lib/webgl-chunk-gen.ts";
import {
  createWorldSim,
  type WorldSimState,
} from "../lib/webgl-world-sim.ts";
import {
  advanceSimulationTick as advanceSimulationTickRuntime,
  buildStreamingChunkKeys as buildStreamingChunkKeysRuntime,
  processCameraMovement as processCameraMovementRuntime,
  processPlayerMovement as processPlayerMovementRuntime,
  processVisibility as processVisibilityRuntime,
  syncScenePlayerFromWorld as syncScenePlayerFromWorldRuntime,
  updateWorldSolidCache as updateWorldSolidCacheRuntime,
  worldPlayerSnapshot as worldPlayerSnapshotRuntime,
} from "./webgl/world-runtime.ts";
import { createInputController } from "./webgl/input-controller.ts";
import {
  createVgaFontAtlas,
  VGA_FONT_SRC,
  type VgaFontAtlas,
} from "./webgl-ui-text-vga.ts";
import {
  browserVersionFromUserAgent,
  buildSceneHash,
  CameraLookOffset,
  CEIL_SHADOW_TEXTURE_SRC,
  ChatBubbleRecord,
  computePerfWindow,
  createJsonBlob,
  createRunId,
  FLOW_NAME,
  FrameMetric,
  hashJson,
  InputLogEvent,
  makeArtifactFilename,
  makeStateFilename,
  MAX_STREAMING_CHUNKS,
  PLAYER_KEYS,
  PLAYER_TEXTURE_SRC,
  PlayerState,
  ReplayDocument,
  ReplayEvent,
  ReplayPreview,
  SEED_NAME,
  SHADOW_TEXTURE_SRC,
  summarizeReplay,
  TILE_TEXTURE_SRC,
  waitForAnimationFrame,
  WebGlArtifactManifest,
  WebGlCapabilityReport,
  WebGlCheckpointRecord,
  WebGlExportBundleData,
  WebGlSceneSnapshot,
  WebGlScreenshotBaselineManifest,
  WebGlTestHarness,
  WebGlUiMode,
  WebGlViewMode,
} from "./webgl/webgl-core.ts";
import {
  createAtlasTexture,
  createInstancedQuadBuffers,
  createProgram,
  readGpuStrings,
  uploadTexImage,
  uploadWhiteTexture,
} from "./webgl/gl-resources.ts";
import { renderWebGlFrame } from "./webgl/render-loop.ts";
import {
  TILE_FRAGMENT_SHADER,
  TILE_VERTEX_SHADER,
} from "./webgl/shaders.ts";

declare global {
  var __openDwarfWebGlHarness: WebGlTestHarness | undefined;
}
let cameraSpeedPxPerS = 480;

export default function WebGlGameCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rafRef = useRef<number | null>(null);
  const logIdRef = useRef(0);
  const eventTickRef = useRef(0);
  const frameRef = useRef(0);
  const runIdRef = useRef(createRunId());
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const textureRef = useRef<WebGLTexture | null>(null);
  const shadowTextureRef = useRef<WebGLTexture | null>(null);
  const ceilShadowTextureRef = useRef<WebGLTexture | null>(null);
  const vgaFontAtlasRef = useRef<VgaFontAtlas | null>(null);
  const instanceBufferRef = useRef<WebGLBuffer | null>(null);
  const vertexBufferRef = useRef<WebGLBuffer | null>(null);
  const solidCacheRef = useRef<Map<string, Uint8Array>>(new Map());
  const pendingChunkGenerationRef = useRef<string[]>([]);
  const layersRef = useRef({
    floor: true,
    edgeShadow: true,
    ceilShadow: true,
    depthTint: true,
  });
  const sceneReadyRef = useRef(false);
  const capabilityRef = useRef<WebGlCapabilityReport | null>(null);
  const baselineManifestRef = useRef<WebGlScreenshotBaselineManifest | null>(
    null,
  );
  const checkpointsRef = useRef<WebGlCheckpointRecord[]>([]);
  const sceneStateRef = useRef({
    camera: { x: 0, y: 0, zoom: 1 },
    player: { tileX: 0, tileY: 0, tileZ: 0 } as PlayerState,
    viewMode: "entity" as WebGlViewMode,
    uiMode: "world" as WebGlUiMode,
    fullscreen: false,
    viewport: {
      cssWidth: 0,
      cssHeight: 0,
      devicePixelRatio: 1,
      framebufferWidth: 0,
      framebufferHeight: 0,
    },
    visibleChunks: [] as string[],
    streamingChunks: [] as string[],
    residentChunks: 0,
    assetsLoaded: [] as string[],
    chatBuffer: "",
    submittedChatMessages: [] as string[],
    visibleTileCount: 0,
    rememberedTileCount: 0,
    drawOrderLabels: [] as string[],
  });
  const screenshotArtifactsRef = useRef<Record<string, Blob>>({});
  const stateArtifactsRef = useRef<Record<string, Blob>>({});
  const frameMetricsRef = useRef<FrameMetric[]>([]);
  const chunkCacheRef = useRef<Map<string, Uint16Array>>(new Map());
  const worldRef = useRef<WorldSimState>(createWorldSim(SEED_NAME));
  const inputLogRef = useRef<InputLogEvent[]>([]);
  const textureInfoRef = useRef<
    { src: string; width: number; height: number } | null
  >(null);
  const keysHeldRef = useRef<Set<string>>(new Set());
  const cameraKeysHeldRef = useRef<Set<string>>(new Set());
  const playerKeysHeldRef = useRef<Set<string>>(new Set());
  const playerKeysJustPressedRef = useRef<Set<string>>(new Set());
  const wasMovingLastTickRef = useRef(false);
  const smoothPlayerWorldPosRef = useRef<[number, number] | null>(null);
  const simAccumulatorRef = useRef(0);
  const streamingKeySetRef = useRef<string>("");
  const lastFrameTimeRef = useRef<number | null>(null);
  const simTickRef = useRef(0);
  const cameraLookOffsetRef = useRef<CameraLookOffset>({ x: 0, y: 0 });
  const chatBubblesRef = useRef<ChatBubbleRecord[]>([]);
  const activeTypingRef = useRef(false);
  const viewModeRef = useRef<WebGlViewMode>("entity");
  const uiModeRef = useRef<WebGlUiMode>("world");
  // Fix 1: FOV dirty flag — recompute only when position or view mode changes
  const fovDirtyRef = useRef(true);
  // Fix 2: topmostOffsets cache
  const topmostOffsetsCacheRef = useRef<Map<string, Int8Array>>(new Map());
  const shadowVisibleXYCacheRef = useRef<
    Array<{ chunkX: number; chunkY: number }>
  >([]);
  const topmostCacheDirtyRef = useRef(true);
  // Part 2 perf metrics
  const fpsHistoryRef = useRef<number[]>([]);
  const simTicksThisSecondRef = useRef(0);
  const simTickSecondStartRef = useRef(0);
  const simTpsDisplayRef = useRef(0);
  const flowDescriptorRef = useRef<FlowDescriptor>({
    name: FLOW_NAME,
    seed: SEED_NAME,
    camera: { x: 0, y: 0, zoom: 1 },
  });
  const replayEventsRef = useRef<ReplayEvent[]>([]);
  const uiOverlayVisibleRef = useRef(false);
  const statusRef = useRef("booting");
  const fullscreenRef = useRef(false);
  const capabilityStateRef = useRef<WebGlCapabilityReport | null>(null);
  const logsRef = useRef<string[]>([]);
  const replayPreviewRef = useRef<ReplayPreview>(summarizeReplay([]));
  const checkpointRecordsRef = useRef<WebGlCheckpointRecord[]>([]);
  const baselineConfiguredRef = useRef(false);
  const playerTextureInfoRef = useRef<
    { src: string; width: number; height: number } | null
  >(null);
  const playerTextureRef = useRef<WebGLTexture | null>(null);
  const whiteTextureRef = useRef<WebGLTexture | null>(null);

  const [_status, setStatus] = useState("booting");
  const [_fullscreen, setFullscreen] = useState(false);
  const [_capability, setCapability] = useState<WebGlCapabilityReport | null>(
    null,
  );
  const [_logs, setLogs] = useState<string[]>([]);
  const [_replayPreview, setReplayPreview] = useState<ReplayPreview>(
    summarizeReplay([]),
  );
  const [_checkpointRecords, setCheckpointRecords] = useState<
    WebGlCheckpointRecord[]
  >([]);
  const [_baselineConfigured, setBaselineConfigured] = useState(false);
  const [_importedReplayInfo, setImportedReplayInfo] = useState<string | null>(
    null,
  );
  const [_layers, setLayers] = useState({
    floor: true,
    edgeShadow: true,
    ceilShadow: true,
    depthTint: true,
  });
  const [_uiOverlayVisible, setUiOverlayVisible] = useState(false);

  const appendLog = (text: string) => {
    const id = logIdRef.current++;
    const next = `${String(id).padStart(3, "0")} ${text}`;
    logsRef.current = [next, ...logsRef.current].slice(0, 10);
    setLogs(logsRef.current);
  };

  const syncScenePlayerFromWorld = () =>
    syncScenePlayerFromWorldRuntime(
      worldRef,
      sceneStateRef,
      fovDirtyRef,
    );

  const processPlayerMovement = () =>
    processPlayerMovementRuntime({
      worldRef,
      sceneStateRef,
      solidCacheRef,
      pendingChunkGenerationRef,
      playerKeysHeldRef,
      playerKeysJustPressedRef,
      cameraKeysHeldRef,
      wasMovingLastTickRef,
      cameraLookOffsetRef,
      fovDirtyRef,
      topmostCacheDirtyRef,
      streamingKeySetRef,
      viewModeRef,
      uiModeRef,
      simTickRef,
      eventTickRef,
      simTicksThisSecondRef,
      simTickSecondStartRef,
      appendLog,
    });

  const processCameraMovement = (deltaS: number) =>
    processCameraMovementRuntime(deltaS, {
      uiModeRef,
      viewModeRef,
      cameraKeysHeldRef,
      cameraLookOffsetRef,
      sceneStateRef,
      cameraSpeedPxPerS,
    });

  const processVisibility = () =>
    processVisibilityRuntime({
      worldRef,
      sceneStateRef,
      viewModeRef,
      fovDirtyRef,
      solidCacheRef,
      topmostCacheDirtyRef,
    });

  const buildStreamingChunkKeys = (currentViewZ: number) =>
    buildStreamingChunkKeysRuntime(sceneStateRef, viewModeRef, currentViewZ);

  const updateWorldSolidCache = (
    streamingXYKeys: Array<{ chunkX: number; chunkY: number }>,
    currentViewZ: number,
  ) =>
    updateWorldSolidCacheRuntime(
      worldRef,
      solidCacheRef,
      pendingChunkGenerationRef,
      streamingXYKeys,
      currentViewZ,
    );

  const advanceSimulationTick = () =>
    advanceSimulationTickRuntime({
      simTickRef,
      eventTickRef,
      simTicksThisSecondRef,
      worldRef,
      processPlayerMovement,
      processVisibility,
      syncScenePlayerFromWorld,
    });

  const pushReplayEvent = (event: ReplayEvent) => {
    replayEventsRef.current = [...replayEventsRef.current, event];
    replayPreviewRef.current = summarizeReplay(replayEventsRef.current);
    setReplayPreview(replayPreviewRef.current);
  };

  const setStatusText = (next: string) => {
    statusRef.current = next;
    setStatus(next);
  };

  const setFullscreenState = (next: boolean) => {
    fullscreenRef.current = next;
    setFullscreen(next);
  };

  const setCheckpointRecordsState = (next: WebGlCheckpointRecord[]) => {
    checkpointRecordsRef.current = next;
    setCheckpointRecords(next);
  };

  const setBaselineConfiguredState = (next: boolean) => {
    baselineConfiguredRef.current = next;
    setBaselineConfigured(next);
  };

  const nextTick = () => {
    return simTickRef.current;
  };

  const refreshCapability = (
    gl: WebGL2RenderingContext,
    canvas: HTMLCanvasElement,
    fullscreenElement: Element | null,
  ) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = globalThis.devicePixelRatio || 1;
    const maxViewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;

    const nextCapability: WebGlCapabilityReport = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      devicePixelRatio: dpr,
      innerSize: {
        width: globalThis.innerWidth,
        height: globalThis.innerHeight,
      },
      screenSize: {
        width: globalThis.screen.width,
        height: globalThis.screen.height,
      },
      maxTouchPoints: navigator.maxTouchPoints ?? null,
      fullscreen: fullscreenElement === hostRef.current,
      canvasCssSize: { width: rect.width, height: rect.height },
      framebufferSize: { width: canvas.width, height: canvas.height },
      context: {
        webgl2: true,
        version: String(gl.getParameter(gl.VERSION)),
        shadingLanguageVersion: String(
          gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        ),
        ...readGpuStrings(gl),
        maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
        maxViewportDims: [maxViewportDims[0], maxViewportDims[1]],
      },
    };
    setCapability(nextCapability);
    capabilityRef.current = nextCapability;
    capabilityStateRef.current = nextCapability;
  };

  const syncSceneStateFromCapability = (
    canvas: HTMLCanvasElement,
    fullscreenElement: Element | null,
  ) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = globalThis.devicePixelRatio || 1;
    sceneStateRef.current.fullscreen = fullscreenElement === hostRef.current;
    sceneStateRef.current.viewport = {
      cssWidth: rect.width,
      cssHeight: rect.height,
      devicePixelRatio: dpr,
      framebufferWidth: canvas.width,
      framebufferHeight: canvas.height,
    };
  };

  const buildSceneSnapshot = async (
    perf: PerfWindow,
  ): Promise<WebGlSceneSnapshot> => {
    const snapshotBase = {
      tick: simTickRef.current,
      frame: frameRef.current,
      seed: flowDescriptorRef.current.seed,
      camera: sceneStateRef.current.camera,
      player: sceneStateRef.current.player,
      viewMode: sceneStateRef.current.viewMode,
      uiMode: sceneStateRef.current.uiMode,
      fullscreen: sceneStateRef.current.fullscreen,
      viewport: sceneStateRef.current.viewport,
      visibleChunks: sceneStateRef.current.visibleChunks,
      streamingChunks: sceneStateRef.current.streamingChunks,
      residentChunks: sceneStateRef.current.residentChunks,
      assetsLoaded: sceneStateRef.current.assetsLoaded,
      chatBuffer: sceneStateRef.current.chatBuffer,
      submittedChatMessages: sceneStateRef.current.submittedChatMessages,
      visibleTileCount: sceneStateRef.current.visibleTileCount,
      rememberedTileCount: sceneStateRef.current.rememberedTileCount,
      drawOrderLabels: sceneStateRef.current.drawOrderLabels,
    };
    return {
      ...snapshotBase,
      sceneHash: await buildSceneHash(snapshotBase),
      perf,
    };
  };

  const buildReplayDocument = (): ReplayDocument => ({
    version: 1,
    flow: FLOW_NAME,
    scene: FLOW_NAME,
    seed: SEED_NAME,
    viewport: {
      width: sceneStateRef.current.viewport.cssWidth,
      height: sceneStateRef.current.viewport.cssHeight,
      devicePixelRatio: sceneStateRef.current.viewport.devicePixelRatio,
    },
    capture: {
      fullscreenRequired: true,
      screenshots: true,
      video: false,
    },
    createdAt: new Date().toISOString(),
    capability: capabilityRef.current,
    events: replayEventsRef.current,
    checkpoints: checkpointsRef.current,
  });

  const buildArtifactManifest = (): WebGlArtifactManifest => ({
    version: 1,
    flow: FLOW_NAME,
    runId: runIdRef.current,
    createdAt: new Date().toISOString(),
    browser: {
      name: "Chrome",
      version: browserVersionFromUserAgent(navigator.userAgent),
      userAgent: navigator.userAgent,
      platform: navigator.platform ?? null,
    },
    renderer: {
      webgl2: Boolean(glRef.current),
      renderer: capabilityRef.current?.context.renderer ?? null,
      vendor: capabilityRef.current?.context.vendor ?? null,
    },
    baseline: {
      configured: Boolean(baselineManifestRef.current),
      source: baselineManifestRef.current
        ? "in-memory-baseline-manifest"
        : null,
    },
    checkpoints: checkpointsRef.current,
  });

  const captureCanvasBlob = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    await waitForAnimationFrame();
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
  };

  const captureCheckpoint = async (name: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const perf = computePerfWindow(frameMetricsRef.current);
    frameMetricsRef.current = [];

    const blob = await captureCanvasBlob();
    if (!blob) return null;

    const ordinal = checkpointsRef.current.length;
    const screenshotFilename = makeArtifactFilename(ordinal, name, "png");
    const stateFilename = makeStateFilename(ordinal, name);
    const snapshot = await buildSceneSnapshot(perf);
    const statePayload = {
      ...snapshot,
      checkpoint: name,
      ordinal,
      screenshotFilename,
    };
    const stateHash = await hashJson(statePayload);
    const baselineSource =
      baselineManifestRef.current?.screenshots[name]?.path ??
        null;
    const record: WebGlCheckpointRecord = {
      name,
      ordinal,
      tick: snapshot.tick,
      frame: snapshot.frame,
      camera: snapshot.camera,
      viewMode: snapshot.viewMode,
      uiMode: snapshot.uiMode,
      player: snapshot.player,
      chatBuffer: snapshot.chatBuffer,
      screenshotFilename,
      stateFilename,
      stateHash,
      baselineConfigured: Boolean(baselineSource),
      baselineSource,
      perf,
      visibleChunks: snapshot.visibleChunks,
      residentChunks: snapshot.residentChunks,
      visibleTileCount: snapshot.visibleTileCount,
      rememberedTileCount: snapshot.rememberedTileCount,
      drawOrderLabels: snapshot.drawOrderLabels,
    };

    checkpointsRef.current = [...checkpointsRef.current, record];
    setCheckpointRecordsState(checkpointsRef.current);
    screenshotArtifactsRef.current[screenshotFilename] = blob;
    stateArtifactsRef.current[stateFilename] = createJsonBlob(statePayload);
    pushReplayEvent({
      type: "checkpoint",
      tick: nextTick(),
      name,
      frame: snapshot.frame,
      screenshotFilename,
      stateFilename,
      stateHash,
      baselineConfigured: Boolean(baselineSource),
    });
    pushReplayEvent({
      type: "screenshot",
      tick: nextTick(),
      filename: screenshotFilename,
      bytes: blob.size,
    });
    appendLog(
      `checkpoint ${name} -> ${screenshotFilename} (${blob.size} bytes)`,
    );
    if (baselineSource) {
      appendLog(`baseline configured for ${name}: ${baselineSource}`);
    }
    return record;
  };

  const importReplayDocument = (doc: ReplayDocument) => {
    if (doc.version !== 1 || doc.flow !== FLOW_NAME) {
      throw new Error("Unsupported replay document");
    }

    replayEventsRef.current = doc.events ?? [];
    checkpointsRef.current = doc.checkpoints ?? [];
    replayPreviewRef.current = summarizeReplay(replayEventsRef.current);
    setReplayPreview(replayPreviewRef.current);
    setCheckpointRecordsState(checkpointsRef.current);
    setImportedReplayInfo(
      `${doc.createdAt} | ${replayEventsRef.current.length} events | ${checkpointsRef.current.length} checkpoints`,
    );
    logsRef.current = replayEventsRef.current.slice(-10).map((entry, index) =>
      `${String(index).padStart(3, "0")} ${JSON.stringify(entry)}`
    ).reverse();
    setLogs(logsRef.current);
    appendLog(`imported replay ${doc.createdAt}`);
  };

  const exportBundleData = async (): Promise<WebGlExportBundleData> => {
    const replay = buildReplayDocument();
    const manifest = buildArtifactManifest();
    const screenshots = await Promise.all(
      Object.entries(screenshotArtifactsRef.current).map(async (
        [filename, blob],
      ) => ({
        filename,
        dataUrl: await blobToDataUrl(blob),
      })),
    );
    const states = await Promise.all(
      Object.entries(stateArtifactsRef.current).map(async (
        [filename, blob],
      ) => ({
        filename,
        dataUrl: await blobToDataUrl(blob),
      })),
    );

    return {
      replayJson: JSON.stringify(replay, null, 2),
      manifestJson: JSON.stringify(manifest, null, 2),
      frames: screenshots,
      screenshots,
      states,
    };
  };

  const setBaselineManifest = (
    manifest: WebGlScreenshotBaselineManifest | null,
  ) => {
    baselineManifestRef.current = manifest;
    setBaselineConfiguredState(Boolean(manifest));
    appendLog(
      manifest ? "baseline manifest configured" : "baseline manifest cleared",
    );
  };

  const blobToDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () =>
        reject(reader.error ?? new Error("Failed to read blob"));
      reader.readAsDataURL(blob);
    });

  const setCamera = async (x: number, y: number, zoom = 1) => {
    sceneStateRef.current.camera = { x, y, zoom };
    appendLog(`camera ${x.toFixed(1)},${y.toFixed(1)} z${zoom.toFixed(2)}`);
    await waitForAnimationFrame();
  };

  const setPlayerState = async (
    tileX: number,
    tileY: number,
    tileZ = sceneStateRef.current.player.tileZ,
  ) => {
    worldRef.current.entity.position = { x: tileX, y: tileY, z: tileZ };
    worldRef.current.entity.movement = null;
    sceneStateRef.current.player = { tileX, tileY, tileZ };
    fovDirtyRef.current = true;
    topmostCacheDirtyRef.current = true;
    appendLog(`player ${tileX},${tileY},${tileZ}`);
    await waitForAnimationFrame();
  };

  const setViewModeState = async (mode: WebGlViewMode) => {
    viewModeRef.current = mode;
    sceneStateRef.current.viewMode = mode;
    fovDirtyRef.current = true;
    topmostCacheDirtyRef.current = true;
    appendLog(`viewMode ${mode}`);
    await waitForAnimationFrame();
  };

  const recordReplayEvent = (event: ReplayEvent) => {
    replayEventsRef.current = [...replayEventsRef.current, event];
    replayPreviewRef.current = summarizeReplay(replayEventsRef.current);
    setReplayPreview(replayPreviewRef.current);
  };

  const recordInputEvent = (event: InputLogEvent) => {
    inputLogRef.current = [...inputLogRef.current, event];
    recordReplayEvent(event);
  };

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    canvas.tabIndex = 0;
    canvas.style.touchAction = "none";

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
      stencil: false,
      premultipliedAlpha: false,
    }) as WebGL2RenderingContext | null;

    if (!gl) {
      const fallbackContext = canvas.getContext("2d", {
        alpha: false,
        desynchronized: true,
        willReadFrequently: false,
      });
      if (!fallbackContext) {
        setStatusText("canvas2d unavailable");
        setCapability({
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          hardwareConcurrency: navigator.hardwareConcurrency ?? null,
          devicePixelRatio: globalThis.devicePixelRatio || 1,
          innerSize: {
            width: globalThis.innerWidth,
            height: globalThis.innerHeight,
          },
          screenSize: {
            width: globalThis.screen.width,
            height: globalThis.screen.height,
          },
          maxTouchPoints: navigator.maxTouchPoints ?? null,
          fullscreen: false,
          canvasCssSize: { width: 0, height: 0 },
          framebufferSize: { width: 0, height: 0 },
          context: {
            webgl2: false,
            version: null,
            shadingLanguageVersion: null,
            renderer: null,
            vendor: null,
            maxTextureSize: null,
            maxViewportDims: null,
          },
        });
        return () => {};
      }

      fallbackContext.imageSmoothingEnabled = false;
      setStatusText("canvas2d fallback active");
      setCapability({
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        devicePixelRatio: globalThis.devicePixelRatio || 1,
        innerSize: {
          width: globalThis.innerWidth,
          height: globalThis.innerHeight,
        },
        screenSize: {
          width: globalThis.screen.width,
          height: globalThis.screen.height,
        },
        maxTouchPoints: navigator.maxTouchPoints ?? null,
        fullscreen: false,
        canvasCssSize: { width: 0, height: 0 },
        framebufferSize: { width: 0, height: 0 },
        context: {
          webgl2: false,
          version: "canvas2d-fallback",
          shadingLanguageVersion: null,
          renderer: "canvas2d-fallback",
          vendor: null,
          maxTextureSize: null,
          maxViewportDims: null,
        },
      });
      capabilityRef.current = {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        devicePixelRatio: globalThis.devicePixelRatio || 1,
        innerSize: {
          width: globalThis.innerWidth,
          height: globalThis.innerHeight,
        },
        screenSize: {
          width: globalThis.screen.width,
          height: globalThis.screen.height,
        },
        maxTouchPoints: navigator.maxTouchPoints ?? null,
        fullscreen: false,
        canvasCssSize: { width: 0, height: 0 },
        framebufferSize: { width: 0, height: 0 },
        context: {
          webgl2: false,
          version: "canvas2d-fallback",
          shadingLanguageVersion: null,
          renderer: "canvas2d-fallback",
          vendor: null,
          maxTextureSize: null,
          maxViewportDims: null,
        },
      };

      const fallbackImage = new Image();
      fallbackImage.decoding = "async";

      const drawFrame = (timestamp = performance.now()) => {
        const t0 = performance.now();
        frameRef.current += 1;

        const last2d = lastFrameTimeRef.current ?? timestamp;
        const dt2d = Math.min(timestamp - last2d, 100) / 1000;
        lastFrameTimeRef.current = timestamp;

        const cam2d = sceneStateRef.current.camera;
        const step2d = cameraSpeedPxPerS * dt2d;
        let dx2d = 0, dy2d = 0;
        const k2d = keysHeldRef.current;
        if (k2d.has("KeyE") || k2d.has("KeyI")) dy2d -= step2d;
        if (k2d.has("KeyD") || k2d.has("KeyK")) dy2d += step2d;
        if (k2d.has("KeyS") || k2d.has("KeyJ")) dx2d -= step2d;
        if (k2d.has("KeyF") || k2d.has("KeyL")) dx2d += step2d;
        if (dx2d !== 0 || dy2d !== 0) {
          sceneStateRef.current.camera = {
            x: cam2d.x + dx2d,
            y: cam2d.y + dy2d,
            zoom: cam2d.zoom,
          };
        }

        if (sceneReadyRef.current) {
          const sk2d = buildStreamingChunkKeys(viewZ);
          const sfp2d = sk2d.map(chunkKeyString).join("|");
          if (sfp2d !== streamingKeySetRef.current) {
            streamingKeySetRef.current = sfp2d;
            updateChunkCache(
              chunkCacheRef.current,
              flowDescriptorRef.current.seed,
              sk2d,
            );
            sceneStateRef.current.residentChunks = chunkCacheRef.current.size;
            sceneStateRef.current.streamingChunks = [
              ...chunkCacheRef.current.keys(),
            ];
          }
        }

        fallbackContext.fillStyle = "#14161c";
        fallbackContext.fillRect(0, 0, canvas.width, canvas.height);

        sceneStateRef.current.visibleChunks = computeVisibleChunks(
          sceneStateRef.current.camera,
          { framebufferWidth: canvas.width, framebufferHeight: canvas.height },
        )
          .filter((k) => chunkCacheRef.current.has(chunkKeyString(k)))
          .map(chunkKeyString);

        if (sceneReadyRef.current) {
          const image = fallbackImage.complete ? fallbackImage : null;
          if (image) {
            for (const keyStr of chunkCacheRef.current.keys()) {
              const parts = keyStr.split(",");
              const cx = parseInt(parts[0]);
              const cy = parseInt(parts[1]);
              for (let ty = 0; ty < CHUNK_EDGE_TILES; ty++) {
                for (let tx = 0; tx < CHUNK_EDGE_TILES; tx++) {
                  const worldX = (cx * CHUNK_EDGE_TILES + tx) * TILE_SIZE_PX;
                  const worldY = (cy * CHUNK_EDGE_TILES + ty) * TILE_SIZE_PX;
                  const screenX = worldX - sceneStateRef.current.camera.x +
                    canvas.width * 0.5;
                  const screenY = worldY - sceneStateRef.current.camera.y +
                    canvas.height * 0.5;
                  if (
                    screenX + TILE_SIZE_PX < 0 || screenX > canvas.width ||
                    screenY + TILE_SIZE_PX < 0 || screenY > canvas.height
                  ) {
                    continue;
                  }
                  fallbackContext.drawImage(
                    image,
                    screenX,
                    screenY,
                    TILE_SIZE_PX,
                    TILE_SIZE_PX,
                  );
                }
              }
            }
          }
        }

        frameMetricsRef.current.push({
          cpuMs: performance.now() - t0,
          drawCalls: 0,
          uploadBytes: 0,
          visibleChunks: sceneStateRef.current.visibleChunks.length,
        });
        rafRef.current = globalThis.requestAnimationFrame(drawFrame);
      };

      const resizeCanvas = () => {
        const rect = host.getBoundingClientRect();
        const dpr = globalThis.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(rect.width * dpr));
        const height = Math.max(1, Math.round(rect.height * dpr));

        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;

        fallbackContext.imageSmoothingEnabled = false;
        setCapability({
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          hardwareConcurrency: navigator.hardwareConcurrency ?? null,
          devicePixelRatio: dpr,
          innerSize: {
            width: globalThis.innerWidth,
            height: globalThis.innerHeight,
          },
          screenSize: {
            width: globalThis.screen.width,
            height: globalThis.screen.height,
          },
          maxTouchPoints: navigator.maxTouchPoints ?? null,
          fullscreen: document.fullscreenElement === host,
          canvasCssSize: { width: rect.width, height: rect.height },
          framebufferSize: { width, height },
          context: {
            webgl2: false,
            version: "canvas2d-fallback",
            shadingLanguageVersion: null,
            renderer: "canvas2d-fallback",
            vendor: null,
            maxTextureSize: null,
            maxViewportDims: null,
          },
        });
        capabilityRef.current = {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          hardwareConcurrency: navigator.hardwareConcurrency ?? null,
          devicePixelRatio: dpr,
          innerSize: {
            width: globalThis.innerWidth,
            height: globalThis.innerHeight,
          },
          screenSize: {
            width: globalThis.screen.width,
            height: globalThis.screen.height,
          },
          maxTouchPoints: navigator.maxTouchPoints ?? null,
          fullscreen: document.fullscreenElement === host,
          canvasCssSize: { width: rect.width, height: rect.height },
          framebufferSize: { width, height },
          context: {
            webgl2: false,
            version: "canvas2d-fallback",
            shadingLanguageVersion: null,
            renderer: "canvas2d-fallback",
            vendor: null,
            maxTextureSize: null,
            maxViewportDims: null,
          },
        };
        syncSceneStateFromCapability(canvas, document.fullscreenElement);
        pushReplayEvent({
          type: "resize",
          tick: nextTick(),
          cssWidth: rect.width,
          cssHeight: rect.height,
          dpr,
          framebufferWidth: width,
          framebufferHeight: height,
        });
        appendLog(
          `resize ${Math.round(rect.width)}x${Math.round(rect.height)} @ ${
            dpr.toFixed(2)
          }x`,
        );
        // RAF loop is already running — no need to force a frame here.
      };

      const loadRockTexture = async () => {
        const image = new Image();
        image.decoding = "async";
        image.src = TILE_TEXTURE_SRC;
        await image.decode();
        fallbackImage.src = TILE_TEXTURE_SRC;
        textureInfoRef.current = {
          src: TILE_TEXTURE_SRC,
          width: image.naturalWidth,
          height: image.naturalHeight,
        };
        pushReplayEvent({
          type: "texture_loaded",
          tick: nextTick(),
          src: TILE_TEXTURE_SRC,
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
        appendLog(
          `texture ${TILE_TEXTURE_SRC} ${image.naturalWidth}x${image.naturalHeight}`,
        );
        const sk2dLoad = buildStreamingChunkKeys(viewZ);
        const cache2d = new Map<string, Uint16Array>();
        updateChunkCache(cache2d, flowDescriptorRef.current.seed, sk2dLoad);
        chunkCacheRef.current = cache2d;
        streamingKeySetRef.current = sk2dLoad.map(chunkKeyString).join("|");
        setStatusText("SingleRock texture ready");
        sceneReadyRef.current = true;
        sceneStateRef.current.assetsLoaded = [
          ...sceneStateRef.current.assetsLoaded,
          TILE_TEXTURE_SRC,
        ];
        sceneStateRef.current.residentChunks = cache2d.size;
        sceneStateRef.current.streamingChunks = [...cache2d.keys()];
        sceneStateRef.current.uiMode = "world";
        // RAF loop picks up sceneReadyRef.current = true on the next tick.
      };

      const handleFullscreenChange = () => {
        keysHeldRef.current.clear();
        cameraKeysHeldRef.current.clear();
        playerKeysHeldRef.current.clear();
        lastFrameTimeRef.current = null;
        const isFullscreen = document.fullscreenElement === host;
        setFullscreenState(isFullscreen);
        sceneStateRef.current.fullscreen = isFullscreen;
        pushReplayEvent({
          type: "fullscreen",
          tick: nextTick(),
          active: isFullscreen,
        });
        appendLog(isFullscreen ? "fullscreen enter" : "fullscreen exit");
        resizeCanvas();
      };

      const handlePointerDown = () => {
        canvas.focus();
      };

      const handleBlur = () => {
        keysHeldRef.current.clear();
        cameraKeysHeldRef.current.clear();
        playerKeysHeldRef.current.clear();
      };

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "F11") {
          event.preventDefault();
          if (document.fullscreenElement === host) {
            void document.exitFullscreen();
          } else {
            void host.requestFullscreen();
          }
        }
        if (event.key === "Escape" && document.fullscreenElement === host) {
          event.preventDefault();
          void document.exitFullscreen();
        }
        if (PLAYER_KEYS.has(event.code)) {
          event.preventDefault();
          keysHeldRef.current.add(event.code);
        }
      };

      const handleKeyUp = (event: KeyboardEvent) => {
        keysHeldRef.current.delete(event.code);
      };

      const resizeObserver = new ResizeObserver(() => resizeCanvas());
      resizeObserver.observe(host);
      globalThis.addEventListener("resize", resizeCanvas);
      globalThis.addEventListener("keydown", handleKeyDown);
      globalThis.addEventListener("keyup", handleKeyUp);
      globalThis.addEventListener("blur", handleBlur);
      canvas.addEventListener("pointerdown", handlePointerDown);
      document.addEventListener("fullscreenchange", handleFullscreenChange);

      const harness: WebGlTestHarness = {
        loadFlow: (descriptor: FlowDescriptor) => {
          if (descriptor.name !== FLOW_NAME) {
            throw new Error(`Unsupported flow: ${descriptor.name}`);
          }
          flowDescriptorRef.current = descriptor;
          const cam = descriptor.camera ?? { x: 0, y: 0, zoom: 1 };
          worldRef.current = createWorldSim(descriptor.seed);
          smoothPlayerWorldPosRef.current = null;
          simAccumulatorRef.current = 0;
          const player = worldPlayerSnapshotRuntime(worldRef.current);
          sceneStateRef.current.camera = {
            x: cam.x,
            y: cam.y,
            zoom: cam.zoom ?? 1,
          };
          sceneStateRef.current.player = player;
          sceneStateRef.current.viewMode = "entity";
          sceneStateRef.current.uiMode = "world";
          sceneStateRef.current.chatBuffer = "";
          sceneStateRef.current.submittedChatMessages = [];
          sceneStateRef.current.visibleTileCount = 0;
          sceneStateRef.current.rememberedTileCount = 0;
          sceneStateRef.current.drawOrderLabels = [];
          replayEventsRef.current = [];
          inputLogRef.current = [];
          checkpointsRef.current = [];
          solidCacheRef.current.clear();
          pendingChunkGenerationRef.current = [];
          screenshotArtifactsRef.current = {};
          stateArtifactsRef.current = {};
          frameMetricsRef.current = [];
          eventTickRef.current = 0;
          simTickRef.current = 0;
          frameRef.current = 0;
          lastFrameTimeRef.current = null;
          setCheckpointRecordsState([]);
          replayPreviewRef.current = summarizeReplay([]);
          setReplayPreview(replayPreviewRef.current);
          setImportedReplayInfo(null);
          keysHeldRef.current.clear();
          cameraKeysHeldRef.current.clear();
          playerKeysHeldRef.current.clear();
          cameraLookOffsetRef.current = { x: 0, y: 0 };
          chatBubblesRef.current = [];
          activeTypingRef.current = false;
          viewModeRef.current = "entity";
          uiModeRef.current = "world";
          streamingKeySetRef.current = "";
          fovDirtyRef.current = true;
          topmostCacheDirtyRef.current = true;
          if (sceneReadyRef.current) {
            const sk2dFlow = buildStreamingChunkKeys(viewZ);
            const cache2dFlow = new Map<string, Uint16Array>();
            updateChunkCache(cache2dFlow, descriptor.seed, sk2dFlow);
            chunkCacheRef.current = cache2dFlow;
            streamingKeySetRef.current = sk2dFlow.map(chunkKeyString).join("|");
            sceneStateRef.current.residentChunks = cache2dFlow.size;
            sceneStateRef.current.streamingChunks = [...cache2dFlow.keys()];
            if (textureInfoRef.current) {
              pushReplayEvent({
                type: "texture_loaded",
                tick: nextTick(),
                ...textureInfoRef.current,
              });
            }
          }
          pushReplayEvent({ type: "boot", tick: nextTick() });
          appendLog(`load flow ${descriptor.name} seed=${descriptor.seed}`);
        },
        stepTick: async (n: number) => {
          for (let i = 0; i < n; i++) {
            await waitForAnimationFrame();
          }
        },
        captureCheckpoint,
        setCamera,
        setPlayer: setPlayerState,
        setViewMode: setViewModeState,
        setCameraSpeed: (pxPerS: number) => {
          cameraSpeedPxPerS = pxPerS;
        },
        exportReplay: buildReplayDocument,
        exportBundleData,
        importReplay: importReplayDocument,
        setScreenshotBaselineManifest: setBaselineManifest,
        getManifest: buildArtifactManifest,
      };
      globalThis.__openDwarfWebGlHarness = harness;

      resizeCanvas();
      drawFrame();
      pushReplayEvent({ type: "boot", tick: nextTick() });
      appendLog("boot");
      void loadRockTexture().catch((error) => {
        setStatusText(`texture load failed: ${String(error)}`);
        appendLog(`texture load failed: ${String(error)}`);
      });

      return () => {
        resizeObserver.disconnect();
        globalThis.removeEventListener("resize", resizeCanvas);
        globalThis.removeEventListener("keydown", handleKeyDown);
        globalThis.removeEventListener("keyup", handleKeyUp);
        globalThis.removeEventListener("blur", handleBlur);
        canvas.removeEventListener("pointerdown", handlePointerDown);
        document.removeEventListener(
          "fullscreenchange",
          handleFullscreenChange,
        );
        if (globalThis.__openDwarfWebGlHarness === harness) {
          delete globalThis.__openDwarfWebGlHarness;
        }
        if (rafRef.current !== null) {
          globalThis.cancelAnimationFrame(rafRef.current);
        }
      };
    }

    glRef.current = gl;

    const program = createProgram(gl, TILE_VERTEX_SHADER, TILE_FRAGMENT_SHADER);
    programRef.current = program;

    // Instance data: 8 floats per tile (worldX, worldY, sizeW, sizeH, uvX, uvY, uvW, uvH)
    const maxInstances = MAX_STREAMING_CHUNKS * CHUNK_EDGE_TILES *
      CHUNK_EDGE_TILES;
    // Pre-allocated scratch buffer reused for every draw pass
    const scratch = new Float32Array(maxInstances * 8);

    const { vertexBuffer, instanceBuffer } = createInstancedQuadBuffers(
      gl,
      program,
      maxInstances,
    );
    vertexBufferRef.current = vertexBuffer;
    instanceBufferRef.current = instanceBuffer;

    // Create all atlas textures
    const floorTex = createAtlasTexture(gl);
    const shadowTex = createAtlasTexture(gl);
    const ceilShadowTex = createAtlasTexture(gl);
    const playerTex = createAtlasTexture(gl);
    const whiteTex = createAtlasTexture(gl);
    textureRef.current = floorTex;
    shadowTextureRef.current = shadowTex;
    ceilShadowTextureRef.current = ceilShadowTex;
    whiteTextureRef.current = whiteTex;

    let viewZ = 0;

    const inputHandlers = createInputController({
      hostRef,
      canvasRef,
      sceneStateRef,
      uiModeRef,
      viewModeRef,
      activeTypingRef,
      chatBubblesRef,
      playerKeysHeldRef,
      playerKeysJustPressedRef,
      cameraKeysHeldRef,
      keysHeldRef,
      uiOverlayVisibleRef,
      layersRef,
      fovDirtyRef,
      topmostCacheDirtyRef,
      getViewZ: () => viewZ,
      setViewZ: (next: number) => {
        viewZ = next;
        streamingKeySetRef.current = "";
        topmostCacheDirtyRef.current = true;
      },
      simTickRef,
      setLayers: (next) => {
        layersRef.current = next;
        setLayers(next);
      },
      setUiOverlayVisible: (next) => {
        uiOverlayVisibleRef.current = next;
        setUiOverlayVisible(next);
      },
      appendLog,
      recordInputEvent,
      setImportedReplayInfo,
      importReplayDocument,
      setFullscreenState,
    });

    const scheduleNextFrame = () => {
      rafRef.current = globalThis.requestAnimationFrame(renderFrame);
    };

    function renderFrame() {
      void renderWebGlFrame({
        gl: gl!,
        program: programRef.current!,
        canvas: canvas!,
        scratch,
        maxInstances,
        instanceBuffer: instanceBufferRef.current!,
        viewZ,
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
        wasMovingLastTickRef,
        textureRef,
        shadowTextureRef,
        ceilShadowTextureRef,
        playerTextureRef,
        whiteTextureRef,
        playerTextureInfoRef,
        vgaFontAtlasRef,
        textureInfoRef,
        capabilityStateRef,
        replayPreviewRef,
        checkpointRecordsRef,
        logsRef,
        chatBubblesRef,
        uiOverlayVisibleRef,
        getViewZ: () => viewZ,
        buildStreamingChunkKeys,
        updateWorldSolidCache,
        processCameraMovement,
        advanceSimulationTick,
        scheduleNextFrame,
      });
    }

    const loadTextures = async () => {
      const loadImg = (src: string) => {
        const img = new Image();
        img.decoding = "async";
        img.src = src;
        return img.decode().then(() => img);
      };
      const [floorImg, shadowImg, ceilImg, playerImg] = await Promise.all([
        loadImg(TILE_TEXTURE_SRC),
        loadImg(SHADOW_TEXTURE_SRC),
        loadImg(CEIL_SHADOW_TEXTURE_SRC),
        loadImg(PLAYER_TEXTURE_SRC),
      ]);

      uploadTexImage(gl, floorTex, floorImg);
      uploadTexImage(gl, shadowTex, shadowImg);
      uploadTexImage(gl, ceilShadowTex, ceilImg);
      uploadTexImage(gl, playerTex, playerImg);
      uploadWhiteTexture(gl, whiteTex);
      playerTextureRef.current = playerTex;
      playerTextureInfoRef.current = {
        src: PLAYER_TEXTURE_SRC,
        width: playerImg.naturalWidth,
        height: playerImg.naturalHeight,
      };
      try {
        vgaFontAtlasRef.current = await createVgaFontAtlas(gl);
      } catch (error) {
        vgaFontAtlasRef.current = null;
        appendLog(`VGA bitmap font unavailable: ${String(error)}`);
      }

      textureInfoRef.current = {
        src: TILE_TEXTURE_SRC,
        width: floorImg.naturalWidth,
        height: floorImg.naturalHeight,
      };
      pushReplayEvent({
        type: "texture_loaded",
        tick: nextTick(),
        src: TILE_TEXTURE_SRC,
        width: floorImg.naturalWidth,
        height: floorImg.naturalHeight,
      });
      appendLog(
        `texture ${TILE_TEXTURE_SRC} ${floorImg.naturalWidth}x${floorImg.naturalHeight}`,
      );
      appendLog(
        `texture ${PLAYER_TEXTURE_SRC} ${playerImg.naturalWidth}x${playerImg.naturalHeight}`,
      );

      const skLoad = buildStreamingChunkKeys(viewZ);
      const seed = flowDescriptorRef.current.seed;

      chunkCacheRef.current = new Map();
      updateFloorCache(chunkCacheRef.current, seed, skLoad, viewZ);
      updateWorldSolidCache(skLoad, viewZ);

      streamingKeySetRef.current = skLoad.map((k) =>
        chunkKeyString({ ...k, chunkZ: viewZ })
      ).join("|") +
        `|z${viewZ}`;
      setStatusText("depth stack ready");
      sceneReadyRef.current = true;
      sceneStateRef.current.assetsLoaded = [
        TILE_TEXTURE_SRC,
        SHADOW_TEXTURE_SRC,
        CEIL_SHADOW_TEXTURE_SRC,
        PLAYER_TEXTURE_SRC,
        VGA_FONT_SRC,
      ];
      sceneStateRef.current.residentChunks = skLoad.length;
      sceneStateRef.current.streamingChunks = skLoad.map((k) =>
        chunkKeyString({ ...k, chunkZ: viewZ })
      );
      sceneStateRef.current.uiMode = "world";
      // RAF loop picks up sceneReadyRef.current = true on the next tick.
    };

    const resizeCanvas = () => {
      const rect = host.getBoundingClientRect();
      const dpr = globalThis.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));

      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;

      gl.viewport(0, 0, width, height);
      refreshCapability(gl, canvas, document.fullscreenElement);
      syncSceneStateFromCapability(canvas, document.fullscreenElement);
      pushReplayEvent({
        type: "resize",
        tick: nextTick(),
        cssWidth: rect.width,
        cssHeight: rect.height,
        dpr,
        framebufferWidth: width,
        framebufferHeight: height,
      });
      appendLog(
        `resize ${Math.round(rect.width)}x${Math.round(rect.height)} @ ${
          dpr.toFixed(2)
        }x`,
      );
      // RAF loop is already running — no need to force a frame here.
    };

    const handleFullscreenChange = () => {
      inputHandlers.handleFullscreenChange();
      refreshCapability(gl, canvas, document.fullscreenElement);
      syncSceneStateFromCapability(canvas, document.fullscreenElement);
      resizeCanvas();
    };

    const handlePointerDown = inputHandlers.handlePointerDown;
    const handleBlur = inputHandlers.handleBlur;
    const handleKeyDown = inputHandlers.handleKeyDown;
    const handleKeyUp = inputHandlers.handleKeyUp;

    const resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(host);
    globalThis.addEventListener("resize", resizeCanvas);
    globalThis.addEventListener("keydown", handleKeyDown);
    globalThis.addEventListener("keyup", handleKeyUp);
    globalThis.addEventListener("blur", handleBlur);
    canvas.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    const harness: WebGlTestHarness = {
      loadFlow: (descriptor: FlowDescriptor) => {
        if (descriptor.name !== FLOW_NAME) {
          throw new Error(`Unsupported flow: ${descriptor.name}`);
        }
        flowDescriptorRef.current = descriptor;
        const cam = descriptor.camera ?? { x: 0, y: 0, zoom: 1 };
        worldRef.current = createWorldSim(descriptor.seed);
        const player = worldPlayerSnapshotRuntime(worldRef.current);
        sceneStateRef.current.camera = {
          x: cam.x,
          y: cam.y,
          zoom: cam.zoom ?? 1,
        };
        sceneStateRef.current.player = player;
        sceneStateRef.current.viewMode = "entity";
        sceneStateRef.current.uiMode = "world";
        sceneStateRef.current.chatBuffer = "";
        sceneStateRef.current.submittedChatMessages = [];
        sceneStateRef.current.visibleTileCount = 0;
        sceneStateRef.current.rememberedTileCount = 0;
        sceneStateRef.current.drawOrderLabels = [];
        replayEventsRef.current = [];
        inputLogRef.current = [];
        checkpointsRef.current = [];
        solidCacheRef.current.clear();
        pendingChunkGenerationRef.current = [];
        screenshotArtifactsRef.current = {};
        stateArtifactsRef.current = {};
        frameMetricsRef.current = [];
        eventTickRef.current = 0;
        simTickRef.current = 0;
        frameRef.current = 0;
        lastFrameTimeRef.current = null;
        setCheckpointRecordsState([]);
        replayPreviewRef.current = summarizeReplay([]);
        setReplayPreview(replayPreviewRef.current);
        setImportedReplayInfo(null);
        keysHeldRef.current.clear();
        cameraKeysHeldRef.current.clear();
        playerKeysHeldRef.current.clear();
        cameraLookOffsetRef.current = { x: 0, y: 0 };
        chatBubblesRef.current = [];
        activeTypingRef.current = false;
        viewModeRef.current = "entity";
        uiModeRef.current = "world";
        streamingKeySetRef.current = "";
        fovDirtyRef.current = true;
        topmostCacheDirtyRef.current = true;
        if (sceneReadyRef.current) {
          const skFlow = buildStreamingChunkKeys(viewZ);
          const seed = descriptor.seed;
          chunkCacheRef.current = new Map();
          updateFloorCache(chunkCacheRef.current, seed, skFlow, viewZ);
          updateWorldSolidCache(skFlow, viewZ);
          streamingKeySetRef.current = skFlow.map((k) =>
            chunkKeyString({ ...k, chunkZ: viewZ })
          ).join("|") + `|z${viewZ}`;
          sceneStateRef.current.residentChunks = skFlow.length;
          sceneStateRef.current.streamingChunks = skFlow.map((k) =>
            chunkKeyString({ ...k, chunkZ: viewZ })
          );
          if (textureInfoRef.current) {
            pushReplayEvent({
              type: "texture_loaded",
              tick: nextTick(),
              ...textureInfoRef.current,
            });
          }
        }
        pushReplayEvent({ type: "boot", tick: nextTick() });
        appendLog(`load flow ${descriptor.name} seed=${descriptor.seed}`);
      },
      stepTick: async (n: number) => {
        for (let i = 0; i < n; i++) {
          await waitForAnimationFrame();
        }
      },
      captureCheckpoint,
      setCamera,
      setPlayer: setPlayerState,
      setViewMode: setViewModeState,
      setCameraSpeed: (pxPerS: number) => {
        cameraSpeedPxPerS = pxPerS;
      },
      exportReplay: buildReplayDocument,
      exportBundleData,
      importReplay: importReplayDocument,
      setScreenshotBaselineManifest: setBaselineManifest,
      getManifest: buildArtifactManifest,
    };
    globalThis.__openDwarfWebGlHarness = harness;

    resizeCanvas();
    renderFrame();
    pushReplayEvent({ type: "boot", tick: nextTick() });
    appendLog("boot");
    void loadTextures().catch((error) => {
      setStatusText(`texture load failed: ${String(error)}`);
      appendLog(`texture load failed: ${String(error)}`);
    });

    return () => {
      resizeObserver.disconnect();
      globalThis.removeEventListener("resize", resizeCanvas);
      globalThis.removeEventListener("keydown", handleKeyDown);
      globalThis.removeEventListener("keyup", handleKeyUp);
      globalThis.removeEventListener("blur", handleBlur);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      if (globalThis.__openDwarfWebGlHarness === harness) {
        delete globalThis.__openDwarfWebGlHarness;
      }
      if (rafRef.current !== null) {
        globalThis.cancelAnimationFrame(rafRef.current);
      }
      glRef.current = null;
      programRef.current = null;
      textureRef.current = null;
      shadowTextureRef.current = null;
      ceilShadowTextureRef.current = null;
      playerTextureRef.current = null;
      whiteTextureRef.current = null;
      instanceBufferRef.current = null;
      vertexBufferRef.current = null;
      sceneReadyRef.current = false;
    };
  }, []);

  const handleReplayFileInputChange = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ReplayDocument;
      if (
        parsed.version !== 1 || parsed.flow !== FLOW_NAME ||
        parsed.scene !== FLOW_NAME
      ) {
        throw new Error("Unsupported replay document");
      }

      importReplayDocument(parsed);
    } catch (error) {
      setImportedReplayInfo(
        `import failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      if (input) input.value = "";
    }
  };

  return (
    <div
      ref={hostRef}
      class="webgl-experiment-shell relative overflow-hidden rounded-[18px] border border-white/10 bg-[#0e1015] shadow-[0_28px_90px_rgba(0,0,0,0.5)]"
    >
      <style>
        {`
          .webgl-experiment-shell:fullscreen {
            width: 100vw;
            height: 100vh;
            border-radius: 0;
          }

          .webgl-experiment-shell:fullscreen .webgl-experiment-canvas {
            width: 100vw;
            height: 100vh;
            border-radius: 0;
          }

          .webgl-experiment-canvas {
            display: block;
            width: 100%;
            height: 74vh;
            outline: none;
          }
        `}
      </style>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        class="hidden"
        onChange={handleReplayFileInputChange}
      />
      <canvas
        ref={canvasRef}
        class="webgl-experiment-canvas"
      />
    </div>
  );
}
