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
  createUiFontAtlas,
  drawUiTextLines,
  UI_FONT_SRC,
  type UiFontAtlas,
  uiTextLineHeight,
} from "./webgl-ui-text.ts";

declare global {
  var __openDwarfWebGlHarness: WebGlTestHarness | undefined;
}

type WebGlCapabilityReport = {
  userAgent: string;
  platform: string;
  hardwareConcurrency: number | null;
  devicePixelRatio: number;
  innerSize: { width: number; height: number };
  screenSize: { width: number; height: number };
  maxTouchPoints: number | null;
  fullscreen: boolean;
  canvasCssSize: { width: number; height: number };
  framebufferSize: { width: number; height: number };
  context: {
    webgl2: boolean;
    version: string | null;
    shadingLanguageVersion: string | null;
    renderer: string | null;
    vendor: string | null;
    maxTextureSize: number | null;
    maxViewportDims: [number, number] | null;
  };
};

type ReplayEvent =
  | {
    type: "boot";
    tick: number;
  }
  | {
    type: "key_down";
    code: string;
    key: string;
    repeat: boolean;
    tick: number;
  }
  | { type: "key_up"; code: string; key: string; tick: number }
  | { type: "text"; value: string; tick: number }
  | {
    type: "resize";
    tick: number;
    cssWidth: number;
    cssHeight: number;
    dpr: number;
    framebufferWidth: number;
    framebufferHeight: number;
  }
  | {
    type: "fullscreen";
    tick: number;
    active: boolean;
  }
  | {
    type: "texture_loaded";
    tick: number;
    src: string;
    width: number;
    height: number;
  }
  | {
    type: "screenshot";
    tick: number;
    filename: string;
    bytes: number;
  }
  | {
    type: "checkpoint";
    tick: number;
    name: string;
    frame: number;
    screenshotFilename: string;
    stateFilename: string;
    stateHash: string;
    baselineConfigured: boolean;
  };

type FrameMetric = {
  cpuMs: number;
  drawCalls: number;
  uploadBytes: number;
  visibleChunks: number;
};

type WebGlViewMode = "entity" | "master";
type WebGlUiMode = "world" | "chat";

type InputLogEvent =
  | {
    type: "key_down";
    code: string;
    key: string;
    repeat: boolean;
    tick: number;
  }
  | { type: "key_up"; code: string; key: string; tick: number }
  | { type: "text"; value: string; tick: number }
  | { type: "fullscreen"; active: boolean; tick: number }
  | {
    type: "resize";
    cssWidth: number;
    cssHeight: number;
    dpr: number;
    framebufferWidth: number;
    framebufferHeight: number;
    tick: number;
  };

type PlayerState = {
  tileX: number;
  tileY: number;
  tileZ: number;
};

type ChatBubbleRecord = {
  message: string;
  target: PlayerState;
  tick: number;
};

type CameraLookOffset = {
  x: number;
  y: number;
};

type WebGlSceneSnapshot = {
  tick: number;
  frame: number;
  seed: string;
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
  sceneHash: string;
  perf: PerfWindow;
};

type WebGlCheckpointRecord = {
  name: string;
  ordinal: number;
  tick: number;
  frame: number;
  camera: { x: number; y: number; zoom: number };
  viewMode: WebGlViewMode;
  uiMode: WebGlUiMode;
  player: PlayerState;
  chatBuffer: string;
  screenshotFilename: string;
  stateFilename: string;
  stateHash: string;
  baselineConfigured: boolean;
  baselineSource: string | null;
  perf: PerfWindow;
  visibleChunks: string[];
  residentChunks: number;
  visibleTileCount: number;
  rememberedTileCount: number;
  drawOrderLabels: string[];
};

type WebGlScreenshotBaselineManifest = {
  version: 1;
  flow: string;
  screenshots: Record<string, { path: string; sha256?: string }>;
};

type ReplayDocument = {
  version: 1;
  flow: "webgl-step1-single-rock";
  scene: "webgl-step1-single-rock";
  seed: string;
  viewport: {
    width: number;
    height: number;
    devicePixelRatio: number;
  };
  capture: {
    fullscreenRequired: boolean;
    screenshots: boolean;
    video: boolean;
  };
  createdAt: string;
  capability: WebGlCapabilityReport | null;
  events: ReplayEvent[];
  checkpoints: WebGlCheckpointRecord[];
};

type ReplayPreview = {
  eventCount: number;
  checkpointCount: number;
  lastResize: ReplayEvent | null;
  fullscreenActive: boolean;
  textureCount: number;
  screenshotCount: number;
};

type WebGlArtifactManifest = {
  version: 1;
  flow: "webgl-step1-single-rock";
  runId: string;
  createdAt: string;
  browser: {
    name: string;
    version: string | null;
    userAgent: string;
    platform: string | null;
  };
  renderer: {
    webgl2: boolean;
    renderer: string | null;
    vendor: string | null;
  };
  baseline: {
    configured: boolean;
    source: string | null;
  };
  checkpoints: WebGlCheckpointRecord[];
};

type WebGlSerializableArtifact = {
  filename: string;
  dataUrl: string;
};

type WebGlExportBundleData = {
  replayJson: string;
  manifestJson: string;
  frames: WebGlSerializableArtifact[];
  screenshots: WebGlSerializableArtifact[];
  states: WebGlSerializableArtifact[];
};

