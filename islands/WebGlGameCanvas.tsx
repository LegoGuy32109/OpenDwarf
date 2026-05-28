import { useEffect, useRef, useState } from "preact/hooks";
import type { FlowDescriptor, PerfWindow } from "../lib/webgl-harness-types.ts";
import {
  CHUNK_EDGE_TILES,
  chunkKeyString,
  chunkOfTile,
  computeCeilingShadowIds,
  computeStreamingChunks,
  computeVisibleChunks,
  FLOOR_FRAMES,
  SHADOW_FRAMES,
  shadowMaskToAtlasId,
  TILE_SIZE_PX,
  tileKeyString,
  updateChunkCache,
  updateFloorCache,
  Z_LEVELS_BELOW,
} from "../lib/webgl-chunk-gen.ts";
import {
  advanceWorldMovement,
  createWorldSim,
  entityRenderPosition,
  entityVisibilityPosition,
  generateWorldSolidChunk,
  isTileRemembered,
  isTileVisible,
  recomputeFov,
  startEntityMove,
  type Vec3i,
  type WorldSimState,
} from "../lib/webgl-world-sim.ts";
import {
  createVgaFontAtlas,
  VGA_FONT_SRC,
  type VgaFontAtlas,
} from "./webgl-ui-text-vga.ts";
import TILE_FRAGMENT_SHADER from "./webgl/shaders/tile.frag?raw";
import TILE_VERTEX_SHADER from "./webgl/shaders/tile.vert?raw";
import {
  browserVersionFromUserAgent,
  buildSceneHash,
  CAMERA_KEYS,
  CameraLookOffset,
  CEIL_SHADOW_TEXTURE_SRC,
  ChatBubbleRecord,
  computePerfWindow,
  createJsonBlob,
  createRunId,
  EDGE_SEGMENT_BAND_PX,
  EDGE_SEGMENT_DARK_ALPHA,
  EDGE_SEGMENT_LIGHT_ALPHA,
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
  SHADOW_ALPHA_MULTIPLIER,
  SHADOW_TEXTURE_SRC,
  STREAM_PADDING,
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
  getTileUniformLocations,
  readGpuStrings,
  uploadTexImage,
  uploadWhiteTexture,
} from "./webgl/gl-resources.ts";
import { flushInstanceBatch } from "./webgl/render-batch.ts";
import { renderVgaUi } from "./webgl/render-ui.ts";

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
  const frameDrawCallsRef = useRef(0);
  const frameInstancesRef = useRef(0);
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

  const openChat = (initialValue: string) => {
    uiModeRef.current = "chat";
    activeTypingRef.current = true;
    sceneStateRef.current.uiMode = "chat";
    sceneStateRef.current.chatBuffer = initialValue;
    if (initialValue.length > 0) {
      recordInputEvent({
        type: "text",
        value: initialValue,
        tick: simTickRef.current,
      });
    }
    appendLog(`chat open ${JSON.stringify(initialValue)}`);
  };

  const updateChatBuffer = (value: string) => {
    sceneStateRef.current.chatBuffer = value;
  };

  const deleteLastWord = (value: string) => {
    const trimmed = value.trimEnd();
    if (trimmed.length === 0) return "";
    const splitIndex = Math.max(
      trimmed.lastIndexOf(" "),
      trimmed.lastIndexOf("\t"),
      trimmed.lastIndexOf("\n"),
    );
    if (splitIndex < 0) return "";
    let nextValue = trimmed.slice(0, splitIndex + 1);
    if (nextValue.length > 0 && !nextValue.endsWith(" ")) {
      nextValue += " ";
    }
    return nextValue;
  };

  const handleChatSubmission = (input: string) => {
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return;
    }
    if (trimmed.startsWith("/")) {
      const command = trimmed.slice(1).toLowerCase();
      if (command === "master") {
        viewModeRef.current = "master";
        sceneStateRef.current.viewMode = "master";
        fovDirtyRef.current = true;
        topmostCacheDirtyRef.current = true;
        appendLog("chat command /master");
      } else if (command === "entity") {
        viewModeRef.current = "entity";
        sceneStateRef.current.viewMode = "entity";
        fovDirtyRef.current = true;
        topmostCacheDirtyRef.current = true;
        appendLog("chat command /entity");
      } else {
        appendLog(`chat command ignored /${command}`);
      }
      return;
    }

    const bubble: ChatBubbleRecord = {
      message: trimmed,
      target: { ...sceneStateRef.current.player },
      tick: simTickRef.current,
    };
    chatBubblesRef.current = [...chatBubblesRef.current, bubble].slice(-6);
    sceneStateRef.current.submittedChatMessages = [
      ...sceneStateRef.current.submittedChatMessages,
      trimmed,
    ].slice(-20);
    appendLog(`chat message ${JSON.stringify(trimmed)}`);
  };

  const worldPlayerSnapshot = (): PlayerState => {
    const pos = worldRef.current.entity.position;
    return { tileX: pos.x, tileY: pos.y, tileZ: pos.z };
  };

  const syncScenePlayerFromWorld = () => {
    const pos = worldRef.current.entity.position;
    if (
      pos.x !== sceneStateRef.current.player.tileX ||
      pos.y !== sceneStateRef.current.player.tileY ||
      pos.z !== sceneStateRef.current.player.tileZ
    ) {
      sceneStateRef.current.player = {
        tileX: pos.x,
        tileY: pos.y,
        tileZ: pos.z,
      };
      fovDirtyRef.current = true;
    }
  };

  const loadedChunkSet = () => new Set(solidCacheRef.current.keys());

  const closeChat = () => {
    uiModeRef.current = "world";
    activeTypingRef.current = false;
    sceneStateRef.current.uiMode = "world";
    sceneStateRef.current.chatBuffer = "";
    appendLog("chat close");
  };

  const submitChat = () => {
    const current = sceneStateRef.current.chatBuffer;
    handleChatSubmission(current);
    closeChat();
  };

  const processPlayerMovement = () => {
    if (uiModeRef.current === "chat") {
      playerKeysJustPressedRef.current.clear();
      return;
    }

    const isMoving = !!worldRef.current.entity.movement;
    const wasMoving = wasMovingLastTickRef.current;
    wasMovingLastTickRef.current = isMoving;
    const shouldChainHeld = wasMoving && !isMoving;

    // just-pressed: non-repeat keydowns since last tick, cleared after reading
    const jp = playerKeysJustPressedRef.current;
    const justPressedDir: Vec3i = {
      x: (jp.has("KeyS") && !jp.has("KeyF"))
        ? -1
        : (jp.has("KeyF") && !jp.has("KeyS"))
        ? 1
        : 0,
      y: (jp.has("KeyE") && !jp.has("KeyD"))
        ? -1
        : (jp.has("KeyD") && !jp.has("KeyE"))
        ? 1
        : 0,
      z: 0,
    };
    playerKeysJustPressedRef.current.clear();
    const justPressedNonZero = justPressedDir.x !== 0 || justPressedDir.y !== 0;

    // held direction
    const h = playerKeysHeldRef.current;
    const heldDir: Vec3i = {
      x: (h.has("KeyS") && !h.has("KeyF"))
        ? -1
        : (h.has("KeyF") && !h.has("KeyS"))
        ? 1
        : 0,
      y: (h.has("KeyE") && !h.has("KeyD"))
        ? -1
        : (h.has("KeyD") && !h.has("KeyE"))
        ? 1
        : 0,
      z: 0,
    };
    const heldNonZero = heldDir.x !== 0 || heldDir.y !== 0;

    const tryMove = (dir: Vec3i) => {
      const result = startEntityMove(worldRef.current, dir, loadedChunkSet());
      if (!result.ok && result.reason !== "moving") {
        appendLog(`move blocked: ${result.reason}`);
      }
    };

    if (!isMoving) {
      if (justPressedNonZero) {
        tryMove(justPressedDir);
      } else if (shouldChainHeld && heldNonZero) {
        tryMove(heldDir);
      }
    } else if (justPressedNonZero) {
      const mv = worldRef.current.entity.movement!;
      const activeDir: Vec3i = {
        x: Math.sign(mv.target.x - mv.origin.x),
        y: Math.sign(mv.target.y - mv.origin.y),
        z: 0,
      };
      // direction_contains: does heldDir contain activeDir?
      // Prevents interrupting e.g. north movement when user holds NE (NE contains N)
      const activeInHeld = (heldDir.x !== 0 || heldDir.y !== 0) &&
        (activeDir.x === 0 || Math.sign(heldDir.x) === activeDir.x) &&
        (activeDir.y === 0 || Math.sign(heldDir.y) === activeDir.y);
      const sameAsActive = justPressedDir.x === activeDir.x &&
        justPressedDir.y === activeDir.y;
      if (!sameAsActive && !activeInHeld) {
        tryMove(justPressedDir);
      }
    }
  };

  // deltaS: seconds since last frame. Must run every render frame, not per sim tick,
  // so camera movement stays smooth regardless of simulation TPS.
  const processCameraMovement = (deltaS: number) => {
    if (uiModeRef.current === "chat") return;
    const up = cameraKeysHeldRef.current.has("KeyI");
    const down = cameraKeysHeldRef.current.has("KeyK");
    const left = cameraKeysHeldRef.current.has("KeyJ");
    const right = cameraKeysHeldRef.current.has("KeyL");
    const step = cameraSpeedPxPerS * deltaS;

    if (viewModeRef.current === "entity") {
      const offset = cameraLookOffsetRef.current;
      let ox = offset.x;
      let oy = offset.y;
      if (up && !down) oy -= step;
      if (down && !up) oy += step;
      if (left && !right) ox -= step;
      if (right && !left) ox += step;
      if (!up && !down && !left && !right) {
        // Exponential return — CAMERA_RETURN_PER_TICK=0.08 was per 60fps frame,
        // equivalent decay constant k≈5 gives same feel at any frame rate.
        const returnRate = 1 - Math.exp(-5 * deltaS);
        ox += (0 - ox) * returnRate;
        oy += (0 - oy) * returnRate;
        if (Math.abs(ox) < 0.5) ox = 0;
        if (Math.abs(oy) < 0.5) oy = 0;
      }
      cameraLookOffsetRef.current = { x: ox, y: oy };
      // Camera position itself is set by the smooth-pos override in drawFrame;
      // we only need to keep the look offset up to date here.
      return;
    }

    if (!up && !down && !left && !right) return;
    const cam = sceneStateRef.current.camera;
    sceneStateRef.current.camera = {
      x: cam.x + (left && !right ? -step : right && !left ? step : 0),
      y: cam.y + (up && !down ? -step : down && !up ? step : 0),
      zoom: cam.zoom,
    };
  };

  const processVisibility = () => {
    if (viewModeRef.current !== "entity") {
      // Fix 5: only clear visible set if it was previously non-empty
      if (worldRef.current.visible.size > 0) {
        worldRef.current.visible = new Set();
        sceneStateRef.current.visibleTileCount = 0;
        sceneStateRef.current.rememberedTileCount =
          worldRef.current.memory.size;
      }
      return;
    }
    if (fovDirtyRef.current) {
      // Pass solidCacheRef as a fast O(1) lookup so recomputeFov avoids noise recomputation.
      // Returns undefined for uncached chunks; recomputeFov falls back to worldBlockAt.
      const solidCache = solidCacheRef.current;
      const solidCheck = (
        x: number,
        y: number,
        z: number,
      ): boolean | undefined => {
        const { chunkX, chunkY } = chunkOfTile(x, y);
        const key = `${chunkX},${chunkY},${z}`;
        const chunk = solidCache.get(key);
        if (!chunk) return undefined;
        const lx = ((x % CHUNK_EDGE_TILES) + CHUNK_EDGE_TILES) %
          CHUNK_EDGE_TILES;
        const ly = ((y % CHUNK_EDGE_TILES) + CHUNK_EDGE_TILES) %
          CHUNK_EDGE_TILES;
        return chunk[ly * CHUNK_EDGE_TILES + lx] !== 0;
      };
      recomputeFov(worldRef.current, solidCheck);
      fovDirtyRef.current = false;
      topmostCacheDirtyRef.current = true;
    }
    sceneStateRef.current.visibleTileCount = worldRef.current.visible.size;
    sceneStateRef.current.rememberedTileCount = worldRef.current.memory.size;
  };

  const buildStreamingChunkKeys = (currentViewZ: number) => {
    const viewport = sceneStateRef.current.viewport;
    const keys = computeStreamingChunks(
      sceneStateRef.current.camera,
      {
        framebufferWidth: viewport.framebufferWidth,
        framebufferHeight: viewport.framebufferHeight,
      },
      STREAM_PADDING,
    );
    if (viewModeRef.current === "entity") {
      const playerChunk = chunkOfTile(
        sceneStateRef.current.player.tileX,
        sceneStateRef.current.player.tileY,
      );
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          keys.push({
            chunkX: playerChunk.chunkX + dx,
            chunkY: playerChunk.chunkY + dy,
            chunkZ: currentViewZ,
          });
        }
      }
    }
    const deduped = new Map<
      string,
      { chunkX: number; chunkY: number; chunkZ: number }
    >();
    for (const key of keys) {
      deduped.set(chunkKeyString(key), key);
    }
    return [...deduped.values()];
  };

  const updateWorldSolidCache = (
    streamingXYKeys: Array<{ chunkX: number; chunkY: number }>,
    currentViewZ: number,
  ) => {
    const wanted = new Set<string>();
    const world = worldRef.current;
    const visibilityZ = entityVisibilityPosition(world.entity).z;
    const minZ = Math.min(currentViewZ - Z_LEVELS_BELOW, visibilityZ - 6);
    const maxZ = Math.max(currentViewZ + 1, visibilityZ + 6);
    for (const { chunkX, chunkY } of streamingXYKeys) {
      for (let z = minZ; z <= maxZ; z++) {
        wanted.add(chunkKeyString({ chunkX, chunkY, chunkZ: z }));
      }
    }

    for (const key of [...solidCacheRef.current.keys()]) {
      if (!wanted.has(key)) {
        solidCacheRef.current.delete(key);
      }
    }
    // Rebuild pending queue: drop no-longer-wanted keys, add newly missing ones.
    const pendingSet = new Set(pendingChunkGenerationRef.current);
    pendingChunkGenerationRef.current = pendingChunkGenerationRef.current
      .filter(
        (k) => wanted.has(k),
      );
    for (const key of wanted) {
      if (!solidCacheRef.current.has(key) && !pendingSet.has(key)) {
        pendingChunkGenerationRef.current.push(key);
      }
    }
  };

  const advanceSimulationTick = () => {
    simTickRef.current += 1;
    eventTickRef.current = simTickRef.current;
    worldRef.current.tick = simTickRef.current;
    simTicksThisSecondRef.current += 1;
    processPlayerMovement();
    advanceWorldMovement(worldRef.current);
    syncScenePlayerFromWorld();
    processVisibility();
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
          const player = worldPlayerSnapshot();
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

    const drawFrame = (timestamp = performance.now()) => {
      const t0 = performance.now();

      if (
        !glRef.current || !programRef.current || !textureRef.current ||
        !shadowTextureRef.current || !ceilShadowTextureRef.current
      ) {
        lastFrameTimeRef.current = timestamp;
        frameMetricsRef.current.push({
          cpuMs: performance.now() - t0,
          drawCalls: 0,
          uploadBytes: 0,
          visibleChunks: sceneStateRef.current.visibleChunks.length,
        });
        rafRef.current = globalThis.requestAnimationFrame(drawFrame);
        return;
      }

      const lastGl = lastFrameTimeRef.current;
      lastFrameTimeRef.current = timestamp;
      // Raw delta for FPS — not capped so background-resume spikes are visible/skippable.
      const rawDeltaMs = lastGl !== null ? timestamp - lastGl : 0;
      // Cap delta for simulation so a background tab can't spiral.
      const deltaMs = Math.min(rawDeltaMs, 100);

      // Simulation runs at 20 TPS (50ms/tick) — matching Rust's FixedUpdate schedule.
      // Input just_pressed events accumulate in playerKeysJustPressedRef across render
      // frames and are consumed once per simulation tick, exactly like Rust's command queue.
      const SIM_TICK_MS = 1000 / 20;
      simAccumulatorRef.current += deltaMs;
      // Cap to 3 ticks to prevent spiral of death on slow frames.
      let ticksThisFrame = 0;
      while (simAccumulatorRef.current >= SIM_TICK_MS && ticksThisFrame < 3) {
        advanceSimulationTick();
        simAccumulatorRef.current -= SIM_TICK_MS;
        ticksThisFrame++;
      }

      const deltaS = Math.min(deltaMs / 1000, 0.1);

      // Camera runs every frame — smooth panning regardless of sim TPS.
      processCameraMovement(deltaS);

      // Smooth player render position — mirrors Rust's smooth_player_render_transform.
      // Runs every render frame (not per sim tick) so the ease is frame-rate independent.
      const [spTargetX, spTargetY] = entityRenderPosition(
        worldRef.current.entity,
      );
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
        const seed = flowDescriptorRef.current.seed;
        const sfpGl =
          skGl.map((k) => chunkKeyString({ ...k, chunkZ: viewZ })).join("|") +
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

      // Drain up to 5 pending solid-chunk generations per frame to avoid startup stalls.
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
          // New solid data doesn't invalidate FOV — recomputeFov calls worldBlockAt directly.
          // FOV only re-runs when the player actually moves (syncScenePlayerFromWorld).
        }
      }

      // Part 2: FPS rolling average — use raw delta, skip first frame and resume spikes.
      {
        if (rawDeltaMs > 0 && rawDeltaMs < 250) {
          fpsHistoryRef.current.push(1000 / rawDeltaMs);
          if (fpsHistoryRef.current.length > 60) fpsHistoryRef.current.shift();
        }
      }
      // Part 2: sim TPS tracking — latch last complete second's count for stable display
      {
        const now = timestamp;
        if (now - simTickSecondStartRef.current >= 1000) {
          simTpsDisplayRef.current = simTicksThisSecondRef.current;
          simTicksThisSecondRef.current = 0;
          simTickSecondStartRef.current = now;
        }
      }

      const batchStats = { drawCalls: 0, instances: 0 };
      gl.useProgram(programRef.current);
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
      } = getTileUniformLocations(gl, programRef.current);

      if (canvasSizeLoc) {
        gl.uniform2f(canvasSizeLoc, canvas.width, canvas.height);
      }
      if (cameraLoc) {
        gl.uniform2f(
          cameraLoc,
          sceneStateRef.current.camera.x,
          sceneStateRef.current.camera.y,
        );
      }
      if (zoomLoc) {
        gl.uniform1f(zoomLoc, sceneStateRef.current.camera.zoom);
      }
      gl.activeTexture(gl.TEXTURE0);
      if (textureLoc) gl.uniform1i(textureLoc, 0);

      // Fix 8: uniform state tracking to avoid redundant gl calls
      let curRenderMode = -1,
        curTintR = -1,
        curTintG = -1,
        curTintB = -1,
        curAlpha = -1;
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
      // Fix 7: compute chunk key once per visible chunk
      const visibleChunkKeys = visibleXY
        .map((k) => ({ k, key: chunkKeyString({ ...k, chunkZ: viewZ }) }))
        .filter(({ key }) => chunkCacheRef.current.has(key));
      sceneStateRef.current.visibleChunks = visibleChunkKeys.map(({ key }) =>
        key
      );

      // Fix 2: only rebuild shadowVisibleXY when cache is dirty
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
      const drawOrderLabels: string[] = [
        "floor",
        "edgeShadow",
        "ceilingShadow",
      ];
      if (viewModeRef.current === "entity") {
        drawOrderLabels.push("fog");
      }
      drawOrderLabels.push("player", "chat", "ui");
      sceneStateRef.current.drawOrderLabels = drawOrderLabels;

      if (sceneReadyRef.current) {
        const HALF = TILE_SIZE_PX * 0.5;
        const INV_FLOOR = 1.0 / FLOOR_FRAMES;
        const INV_SHADOW = 1.0 / SHADOW_FRAMES;
        // Exact tint colors matching get_depth_tint_tile_color in render.rs
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
        // Stone tile atlas frame index (matches stone_tile_index() in Rust)
        const STONE_FRAME_UV = 5 * INV_FLOOR;

        // Helper: upload scratch[0..count*8] and draw instanced.
        const flushPass = (count: number) =>
          flushInstanceBatch(
            gl,
            instanceBufferRef.current!,
            scratch,
            count,
            batchStats,
          );

        // --- FLOOR PASSES: z = viewZ-Z_LEVELS_BELOW (back) → viewZ (front) ---
        // Pre-compute topmost visible solid z-offset per tile per chunk.
        // topmostOffset[idx] = z-offset (0 to -Z_LEVELS_BELOW) of topmost solid,
        // or 127 if no solid in the depth stack.
        // Fix 2: cache topmostOffsets — only recompute when dirty
        if (topmostCacheDirtyRef.current) {
          const topmostXY = new Map<
            string,
            { chunkX: number; chunkY: number }
          >();
          for (const vis of shadowVisibleXY) {
            for (
              const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as [
                number,
                number,
              ][]
            ) {
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
                  if (
                    renderSolidAt(vis.chunkX, vis.chunkY, tx, ty, viewZ + zo)
                  ) {
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
                      const tileState = visibilityState(
                        baseX + tx,
                        baseY + ty,
                        z,
                      );
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
                    scratch[off + 5] = STONE_FRAME_UV;
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
            if (entityMode) {
              drawFloorState("remembered", REMEMBERED_TINT, 0.95);
            }
          }
        }

        // --- EDGE SHADOW PASS ---
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

                const right = getTopmostOffset(
                  vis.chunkX,
                  vis.chunkY,
                  tx + 1,
                  ty,
                );
                if (right !== here) {
                  addVerticalShadow(
                    (baseX + tx + 1) * TILE_SIZE_PX,
                    (baseY + ty) * TILE_SIZE_PX,
                    right === 127 || right < here,
                  );
                }

                const down = getTopmostOffset(
                  vis.chunkX,
                  vis.chunkY,
                  tx,
                  ty + 1,
                );
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

        // --- CEILING SHADOW PASS ---
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
                    getTopmostOffset(
                        vis.chunkX,
                        vis.chunkY,
                        tx + dx,
                        ty + dy,
                      ) === 0 &&
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

        // --- MEMORY OVERLAY / PLAYER PASS ---
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
                  visibilityState(tileX, tileY, viewZ + zOffset) !==
                    "remembered"
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
                localSolidAt(
                  playerChunk.chunkX,
                  playerChunk.chunkY,
                  lx,
                  ly,
                  checkZ,
                )
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

        // --- VGA FONT PASS: chat input + spoken bubbles ---
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
            frameDrawCalls: frameDrawCallsRef.current,
            frameInstances: frameInstancesRef.current,
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

      frameDrawCallsRef.current = batchStats.drawCalls;
      frameInstancesRef.current = batchStats.instances;
      frameMetricsRef.current.push({
        cpuMs: performance.now() - t0,
        drawCalls: batchStats.drawCalls,
        uploadBytes: 0,
        visibleChunks: sceneStateRef.current.visibleChunks.length,
      });
      rafRef.current = globalThis.requestAnimationFrame(drawFrame);
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
      refreshCapability(gl, canvas, document.fullscreenElement);
      syncSceneStateFromCapability(canvas, document.fullscreenElement);
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
      if (uiModeRef.current === "chat") {
        event.preventDefault();
        recordInputEvent({
          type: "key_down",
          code: event.code,
          key: event.key,
          repeat: event.repeat,
          tick: simTickRef.current,
        });
        if (event.key === "Escape") {
          closeChat();
        } else if (event.key === "Enter") {
          submitChat();
        } else if (event.key === "Backspace") {
          const current = sceneStateRef.current.chatBuffer;
          const next = event.ctrlKey || event.shiftKey
            ? deleteLastWord(current)
            : current.slice(0, -1);
          updateChatBuffer(next);
        } else if (event.key.length === 1) {
          const next = `${sceneStateRef.current.chatBuffer}${event.key}`;
          updateChatBuffer(next);
          recordInputEvent({
            type: "text",
            value: event.key,
            tick: simTickRef.current,
          });
        }
        return;
      }

      if (event.key === "/" || event.code === "Slash") {
        event.preventDefault();
        recordInputEvent({
          type: "key_down",
          code: event.code,
          key: event.key,
          repeat: event.repeat,
          tick: simTickRef.current,
        });
        openChat("/");
        return;
      }

      if (event.code === "KeyT") {
        event.preventDefault();
        recordInputEvent({
          type: "key_down",
          code: event.code,
          key: event.key,
          repeat: event.repeat,
          tick: simTickRef.current,
        });
        openChat("");
        return;
      }

      recordInputEvent({
        type: "key_down",
        code: event.code,
        key: event.key,
        repeat: event.repeat,
        tick: simTickRef.current,
      });

      if (PLAYER_KEYS.has(event.code)) {
        event.preventDefault();
        playerKeysHeldRef.current.add(event.code);
        if (!event.repeat) {
          playerKeysJustPressedRef.current.add(event.code);
        }
      }
      if (CAMERA_KEYS.has(event.code)) {
        event.preventDefault();
        cameraKeysHeldRef.current.add(event.code);
      }
      if (event.code === "Digit1") {
        event.preventDefault();
        uiOverlayVisibleRef.current = !uiOverlayVisibleRef.current;
        setUiOverlayVisible(uiOverlayVisibleRef.current);
        appendLog(`ui: ${uiOverlayVisibleRef.current ? "on" : "off"}`);
      }
      if (event.code === "KeyR") {
        event.preventDefault();
        viewZ += 1;
        streamingKeySetRef.current = "";
        topmostCacheDirtyRef.current = true;
        appendLog(`z-level: ${viewZ}`);
      }
      if (event.code === "KeyV") {
        event.preventDefault();
        viewZ -= 1;
        streamingKeySetRef.current = "";
        topmostCacheDirtyRef.current = true;
        appendLog(`z-level: ${viewZ}`);
      }
      if (event.code === "KeyU" || event.code === "KeyM") {
        event.preventDefault();
        const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0];
        const cur = sceneStateRef.current.camera.zoom;
        const idx = ZOOM_LEVELS.reduce(
          (best, z, i) =>
            Math.abs(z - cur) < Math.abs(ZOOM_LEVELS[best] - cur) ? i : best,
          0,
        );
        const next = event.code === "KeyU"
          ? ZOOM_LEVELS[Math.max(0, idx - 1)]
          : ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, idx + 1)];
        sceneStateRef.current.camera = {
          ...sceneStateRef.current.camera,
          zoom: next,
        };
        appendLog(`zoom: ${next}`);
      }
      if (event.code === "Digit6") {
        event.preventDefault();
        layersRef.current = {
          ...layersRef.current,
          floor: !layersRef.current.floor,
        };
        setLayers({ ...layersRef.current });
        appendLog(`floor: ${layersRef.current.floor ? "on" : "off"}`);
      }
      if (event.code === "Digit7") {
        event.preventDefault();
        layersRef.current = {
          ...layersRef.current,
          edgeShadow: !layersRef.current.edgeShadow,
        };
        setLayers({ ...layersRef.current });
        appendLog(`edgeShadow: ${layersRef.current.edgeShadow ? "on" : "off"}`);
      }
      if (event.code === "Digit8") {
        event.preventDefault();
        layersRef.current = {
          ...layersRef.current,
          ceilShadow: !layersRef.current.ceilShadow,
        };
        setLayers({ ...layersRef.current });
        appendLog(
          `ceilShadow: ${layersRef.current.ceilShadow ? "on" : "off"}`,
        );
      }
      if (event.code === "Digit9") {
        event.preventDefault();
        layersRef.current = {
          ...layersRef.current,
          depthTint: !layersRef.current.depthTint,
        };
        setLayers({ ...layersRef.current });
        appendLog(`depthTint: ${layersRef.current.depthTint ? "on" : "off"}`);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      recordInputEvent({
        type: "key_up",
        code: event.code,
        key: event.key,
        tick: simTickRef.current,
      });
      keysHeldRef.current.delete(event.code);
      cameraKeysHeldRef.current.delete(event.code);
      playerKeysHeldRef.current.delete(event.code);
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
        const player = worldPlayerSnapshot();
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
    drawFrame();
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