type WebGlTestHarness = {
  loadFlow: (descriptor: FlowDescriptor) => void;
  stepTick: (n: number) => Promise<void>;
  captureCheckpoint: (name: string) => Promise<WebGlCheckpointRecord | null>;
  setCamera: (x: number, y: number, zoom?: number) => Promise<void>;
  setPlayer: (tileX: number, tileY: number, tileZ?: number) => Promise<void>;
  setViewMode: (mode: WebGlViewMode) => Promise<void>;
  setCameraSpeed: (pxPerS: number) => void;
  exportReplay: () => ReplayDocument;
  exportBundleData: () => Promise<WebGlExportBundleData>;
  importReplay: (doc: ReplayDocument) => void;
  setScreenshotBaselineManifest: (
    manifest: WebGlScreenshotBaselineManifest | null,
  ) => void;
  getManifest: () => WebGlArtifactManifest;
};

const FLOW_NAME = "webgl-step1-single-rock";
const SEED_NAME = "single-rock-step1";
const TILE_TEXTURE_SRC = "/assets/sprites/StackedTextures.png";
const PLAYER_TEXTURE_SRC = "/assets/sprites/Dwarf_16x16.png";
const SHADOW_TEXTURE_SRC = "/assets/atlases/ShadowAtlas.png";
const CEIL_SHADOW_TEXTURE_SRC = "/assets/atlases/ObscureAtlas.png";
const SHADOW_ALPHA_MULTIPLIER = 0.55;
const EDGE_SEGMENT_DARK_ALPHA = 0.28;
const EDGE_SEGMENT_LIGHT_ALPHA = 0.11;
const EDGE_SEGMENT_BAND_PX = 4;
let cameraSpeedPxPerS = 480;
const CAMERA_RETURN_PER_TICK = 0.08;
const CHAT_BUBBLE_VISIBLE_TICKS = Math.round(5.0 * 60);
const CHAT_BUBBLE_FADE_IN_TICKS = Math.round(0.2 * 60);
const CHAT_BUBBLE_FADE_OUT_TICKS = Math.round(0.4 * 60);
const STREAM_PADDING = 1;
const MAX_STREAMING_CHUNKS = 64;
const PLAYER_KEYS = new Set([
  "KeyE",
  "KeyS",
  "KeyD",
  "KeyF",
]);
const CAMERA_KEYS = new Set([
  "KeyI",
  "KeyJ",
  "KeyK",
  "KeyL",
]);

function createRunId() {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const entropy = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
    .toString(16)
    .padStart(8, "0");
  return `${stamp}__${entropy}`;
}

function slugifyName(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(
    /_+/g,
    "_",
  ).replace(/^_|_$/g, "");
}

function makeArtifactFilename(
  ordinal: number,
  name: string,
  extension: string,
) {
  return `${FLOW_NAME}__${String(ordinal).padStart(3, "0")}__${
    slugifyName(name)
  }.${extension}`;
}

function makeStateFilename(ordinal: number, name: string) {
  return `${FLOW_NAME}__${String(ordinal).padStart(3, "0")}__${
    slugifyName(name)
  }.json`;
}

function browserVersionFromUserAgent(userAgent: string) {
  const chromeMatch = userAgent.match(/Chrome\/([0-9.]+)/);
  if (chromeMatch) return chromeMatch[1];
  const firefoxMatch = userAgent.match(/Firefox\/([0-9.]+)/);
  if (firefoxMatch) return firefoxMatch[1];
  const safariMatch = userAgent.match(/Version\/([0-9.]+).*Safari\//);
  if (safariMatch) return safariMatch[1];
  return null;
}

async function hashJson(value: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `sha256:${bytes}`;
}

function createJsonBlob(value: unknown) {
  return new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json;charset=utf-8",
  });
}

function buildSceneHash(
  snapshot: Omit<WebGlSceneSnapshot, "sceneHash" | "perf">,
) {
  return hashJson(snapshot);
}

function computePerfWindow(metrics: FrameMetric[]): PerfWindow {
  if (metrics.length === 0) {
    return {
      frames: 0,
      cpuMs: { p50: 0, p95: 0, max: 0 },
      drawCalls: { p50: 0, p95: 0, max: 0 },
      uploadBytes: 0,
    };
  }
  const sortedAsc = (arr: number[]) => [...arr].sort((a, b) => a - b);
  const percentile = (sorted: number[], pct: number) =>
    sorted[Math.min(Math.floor(sorted.length * pct), sorted.length - 1)];

  const cpuSorted = sortedAsc(metrics.map((m) => m.cpuMs));
  const dcSorted = sortedAsc(metrics.map((m) => m.drawCalls));

  return {
    frames: metrics.length,
    cpuMs: {
      p50: percentile(cpuSorted, 0.5),
      p95: percentile(cpuSorted, 0.95),
      max: cpuSorted[cpuSorted.length - 1],
    },
    drawCalls: {
      p50: percentile(dcSorted, 0.5),
      p95: percentile(dcSorted, 0.95),
      max: dcSorted[dcSorted.length - 1],
    },
    uploadBytes: metrics.reduce((s, m) => s + m.uploadBytes, 0),
  };
}

function waitForAnimationFrame() {
  return new Promise<void>((resolve) => {
    globalThis.requestAnimationFrame(() => resolve());
  });
}

function readGpuStrings(gl: WebGL2RenderingContext) {
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info") as
    | {
      UNMASKED_RENDERER_WEBGL: number;
      UNMASKED_VENDOR_WEBGL: number;
    }
    | undefined;

  return {
    renderer: debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
      : null,
    vendor: debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL))
      : null,
  };
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to create shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? "unknown shader compile error";
    gl.deleteShader(shader);
    throw new Error(info);
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
) {
  const program = gl.createProgram();
  if (!program) {
    throw new Error("Failed to create program");
  }

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? "unknown link error";
    gl.deleteProgram(program);
    throw new Error(info);
  }

  return program;
}

function summarizeReplay(events: ReplayEvent[]): ReplayPreview {
  let lastResize: ReplayEvent | null = null;
  let fullscreenActive = false;
  let textureCount = 0;
  let screenshotCount = 0;
  let checkpointCount = 0;

  for (const event of events) {
    if (event.type === "resize") {
      lastResize = event;
    } else if (event.type === "fullscreen") {
      fullscreenActive = event.active;
    } else if (event.type === "texture_loaded") {
      textureCount += 1;
    } else if (event.type === "screenshot") {
      screenshotCount += 1;
    } else if (event.type === "checkpoint") {
      checkpointCount += 1;
    }
  }

  return {
    eventCount: events.length,
    checkpointCount,
    lastResize,
    fullscreenActive,
    textureCount,
    screenshotCount,
  };
}

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
  const uiFontAtlasRef = useRef<UiFontAtlas | null>(null);
  const instanceBufferRef = useRef<WebGLBuffer | null>(null);
  const vertexBufferRef = useRef<WebGLBuffer | null>(null);
  const solidCacheRef = useRef<Map<string, Uint8Array>>(new Map());
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
  const streamingKeySetRef = useRef<string>("");
  const lastFrameTimeRef = useRef<number | null>(null);
  const simTickRef = useRef(0);
  const cameraLookOffsetRef = useRef<CameraLookOffset>({ x: 0, y: 0 });
  const chatBubblesRef = useRef<ChatBubbleRecord[]>([]);
  const activeTypingRef = useRef(false);
  const viewModeRef = useRef<WebGlViewMode>("entity");
  const uiModeRef = useRef<WebGlUiMode>("world");
  const flowDescriptorRef = useRef<FlowDescriptor>({
    name: FLOW_NAME,
    seed: SEED_NAME,
    camera: { x: 0, y: 0, zoom: 1 },
  });
  const replayEventsRef = useRef<ReplayEvent[]>([]);
  const uiOverlayVisibleRef = useRef(true);
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
  const [_uiOverlayVisible, setUiOverlayVisible] = useState(true);

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
    sceneStateRef.current = {
      ...sceneStateRef.current,
      fullscreen: fullscreenElement === hostRef.current,
      viewport: {
        cssWidth: rect.width,
        cssHeight: rect.height,
        devicePixelRatio: dpr,
        framebufferWidth: canvas.width,
        framebufferHeight: canvas.height,
      },
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
    sceneStateRef.current = {
      ...sceneStateRef.current,
      camera: { x, y, zoom },
    };
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
    sceneStateRef.current = {
      ...sceneStateRef.current,
      player: { tileX, tileY, tileZ },
    };
    appendLog(`player ${tileX},${tileY},${tileZ}`);
    await waitForAnimationFrame();
  };

  const setViewModeState = async (mode: WebGlViewMode) => {
    viewModeRef.current = mode;
    sceneStateRef.current = {
      ...sceneStateRef.current,
      viewMode: mode,
    };
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
    sceneStateRef.current = {
      ...sceneStateRef.current,
      uiMode: "chat",
      chatBuffer: initialValue,
    };
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
    sceneStateRef.current = {
      ...sceneStateRef.current,
      chatBuffer: value,
    };
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
        sceneStateRef.current = {
          ...sceneStateRef.current,
          viewMode: "master",
        };
        appendLog("chat command /master");
      } else if (command === "entity") {
        viewModeRef.current = "entity";
        sceneStateRef.current = {
          ...sceneStateRef.current,
          viewMode: "entity",
        };
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
    sceneStateRef.current = {
      ...sceneStateRef.current,
      submittedChatMessages: [
        ...sceneStateRef.current.submittedChatMessages,
        trimmed,
      ].slice(-20),
    };
    appendLog(`chat message ${JSON.stringify(trimmed)}`);
  };

  const worldPlayerSnapshot = (): PlayerState => {
    const pos = worldRef.current.entity.position;
    return { tileX: pos.x, tileY: pos.y, tileZ: pos.z };
  };

  const syncScenePlayerFromWorld = () => {
    sceneStateRef.current = {
      ...sceneStateRef.current,
      player: worldPlayerSnapshot(),
    };
  };

  const loadedChunkSet = () => new Set(solidCacheRef.current.keys());

  const closeChat = () => {
    uiModeRef.current = "world";
    activeTypingRef.current = false;
    sceneStateRef.current = {
      ...sceneStateRef.current,
      uiMode: "world",
      chatBuffer: "",
    };
    appendLog("chat close");
  };

  const submitChat = () => {
    const current = sceneStateRef.current.chatBuffer;
    handleChatSubmission(current);
    closeChat();
  };

  const processPlayerMovement = () => {
    if (uiModeRef.current === "chat") return;
    if (worldRef.current.entity.movement) return;
    const up = playerKeysHeldRef.current.has("KeyE");
    const down = playerKeysHeldRef.current.has("KeyD");
    const left = playerKeysHeldRef.current.has("KeyS");
    const right = playerKeysHeldRef.current.has("KeyF");
    if (!up && !down && !left && !right) return;

    const direction: Vec3i = {
      x: left && !right ? -1 : right && !left ? 1 : 0,
      y: up && !down ? -1 : down && !up ? 1 : 0,
      z: 0,
    };
    const result = startEntityMove(
      worldRef.current,
      direction,
      loadedChunkSet(),
    );
    if (!result.ok && result.reason !== "moving") {
      appendLog(`move blocked: ${result.reason}`);
    }
  };

  const processCameraMovement = () => {
    if (uiModeRef.current === "chat") return;
    const up = cameraKeysHeldRef.current.has("KeyI");
    const down = cameraKeysHeldRef.current.has("KeyK");
    const left = cameraKeysHeldRef.current.has("KeyJ");
    const right = cameraKeysHeldRef.current.has("KeyL");
    const step = cameraSpeedPxPerS / 60;

    if (viewModeRef.current === "entity") {
      const offset = { ...cameraLookOffsetRef.current };
      if (up && !down) offset.y -= step;
      if (down && !up) offset.y += step;
      if (left && !right) offset.x -= step;
      if (right && !left) offset.x += step;
      if (!up && !down && !left && !right) {
        offset.x += (0 - offset.x) * CAMERA_RETURN_PER_TICK;
        offset.y += (0 - offset.y) * CAMERA_RETURN_PER_TICK;
        if (Math.abs(offset.x) < 0.5) offset.x = 0;
        if (Math.abs(offset.y) < 0.5) offset.y = 0;
      }
      cameraLookOffsetRef.current = offset;
      const [x, y] = entityRenderPosition(worldRef.current.entity);
      sceneStateRef.current = {
        ...sceneStateRef.current,
        camera: {
          x: (x + 0.5) * TILE_SIZE_PX + offset.x,
          y: (y + 0.5) * TILE_SIZE_PX + offset.y,
          zoom: sceneStateRef.current.camera.zoom,
        },
      };
      return;
    }

    if (!up && !down && !left && !right) return;
    const camera = { ...sceneStateRef.current.camera };
    if (up && !down) camera.y -= step;
    if (down && !up) camera.y += step;
    if (left && !right) camera.x -= step;
    if (right && !left) camera.x += step;
    sceneStateRef.current = {
      ...sceneStateRef.current,
      camera,
    };
  };

  const processVisibility = () => {
    if (viewModeRef.current !== "entity") {
      worldRef.current.visible = new Set();
      sceneStateRef.current = {
        ...sceneStateRef.current,
        visibleTileCount: 0,
        rememberedTileCount: worldRef.current.memory.size,
      };
      return;
    }
    recomputeFov(worldRef.current);
    sceneStateRef.current = {
      ...sceneStateRef.current,
      visibleTileCount: worldRef.current.visible.size,
      rememberedTileCount: worldRef.current.memory.size,
    };
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
    for (const key of wanted) {
      if (solidCacheRef.current.has(key)) continue;
      const [chunkX, chunkY, chunkZ] = key.split(",").map(Number);
      solidCacheRef.current.set(
        key,
        generateWorldSolidChunk(world.seed, { chunkX, chunkY, chunkZ }),
      );
    }
  };

  const advanceSimulationTick = () => {
    simTickRef.current += 1;
    eventTickRef.current = simTickRef.current;
    worldRef.current.tick = simTickRef.current;
    processPlayerMovement();
    advanceWorldMovement(worldRef.current);
    syncScenePlayerFromWorld();
    processCameraMovement();
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
          sceneStateRef.current = {
            ...sceneStateRef.current,
            camera: {
              x: cam2d.x + dx2d,
              y: cam2d.y + dy2d,
              zoom: cam2d.zoom,
            },
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
            sceneStateRef.current = {
              ...sceneStateRef.current,
              residentChunks: chunkCacheRef.current.size,
              streamingChunks: [...chunkCacheRef.current.keys()],
            };
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
        drawFrame();
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
        sceneStateRef.current = {
          ...sceneStateRef.current,
          assetsLoaded: [
            ...sceneStateRef.current.assetsLoaded,
            TILE_TEXTURE_SRC,
          ],
          residentChunks: cache2d.size,
          streamingChunks: [...cache2d.keys()],
          uiMode: "world",
        };
        drawFrame();
      };

      const handleFullscreenChange = () => {
        keysHeldRef.current.clear();
        cameraKeysHeldRef.current.clear();
        playerKeysHeldRef.current.clear();
        lastFrameTimeRef.current = null;
        const isFullscreen = document.fullscreenElement === host;
        setFullscreenState(isFullscreen);
        sceneStateRef.current = {
          ...sceneStateRef.current,
          fullscreen: isFullscreen,
        };
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
          const player = worldPlayerSnapshot();
          sceneStateRef.current = {
            ...sceneStateRef.current,
            camera: { x: cam.x, y: cam.y, zoom: cam.zoom ?? 1 },
            player,
            viewMode: "entity",
            uiMode: "world",
            chatBuffer: "",
            submittedChatMessages: [],
            visibleTileCount: 0,
            rememberedTileCount: 0,
            drawOrderLabels: [],
          };
          replayEventsRef.current = [];
          inputLogRef.current = [];
          checkpointsRef.current = [];
          solidCacheRef.current.clear();
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
          if (sceneReadyRef.current) {
            const sk2dFlow = buildStreamingChunkKeys(viewZ);
            const cache2dFlow = new Map<string, Uint16Array>();
            updateChunkCache(cache2dFlow, descriptor.seed, sk2dFlow);
            chunkCacheRef.current = cache2dFlow;
            streamingKeySetRef.current = sk2dFlow.map(chunkKeyString).join("|");
            sceneStateRef.current = {
              ...sceneStateRef.current,
              residentChunks: cache2dFlow.size,
              streamingChunks: [...cache2dFlow.keys()],
            };
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

    const vertexSource = `#version 300 es
      precision highp float;
      precision highp int;
      in vec2 a_position;
      in vec2 a_uv;
      in vec2 a_instance_offset;
      in vec2 a_instance_size;
      in vec4 a_instance_uv;
      uniform vec2 u_canvas_size;
      uniform vec2 u_camera;
      uniform int u_render_mode;
      out vec2 v_uv;
      out float v_instance_alpha;

      void main() {
        vec2 world_px = a_instance_offset + a_position * a_instance_size;
        vec2 screen_px = u_render_mode == 3
          ? world_px
          : world_px - u_camera + u_canvas_size * 0.5;
        vec2 ndc = (screen_px / u_canvas_size) * 2.0 - 1.0;
        gl_Position = vec4(ndc * vec2(1.0, -1.0), 0.0, 1.0);
        v_uv = a_uv * a_instance_uv.zw + a_instance_uv.xy;
        v_instance_alpha = a_instance_uv.x;
      }
    `;

    const fragmentSource = `#version 300 es
      precision highp float;
      precision highp int;
      uniform sampler2D u_texture;
      uniform vec3 u_tint;
      uniform float u_alpha_multiplier;
      uniform int u_render_mode;
      in vec2 v_uv;
      in float v_instance_alpha;
      out vec4 out_color;

      void main() {
        vec4 texel = texture(u_texture, v_uv);
        if (u_render_mode == 1) {
          out_color = vec4(0.0, 0.0, 0.0, texel.a * u_alpha_multiplier);
        } else if (u_render_mode == 2) {
          out_color = vec4(0.0, 0.0, 0.0, v_instance_alpha);
        } else if (u_render_mode == 3) {
          out_color = vec4(u_tint, texel.a * u_alpha_multiplier);
        } else {
          out_color = texel;
          out_color.rgb *= u_tint;
        }
      }
    `;

    const program = createProgram(gl, vertexSource, fragmentSource);
    programRef.current = program;

    const vertexData = new Float32Array([
      0,
      0,
      0,
      0,
      1,
      0,
      1,
      0,
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
    ]);
    // Instance data: 8 floats per tile (worldX, worldY, sizeW, sizeH, uvX, uvY, uvW, uvH)
    const maxInstances = MAX_STREAMING_CHUNKS * CHUNK_EDGE_TILES *
      CHUNK_EDGE_TILES;
    // Pre-allocated scratch buffer reused for every draw pass
    const scratch = new Float32Array(maxInstances * 8);

    const vertexBuffer = gl.createBuffer();
    if (!vertexBuffer) {
      throw new Error("Failed to create vertex buffer");
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);
    vertexBufferRef.current = vertexBuffer;

    const instanceBuffer = gl.createBuffer();
    if (!instanceBuffer) {
      throw new Error("Failed to create instance buffer");
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      maxInstances * 8 * Float32Array.BYTES_PER_ELEMENT,
      gl.DYNAMIC_DRAW,
    );
    instanceBufferRef.current = instanceBuffer;

    gl.useProgram(program);
    gl.clearColor(0.08, 0.09, 0.11, 1.0);

    const positionLocation = gl.getAttribLocation(program, "a_position");
    const uvLocation = gl.getAttribLocation(program, "a_uv");
    const instanceOffsetLocation = gl.getAttribLocation(
      program,
      "a_instance_offset",
    );
    const instanceSizeLocation = gl.getAttribLocation(
      program,
      "a_instance_size",
    );
    const instanceUvLocation = gl.getAttribLocation(program, "a_instance_uv");

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uvLocation);
    gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 16, 8);

    // Instance buffer stride: 8 floats × 4 bytes = 32 bytes
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.enableVertexAttribArray(instanceOffsetLocation);
    gl.vertexAttribPointer(instanceOffsetLocation, 2, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(instanceOffsetLocation, 1);
    gl.enableVertexAttribArray(instanceSizeLocation);
    gl.vertexAttribPointer(instanceSizeLocation, 2, gl.FLOAT, false, 32, 8);
    gl.vertexAttribDivisor(instanceSizeLocation, 1);
    if (instanceUvLocation >= 0) {
      gl.enableVertexAttribArray(instanceUvLocation);
      gl.vertexAttribPointer(instanceUvLocation, 4, gl.FLOAT, false, 32, 16);
      gl.vertexAttribDivisor(instanceUvLocation, 1);
    }

    // Create all three atlas textures
    const createAtlasTexture = (): WebGLTexture => {
      const tex = gl.createTexture();
      if (!tex) throw new Error("Failed to create texture");
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    };
    const floorTex = createAtlasTexture();
    const shadowTex = createAtlasTexture();
    const ceilShadowTex = createAtlasTexture();
    const playerTex = createAtlasTexture();
    const whiteTex = createAtlasTexture();
    textureRef.current = floorTex;
    shadowTextureRef.current = shadowTex;
    ceilShadowTextureRef.current = ceilShadowTex;
    whiteTextureRef.current = whiteTex;

    let viewZ = 0;

    const uploadTexImage = (tex: WebGLTexture, img: HTMLImageElement) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };

    const uploadWhiteTexture = (tex: WebGLTexture) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([255, 255, 255, 255]),
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };

    const loadTextures = async () => {
      const loadImg = (src: string) => {
        const img = new Image();
        img.decoding = "async";
        img.src = src;
        return img.decode().then(() => img);
      };
      const [floorImg, shadowImg, ceilImg, playerImg, uiFontAtlas] =
        await Promise.all([
          loadImg(TILE_TEXTURE_SRC),
          loadImg(SHADOW_TEXTURE_SRC),
          loadImg(CEIL_SHADOW_TEXTURE_SRC),
          loadImg(PLAYER_TEXTURE_SRC),
          createUiFontAtlas(gl),
        ]);

      uploadTexImage(floorTex, floorImg);
      uploadTexImage(shadowTex, shadowImg);
      uploadTexImage(ceilShadowTex, ceilImg);
      uploadTexImage(playerTex, playerImg);
      uploadWhiteTexture(whiteTex);
      playerTextureRef.current = playerTex;
      playerTextureInfoRef.current = {
        src: PLAYER_TEXTURE_SRC,
        width: playerImg.naturalWidth,
        height: playerImg.naturalHeight,
      };
      uiFontAtlasRef.current = uiFontAtlas;

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
      sceneStateRef.current = {
        ...sceneStateRef.current,
        assetsLoaded: [
          TILE_TEXTURE_SRC,
          SHADOW_TEXTURE_SRC,
          CEIL_SHADOW_TEXTURE_SRC,
          PLAYER_TEXTURE_SRC,
          UI_FONT_SRC,
        ],
        residentChunks: skLoad.length,
        streamingChunks: skLoad.map((k) =>
          chunkKeyString({ ...k, chunkZ: viewZ })
        ),
        uiMode: "world",
      };
      drawFrame();
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
      drawFrame();
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

      const lastGl = lastFrameTimeRef.current ?? timestamp;
      lastFrameTimeRef.current = timestamp;
      void lastGl;
      advanceSimulationTick();
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
          sceneStateRef.current = {
            ...sceneStateRef.current,
            residentChunks: skGl.length,
            streamingChunks: skGl.map((k) =>
              chunkKeyString({ ...k, chunkZ: viewZ })
            ),
          };
        }
      }

      let drawCalls = 0;
      gl.useProgram(programRef.current);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const prog = programRef.current;
      const canvasSizeLoc = gl.getUniformLocation(prog, "u_canvas_size");
      const cameraLoc = gl.getUniformLocation(prog, "u_camera");
      const textureLoc = gl.getUniformLocation(prog, "u_texture");
      const tintLoc = gl.getUniformLocation(prog, "u_tint");
      const alphaMultiplierLoc = gl.getUniformLocation(
        prog,
        "u_alpha_multiplier",
      );
      const renderModeLoc = gl.getUniformLocation(prog, "u_render_mode");

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
      gl.activeTexture(gl.TEXTURE0);
      if (textureLoc) gl.uniform1i(textureLoc, 0);

      const visibleXY = computeVisibleChunks(
        sceneStateRef.current.camera,
        { framebufferWidth: canvas.width, framebufferHeight: canvas.height },
      );
      sceneStateRef.current.visibleChunks = visibleXY
        .filter((k) =>
          chunkCacheRef.current.has(chunkKeyString({ ...k, chunkZ: viewZ }))
        )
        .map((k) => chunkKeyString({ ...k, chunkZ: viewZ }));
      const shadowXY = new Map<string, { chunkX: number; chunkY: number }>();
      for (const vis of visibleXY) {
        shadowXY.set(`${vis.chunkX},${vis.chunkY}`, vis);
        shadowXY.set(`${vis.chunkX},${vis.chunkY - 1}`, {
          chunkX: vis.chunkX,
          chunkY: vis.chunkY - 1,
        });
      }
      const shadowVisibleXY = [...shadowXY.values()];
      const drawOrderLabels: string[] = [
        "floor",
        "edgeShadow",
        "ceilingShadow",
      ];
      if (viewModeRef.current === "entity") {
        drawOrderLabels.push("fog");
      }
      drawOrderLabels.push("player", "chat", "ui");
      sceneStateRef.current = {
        ...sceneStateRef.current,
        drawOrderLabels,
      };

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

        // Helper: upload scratch[0..count*8] and draw instanced
        const flushPass = (count: number) => {
          if (count === 0) return;
          gl.bindBuffer(gl.ARRAY_BUFFER, instanceBufferRef.current!);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratch.subarray(0, count * 8));
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
          drawCalls++;
        };

        // --- FLOOR PASSES: z = viewZ-Z_LEVELS_BELOW (back) → viewZ (front) ---
        // Pre-compute topmost visible solid z-offset per tile per chunk.
        // topmostOffset[idx] = z-offset (0 to -Z_LEVELS_BELOW) of topmost solid,
        // or 127 if no solid in the depth stack.
        const topmostOffsets = new Map<string, Int8Array>();
        const topmostXY = new Map<string, { chunkX: number; chunkY: number }>();
        for (const vis of shadowVisibleXY) {
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const chunkX = vis.chunkX + dx;
            const chunkY = vis.chunkY + dy;
            topmostXY.set(`${chunkX},${chunkY}`, { chunkX, chunkY });
          }
        }
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
          topmostOffsets.set(chunkKey, tmo);
        }
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
              if (tintLoc) gl.uniform3f(tintLoc, tint[0], tint[1], tint[2]);
              if (alphaMultiplierLoc) gl.uniform1f(alphaMultiplierLoc, alpha);
              if (renderModeLoc) gl.uniform1i(renderModeLoc, 0);
              let count = 0;
              for (const vis of visibleXY) {
                const tmo = topmostOffsets.get(
                  chunkKeyString({ ...vis, chunkZ: viewZ }),
                );
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
        if (tintLoc) gl.uniform3f(tintLoc, 1, 1, 1);

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
            if (renderModeLoc) gl.uniform1i(renderModeLoc, 2);
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
        if (alphaMultiplierLoc) {
          gl.uniform1f(alphaMultiplierLoc, SHADOW_ALPHA_MULTIPLIER);
        }
        if (renderModeLoc) gl.uniform1i(renderModeLoc, 1);

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
          gl.bindTexture(gl.TEXTURE_2D, whiteTextureRef.current);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          if (renderModeLoc) gl.uniform1i(renderModeLoc, 3);
          if (tintLoc) gl.uniform3f(tintLoc, 1.0, 0.78, 0.18);
          if (alphaMultiplierLoc) gl.uniform1f(alphaMultiplierLoc, 0.18);

          let count = 0;
          for (const vis of visibleXY) {
            const tmo = topmostOffsets.get(
              chunkKeyString({ ...vis, chunkZ: viewZ }),
            );
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
            if (renderModeLoc) gl.uniform1i(renderModeLoc, 0);
            const playerTint = layersRef.current.depthTint && zOffset < 0
              ? DEPTH_TINTS[Math.min(-zOffset, DEPTH_TINTS.length - 1)]
              : ([1, 1, 1] as [number, number, number]);
            if (tintLoc) {
              gl.uniform3f(
                tintLoc,
                playerTint[0],
                playerTint[1],
                playerTint[2],
              );
            }
            if (alphaMultiplierLoc) gl.uniform1f(alphaMultiplierLoc, 1);
            const [rx, ry] = entityRenderPosition(worldRef.current.entity);
            const worldX = (rx + 0.5) * TILE_SIZE_PX;
            const worldY = (ry + 0.5) * TILE_SIZE_PX;
            const screenX = worldX - sceneStateRef.current.camera.x +
              canvas.width * 0.5 - TILE_SIZE_PX * 0.5;
            const screenY = worldY - sceneStateRef.current.camera.y +
              canvas.height * 0.5 - TILE_SIZE_PX * 0.5;
            const off = 0;
            scratch[off + 0] = screenX;
            scratch[off + 1] = screenY;
            scratch[off + 2] = TILE_SIZE_PX;
            scratch[off + 3] = TILE_SIZE_PX;
            scratch[off + 4] = 0;
            scratch[off + 5] = 0;
            scratch[off + 6] = 1;
            scratch[off + 7] = 1;
            flushPass(1);
          }
        }

        // --- WEBGL UI PASS ---
        if (uiFontAtlasRef.current) {
          const fontAtlas = uiFontAtlasRef.current;
          const drawText = (
            text: string,
            x: number,
            y: number,
            rgb: [number, number, number],
            alpha = 1,
          ) => {
            drawUiTextLines(
              {
                gl,
                fontAtlas,
                scratch,
                maxInstances,
                flushPass,
                tintLoc,
                alphaMultiplierLoc,
                renderModeLoc,
              },
              text,
              x,
              y,
              rgb,
              alpha,
            );
          };
          const drawLines = (
            lines: string[],
            x: number,
            y: number,
            rgb: [number, number, number],
            alpha = 1,
          ) => {
            for (let i = 0; i < lines.length; i++) {
              drawText(
                lines[i],
                x,
                y + i * uiTextLineHeight(fontAtlas),
                rgb,
                alpha,
              );
            }
          };
          const textWidth = (text: string) => {
            let width = 0;
            for (let i = 0; i < text.length; i++) {
              const glyph = text.charCodeAt(i) - 32;
              width += (fontAtlas.advances[glyph] || fontAtlas.advance) + 1;
            }
            return width;
          };

          if (
            whiteTextureRef.current && sceneStateRef.current.uiMode === "chat"
          ) {
            gl.bindTexture(gl.TEXTURE_2D, whiteTextureRef.current);
            if (renderModeLoc) gl.uniform1i(renderModeLoc, 3);
            if (tintLoc) gl.uniform3f(tintLoc, 0.1725, 0.1725, 0.1725);
            if (alphaMultiplierLoc) gl.uniform1f(alphaMultiplierLoc, 0.65);
            const panelH = 46;
            const panelY = canvas.height - panelH - 18;
            const panelX = 20;
            const panelW = canvas.width - 40;
            const off = 0;
            scratch[off + 0] = panelX;
            scratch[off + 1] = panelY;
            scratch[off + 2] = panelW;
            scratch[off + 3] = panelH;
            scratch[off + 4] = 1;
            scratch[off + 5] = 0;
            scratch[off + 6] = 1;
            scratch[off + 7] = 1;
            flushPass(1);
          }

          if (uiOverlayVisibleRef.current) {
            const cap = capabilityStateRef.current;
            const preview = replayPreviewRef.current;
            const statusLines = [
              `STEP 6 WEBGL UI  ${statusRef.current}`,
              `[1] ui:${uiOverlayVisibleRef.current ? "on" : "OFF"} [6] floor:${
                layersRef.current.floor ? "on" : "OFF"
              } [7] edge:${layersRef.current.edgeShadow ? "on" : "OFF"}`,
              `[8] ceil:${
                layersRef.current.ceilShadow ? "on" : "OFF"
              } [9] tint:${layersRef.current.depthTint ? "on" : "OFF"}`,
              `fullscreen: ${fullscreenRef.current ? "yes" : "no"}  z:${viewZ}`,
              `framebuffer: ${cap?.framebufferSize.width ?? 0} x ${
                cap?.framebufferSize.height ?? 0
              }`,
              `css: ${cap?.canvasCssSize.width.toFixed(0) ?? "0"} x ${
                cap?.canvasCssSize.height.toFixed(0) ?? "0"
              } dpr:${cap?.devicePixelRatio.toFixed(2) ?? "0.00"}`,
              `replay:${preview.eventCount} tex:${preview.textureCount} shots:${preview.screenshotCount} checks:${preview.checkpointCount}`,
              `baseline: ${
                baselineConfiguredRef.current ? "configured" : "unset"
              }`,
            ];
            drawLines(statusLines, 32, 28, [1.0, 0.86, 0.56], 0.95);

            const logLines = logsRef.current.length === 0
              ? ["waiting for resize or fullscreen..."]
              : ["EVENT LOG", ...logsRef.current.slice(0, 7)];
            const logW = Math.min(560, canvas.width - 32);
            drawLines(
              logLines,
              canvas.width - logW,
              canvas.height - 202,
              [0.82, 0.9, 1.0],
              0.88,
            );

            const checkpoints = checkpointRecordsRef.current.slice(-6)
              .reverse();
            const checkpointLines = checkpoints.length === 0
              ? ["CHECKPOINTS", "no checkpoints captured yet"]
              : [
                "CHECKPOINTS",
                ...checkpoints.map((entry) =>
                  `${String(entry.ordinal).padStart(3, "0")} ${entry.name} ${
                    entry.baselineConfigured ? "base" : "new"
                  }`
                ),
              ];
            drawLines(
              checkpointLines,
              32,
              canvas.height - 162,
              [0.7, 1.0, 0.82],
              0.88,
            );
          }

          const playerScreenX = (sceneStateRef.current.player.tileX + 0.5) *
              TILE_SIZE_PX -
            sceneStateRef.current.camera.x +
            canvas.width * 0.5;
          const playerScreenY = (sceneStateRef.current.player.tileY + 0.5) *
              TILE_SIZE_PX -
            sceneStateRef.current.camera.y +
            canvas.height * 0.5;
          const bubbleText = sceneStateRef.current.chatBuffer.length > 0
            ? `${sceneStateRef.current.chatBuffer}_`
            : "";
          if (bubbleText.length > 0) {
            drawText(
              bubbleText,
              32,
              canvas.height - 52,
              [0.98, 0.95, 0.88],
              1,
            );
          }
          const liveBubbles = chatBubblesRef.current
            .map((bubble) => ({
              ...bubble,
              age: simTickRef.current - bubble.tick,
            }))
            .filter((bubble) =>
              bubble.age <= CHAT_BUBBLE_FADE_IN_TICKS +
                  CHAT_BUBBLE_VISIBLE_TICKS +
                  CHAT_BUBBLE_FADE_OUT_TICKS
            )
            .sort((a, b) => b.tick - a.tick);
          chatBubblesRef.current = liveBubbles.map(({ age: _age, ...bubble }) =>
            bubble
          );
          let bubbleOffsetY = 30;
          for (const bubble of liveBubbles) {
            const fadeOutStart = CHAT_BUBBLE_FADE_IN_TICKS +
              CHAT_BUBBLE_VISIBLE_TICKS;
            const alpha = bubble.age < CHAT_BUBBLE_FADE_IN_TICKS
              ? bubble.age / CHAT_BUBBLE_FADE_IN_TICKS
              : bubble.age > fadeOutStart
              ? 1 - (bubble.age - fadeOutStart) / CHAT_BUBBLE_FADE_OUT_TICKS
              : 1;
            const messageWidth = Math.min(
              200,
              Math.max(32, textWidth(bubble.message)),
            );
            const bubbleW = messageWidth + 8;
            const bubbleH = 26;
            const bubbleX = Math.max(8, playerScreenX - bubbleW * 0.5);
            const bubbleY = Math.max(
              8,
              playerScreenY - bubbleOffsetY - bubbleH,
            );
            if (whiteTextureRef.current) {
              gl.bindTexture(gl.TEXTURE_2D, whiteTextureRef.current);
              if (renderModeLoc) gl.uniform1i(renderModeLoc, 3);
              if (tintLoc) gl.uniform3f(tintLoc, 0.1, 0.1, 0.1);
              if (alphaMultiplierLoc) {
                gl.uniform1f(alphaMultiplierLoc, 0.55 * alpha);
              }
              scratch[0] = bubbleX;
              scratch[1] = bubbleY;
              scratch[2] = bubbleW;
              scratch[3] = bubbleH;
              scratch[4] = 1;
              scratch[5] = 0;
              scratch[6] = 1;
              scratch[7] = 1;
              flushPass(1);
            }
            drawText(
              bubble.message,
              bubbleX + 4,
              bubbleY + 4,
              [1, 1, 1],
              alpha,
            );
            bubbleOffsetY += bubbleH + 6;
          }
        }

        gl.disable(gl.BLEND);
      }

      frameMetricsRef.current.push({
        cpuMs: performance.now() - t0,
        drawCalls,
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
      sceneStateRef.current = {
        ...sceneStateRef.current,
        fullscreen: isFullscreen,
      };
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
        appendLog(`z-level: ${viewZ}`);
      }
      if (event.code === "KeyV") {
        event.preventDefault();
        viewZ -= 1;
        streamingKeySetRef.current = "";
        appendLog(`z-level: ${viewZ}`);
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
        sceneStateRef.current = {
          ...sceneStateRef.current,
          camera: { x: cam.x, y: cam.y, zoom: cam.zoom ?? 1 },
          player,
          viewMode: "entity",
          uiMode: "world",
          chatBuffer: "",
          submittedChatMessages: [],
          visibleTileCount: 0,
          rememberedTileCount: 0,
          drawOrderLabels: [],
        };
        replayEventsRef.current = [];
        inputLogRef.current = [];
        checkpointsRef.current = [];
        solidCacheRef.current.clear();
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
        if (sceneReadyRef.current) {
          const skFlow = buildStreamingChunkKeys(viewZ);
          const seed = descriptor.seed;
          chunkCacheRef.current = new Map();
          updateFloorCache(chunkCacheRef.current, seed, skFlow, viewZ);
          updateWorldSolidCache(skFlow, viewZ);
          streamingKeySetRef.current = skFlow.map((k) =>
            chunkKeyString({ ...k, chunkZ: viewZ })
          ).join("|") + `|z${viewZ}`;
          sceneStateRef.current = {
            ...sceneStateRef.current,
            residentChunks: skFlow.length,
            streamingChunks: skFlow.map((k) =>
              chunkKeyString({ ...k, chunkZ: viewZ })
            ),
          };
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
