import { useEffect, useRef, useState } from "preact/hooks";
import type { FlowDescriptor, PerfWindow } from "../lib/webgl-harness-types.ts";
import {
  CHUNK_EDGE_TILES,
  chunkKeyString,
  computeCeilingShadowIds,
  computeStreamingChunks,
  computeVisibleChunks,
  FLOOR_FRAMES,
  SHADOW_FRAMES,
  TILE_SIZE_PX,
  updateChunkCache,
  updateFloorCache,
  updateSolidCache,
  Z_LEVELS_BELOW,
} from "../lib/webgl-chunk-gen.ts";

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

type WebGlSceneSnapshot = {
  tick: number;
  frame: number;
  seed: string;
  camera: { x: number; y: number; zoom: number };
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
  uiMode: string;
  sceneHash: string;
  perf: PerfWindow;
};

type WebGlCheckpointRecord = {
  name: string;
  ordinal: number;
  tick: number;
  frame: number;
  screenshotFilename: string;
  stateFilename: string;
  stateHash: string;
  baselineConfigured: boolean;
  baselineSource: string | null;
  perf: PerfWindow;
  visibleChunks: string[];
  residentChunks: number;
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
const SHADOW_TEXTURE_SRC = "/assets/atlases/ShadowAtlas.png";
const CEIL_SHADOW_TEXTURE_SRC = "/assets/atlases/ObscureAtlas.png";
const SHADOW_ALPHA_MULTIPLIER = 0.55;
const EDGE_SEGMENT_DARK_ALPHA = 0.28;
const EDGE_SEGMENT_LIGHT_ALPHA = 0.11;
const EDGE_SEGMENT_BAND_PX = 4;
let cameraSpeedPxPerS = 480;
const STREAM_PADDING = 1;
const MAX_STREAMING_CHUNKS = 64;
const GAME_KEYS = new Set([
  "KeyE",
  "KeyS",
  "KeyD",
  "KeyF",
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
    uiMode: "boot",
  });
  const screenshotArtifactsRef = useRef<Record<string, Blob>>({});
  const stateArtifactsRef = useRef<Record<string, Blob>>({});
  const frameMetricsRef = useRef<FrameMetric[]>([]);
  const chunkCacheRef = useRef<Map<string, Uint16Array>>(new Map());
  const textureInfoRef = useRef<
    { src: string; width: number; height: number } | null
  >(null);
  const keysHeldRef = useRef<Set<string>>(new Set());
  const streamingKeySetRef = useRef<string>("");
  const lastFrameTimeRef = useRef<number | null>(null);
  const flowDescriptorRef = useRef<FlowDescriptor>({
    name: FLOW_NAME,
    seed: SEED_NAME,
    camera: { x: 0, y: 0, zoom: 1 },
  });
  const replayEventsRef = useRef<ReplayEvent[]>([]);

  const [status, setStatus] = useState("booting");
  const [fullscreen, setFullscreen] = useState(false);
  const [capability, setCapability] = useState<WebGlCapabilityReport | null>(
    null,
  );
  const [logs, setLogs] = useState<string[]>([]);
  const [replayPreview, setReplayPreview] = useState<ReplayPreview>(
    summarizeReplay([]),
  );
  const [checkpointRecords, setCheckpointRecords] = useState<
    WebGlCheckpointRecord[]
  >([]);
  const [baselineConfigured, setBaselineConfigured] = useState(false);
  const [importedReplayInfo, setImportedReplayInfo] = useState<string | null>(
    null,
  );
  const [layers, setLayers] = useState({
    floor: true,
    edgeShadow: true,
    ceilShadow: true,
    depthTint: true,
  });

  const appendLog = (text: string) => {
    const id = logIdRef.current++;
    const next = `${String(id).padStart(3, "0")} ${text}`;
    setLogs((prev) => [next, ...prev].slice(0, 10));
  };

  const pushReplayEvent = (event: ReplayEvent) => {
    replayEventsRef.current = [...replayEventsRef.current, event];
    setReplayPreview(summarizeReplay(replayEventsRef.current));
  };

  const nextTick = () => {
    eventTickRef.current += 1;
    return eventTickRef.current;
  };

  const refreshCapability = (
    gl: WebGL2RenderingContext,
    canvas: HTMLCanvasElement,
    fullscreenElement: Element | null,
  ) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = globalThis.devicePixelRatio || 1;
    const maxViewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;

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
      tick: eventTickRef.current,
      frame: frameRef.current,
      seed: flowDescriptorRef.current.seed,
      camera: sceneStateRef.current.camera,
      fullscreen: sceneStateRef.current.fullscreen,
      viewport: sceneStateRef.current.viewport,
      visibleChunks: sceneStateRef.current.visibleChunks,
      streamingChunks: sceneStateRef.current.streamingChunks,
      residentChunks: sceneStateRef.current.residentChunks,
      assetsLoaded: sceneStateRef.current.assetsLoaded,
      uiMode: sceneStateRef.current.uiMode,
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
      screenshotFilename,
      stateFilename,
      stateHash,
      baselineConfigured: Boolean(baselineSource),
      baselineSource,
      perf,
      visibleChunks: snapshot.visibleChunks,
      residentChunks: snapshot.residentChunks,
    };

    checkpointsRef.current = [...checkpointsRef.current, record];
    setCheckpointRecords(checkpointsRef.current);
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
    setReplayPreview(summarizeReplay(replayEventsRef.current));
    setCheckpointRecords(checkpointsRef.current);
    setImportedReplayInfo(
      `${doc.createdAt} | ${replayEventsRef.current.length} events | ${checkpointsRef.current.length} checkpoints`,
    );
    setLogs(
      replayEventsRef.current.slice(-10).map((entry, index) =>
        `${String(index).padStart(3, "0")} ${JSON.stringify(entry)}`
      ).reverse(),
    );
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
    setBaselineConfigured(Boolean(manifest));
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
        setStatus("canvas2d unavailable");
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
      setStatus("canvas2d fallback active");
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
          const vp2d = {
            framebufferWidth: canvas.width,
            framebufferHeight: canvas.height,
          };
          const sk2d = computeStreamingChunks(
            sceneStateRef.current.camera,
            vp2d,
            STREAM_PADDING,
          );
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
        const vp2dLoad = {
          framebufferWidth: canvas.width,
          framebufferHeight: canvas.height,
        };
        const sk2dLoad = computeStreamingChunks(
          sceneStateRef.current.camera,
          vp2dLoad,
          STREAM_PADDING,
        );
        const cache2d = new Map<string, Uint16Array>();
        updateChunkCache(cache2d, flowDescriptorRef.current.seed, sk2dLoad);
        chunkCacheRef.current = cache2d;
        streamingKeySetRef.current = sk2dLoad.map(chunkKeyString).join("|");
        setStatus("SingleRock texture ready");
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
        lastFrameTimeRef.current = null;
        const isFullscreen = document.fullscreenElement === host;
        setFullscreen(isFullscreen);
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
        if (GAME_KEYS.has(event.code)) {
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
          sceneStateRef.current = {
            ...sceneStateRef.current,
            camera: { x: cam.x, y: cam.y, zoom: cam.zoom ?? 1 },
          };
          replayEventsRef.current = [];
          checkpointsRef.current = [];
          screenshotArtifactsRef.current = {};
          stateArtifactsRef.current = {};
          frameMetricsRef.current = [];
          eventTickRef.current = 0;
          setCheckpointRecords([]);
          setReplayPreview(summarizeReplay([]));
          setImportedReplayInfo(null);
          keysHeldRef.current.clear();
          streamingKeySetRef.current = "";
          if (sceneReadyRef.current) {
            const vp2dFlow = {
              framebufferWidth: canvas.width,
              framebufferHeight: canvas.height,
            };
            const sk2dFlow = computeStreamingChunks(
              sceneStateRef.current.camera,
              vp2dFlow,
              STREAM_PADDING,
            );
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
            eventTickRef.current += 1;
            await waitForAnimationFrame();
          }
        },
        captureCheckpoint,
        setCamera,
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
        setStatus(`texture load failed: ${String(error)}`);
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
      in vec2 a_position;
      in vec2 a_uv;
      in vec2 a_instance_offset;
      in vec2 a_instance_size;
      in vec4 a_instance_uv;
      uniform vec2 u_canvas_size;
      uniform vec2 u_camera;
      out vec2 v_uv;
      out float v_instance_alpha;

      void main() {
        vec2 world_px = a_instance_offset + a_position * a_instance_size;
        vec2 screen_px = world_px - u_camera + u_canvas_size * 0.5;
        vec2 ndc = (screen_px / u_canvas_size) * 2.0 - 1.0;
        gl_Position = vec4(ndc * vec2(1.0, -1.0), 0.0, 1.0);
        v_uv = a_uv * a_instance_uv.zw + a_instance_uv.xy;
        v_instance_alpha = a_instance_uv.x;
      }
    `;

    const fragmentSource = `#version 300 es
      precision highp float;
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
    textureRef.current = floorTex;
    shadowTextureRef.current = shadowTex;
    ceilShadowTextureRef.current = ceilShadowTex;

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

    const loadTextures = async () => {
      const loadImg = (src: string) => {
        const img = new Image();
        img.decoding = "async";
        img.src = src;
        return img.decode().then(() => img);
      };
      const [floorImg, shadowImg, ceilImg] = await Promise.all([
        loadImg(TILE_TEXTURE_SRC),
        loadImg(SHADOW_TEXTURE_SRC),
        loadImg(CEIL_SHADOW_TEXTURE_SRC),
      ]);

      uploadTexImage(floorTex, floorImg);
      uploadTexImage(shadowTex, shadowImg);
      uploadTexImage(ceilShadowTex, ceilImg);

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

      const vpLoad = {
        framebufferWidth: canvas.width,
        framebufferHeight: canvas.height,
      };
      const skLoad = computeStreamingChunks(
        sceneStateRef.current.camera,
        vpLoad,
        STREAM_PADDING,
      );
      const seed = flowDescriptorRef.current.seed;

      chunkCacheRef.current = new Map();
      updateFloorCache(chunkCacheRef.current, seed, skLoad, viewZ);
      updateSolidCache(solidCacheRef.current, seed, skLoad, viewZ);

      streamingKeySetRef.current = skLoad.map((k) =>
        chunkKeyString({ ...k, chunkZ: viewZ })
      ).join("|") +
        `|z${viewZ}`;
      setStatus("depth stack ready");
      sceneReadyRef.current = true;
      sceneStateRef.current = {
        ...sceneStateRef.current,
        assetsLoaded: [
          TILE_TEXTURE_SRC,
          SHADOW_TEXTURE_SRC,
          CEIL_SHADOW_TEXTURE_SRC,
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
      const dtGl = Math.min(timestamp - lastGl, 100) / 1000;
      lastFrameTimeRef.current = timestamp;

      const camGl = sceneStateRef.current.camera;
      const stepGl = cameraSpeedPxPerS * dtGl;
      let dxGl = 0, dyGl = 0;
      const kGl = keysHeldRef.current;
      if (kGl.has("KeyE") || kGl.has("KeyI")) dyGl -= stepGl;
      if (kGl.has("KeyD") || kGl.has("KeyK")) dyGl += stepGl;
      if (kGl.has("KeyS") || kGl.has("KeyJ")) dxGl -= stepGl;
      if (kGl.has("KeyF") || kGl.has("KeyL")) dxGl += stepGl;
      if (dxGl !== 0 || dyGl !== 0) {
        sceneStateRef.current = {
          ...sceneStateRef.current,
          camera: { x: camGl.x + dxGl, y: camGl.y + dyGl, zoom: camGl.zoom },
        };
      }

      if (sceneReadyRef.current) {
        const vpGl = {
          framebufferWidth: canvas.width,
          framebufferHeight: canvas.height,
        };
        const skGl = computeStreamingChunks(
          sceneStateRef.current.camera,
          vpGl,
          STREAM_PADDING,
        );
        const seed = flowDescriptorRef.current.seed;
        const sfpGl =
          skGl.map((k) => chunkKeyString({ ...k, chunkZ: viewZ })).join("|") +
          `|z${viewZ}`;
        if (sfpGl !== streamingKeySetRef.current) {
          streamingKeySetRef.current = sfpGl;
          updateFloorCache(chunkCacheRef.current, seed, skGl, viewZ);
          updateSolidCache(solidCacheRef.current, seed, skGl, viewZ);
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
      frameRef.current += 1;
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
        for (const vis of visibleXY) {
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
                const sk = chunkKeyString({
                  chunkX: vis.chunkX,
                  chunkY: vis.chunkY,
                  chunkZ: viewZ + zo,
                });
                const solid = solidCacheRef.current.get(sk);
                if (solid && solid[idx] === 1) {
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
            const tint = layersRef.current.depthTint
              ? rawTint
              : ([1, 1, 1] as [number, number, number]);
            if (tintLoc) gl.uniform3f(tintLoc, tint[0], tint[1], tint[2]);
            if (alphaMultiplierLoc) gl.uniform1f(alphaMultiplierLoc, 1);
            if (renderModeLoc) gl.uniform1i(renderModeLoc, 0);

            let count = 0;
            for (const vis of visibleXY) {
              const solidKey = chunkKeyString({
                chunkX: vis.chunkX,
                chunkY: vis.chunkY,
                chunkZ: z,
              });
              const solid = solidCacheRef.current.get(solidKey);
              if (!solid) continue;
              const tmo = topmostOffsets.get(
                chunkKeyString({ ...vis, chunkZ: viewZ }),
              );
              if (!tmo) continue;
              const baseX = vis.chunkX * CHUNK_EDGE_TILES;
              const baseY = vis.chunkY * CHUNK_EDGE_TILES;
              for (let ty = 0; ty < CHUNK_EDGE_TILES; ty++) {
                for (let tx = 0; tx < CHUNK_EDGE_TILES; tx++) {
                  const idx = ty * CHUNK_EDGE_TILES + tx;
                  // Only draw at the topmost solid z for this column
                  if (tmo[idx] !== zOffset) continue;
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

          for (const vis of visibleXY) {
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
                if (right !== 127 && right !== here) {
                  addVerticalShadow(
                    (baseX + tx + 1) * TILE_SIZE_PX,
                    (baseY + ty) * TILE_SIZE_PX,
                    right < here,
                  );
                }

                const down = getTopmostOffset(
                  vis.chunkX,
                  vis.chunkY,
                  tx,
                  ty + 1,
                );
                if (down !== 127 && down !== here) {
                  addHorizontalShadow(
                    (baseX + tx) * TILE_SIZE_PX,
                    (baseY + ty + 1) * TILE_SIZE_PX,
                    down < here,
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
          for (const vis of visibleXY) {
            const ceilIds = computeCeilingShadowIds(
              vis.chunkX,
              vis.chunkY,
              viewZ,
              solidCacheRef.current,
            );
            const baseX = vis.chunkX * CHUNK_EDGE_TILES;
            const baseY = vis.chunkY * CHUNK_EDGE_TILES;
            for (let ty = 0; ty < CHUNK_EDGE_TILES; ty++) {
              for (let tx = 0; tx < CHUNK_EDGE_TILES; tx++) {
                const mask = ceilIds[ty * CHUNK_EDGE_TILES + tx];
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
      lastFrameTimeRef.current = null;
      const isFullscreen = document.fullscreenElement === host;
      setFullscreen(isFullscreen);
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
      if (GAME_KEYS.has(event.code)) {
        event.preventDefault();
        keysHeldRef.current.add(event.code);
      }
      if (event.code === "KeyR") {
        event.preventDefault();
        viewZ++;
        streamingKeySetRef.current = "";
        appendLog(`z-level: ${viewZ}`);
      }
      if (event.code === "KeyV") {
        event.preventDefault();
        viewZ--;
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
        sceneStateRef.current = {
          ...sceneStateRef.current,
          camera: { x: cam.x, y: cam.y, zoom: cam.zoom ?? 1 },
        };
        replayEventsRef.current = [];
        checkpointsRef.current = [];
        screenshotArtifactsRef.current = {};
        stateArtifactsRef.current = {};
        frameMetricsRef.current = [];
        eventTickRef.current = 0;
        setCheckpointRecords([]);
        setReplayPreview(summarizeReplay([]));
        setImportedReplayInfo(null);
        keysHeldRef.current.clear();
        streamingKeySetRef.current = "";
        if (sceneReadyRef.current) {
          const vpFlow = {
            framebufferWidth: canvas.width,
            framebufferHeight: canvas.height,
          };
          const skFlow = computeStreamingChunks(
            sceneStateRef.current.camera,
            vpFlow,
            STREAM_PADDING,
          );
          const seed = descriptor.seed;
          chunkCacheRef.current = new Map();
          updateFloorCache(chunkCacheRef.current, seed, skFlow, viewZ);
          updateSolidCache(solidCacheRef.current, seed, skFlow, viewZ);
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
          eventTickRef.current += 1;
          await waitForAnimationFrame();
        }
      },
      captureCheckpoint,
      setCamera,
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
      setStatus(`texture load failed: ${String(error)}`);
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
      instanceBufferRef.current = null;
      vertexBufferRef.current = null;
      sceneReadyRef.current = false;
    };
  }, []);

  const openImportDialog = () => fileInputRef.current?.click();

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
      <div class="absolute left-4 top-4 z-10 max-w-[min(31rem,calc(100%-2rem))] rounded-2xl border border-amber-200/15 bg-black/55 px-4 py-3 text-xs text-amber-50/90 backdrop-blur">
        <div class="flex flex-wrap items-center gap-3">
          <span class="rounded-full bg-amber-300/20 px-2 py-1 font-semibold uppercase tracking-[0.18em] text-amber-100">
            Step 4 Depth Stack
          </span>
          <span class="text-white/70">{status}</span>
        </div>
        <div class="mt-2 space-y-1 font-mono text-[11px] leading-5 text-white/75">
          <div>
            [6] floor:{layers.floor ? "on" : "OFF"}{" "}
            [7] edge:{layers.edgeShadow ? "on" : "OFF"}{" "}
            [8] ceil:{layers.ceilShadow ? "on" : "OFF"}{" "}
            [9] tint:{layers.depthTint ? "on" : "OFF"}
          </div>
          <div>fullscreen: {fullscreen ? "yes" : "no"}</div>
          <div>
            framebuffer: {capability?.framebufferSize.width ?? 0} x{" "}
            {capability?.framebufferSize.height ?? 0}
          </div>
          <div>
            css size: {capability?.canvasCssSize.width.toFixed(0) ?? "0"} x{" "}
            {capability?.canvasCssSize.height.toFixed(0) ?? "0"} dpr:{" "}
            {capability?.devicePixelRatio.toFixed(2) ?? "0.00"}
          </div>
          <div>
            renderer: {capability?.context.renderer ?? "n/a"} / vendor:{" "}
            {capability?.context.vendor ?? "n/a"}
          </div>
          <div>
            max texture size: {capability?.context.maxTextureSize ?? "n/a"}
          </div>
          <div>
            replay events: {replayPreview.eventCount} | textures:{" "}
            {replayPreview.textureCount} | screenshots:{" "}
            {replayPreview.screenshotCount} | checkpoints:{" "}
            {replayPreview.checkpointCount}
          </div>
          <div>
            baseline manifest: {baselineConfigured ? "configured" : "unset"}
          </div>
          <div>
            import: {importedReplayInfo ?? "none"}
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-md border border-amber-100/15 bg-amber-50/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-50 transition hover:bg-amber-50/15"
            onClick={() => {
              const host = hostRef.current;
              if (!host) return;
              void host.requestFullscreen();
            }}
          >
            Enter Fullscreen
          </button>
          <button
            type="button"
            class="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70 transition hover:bg-white/10 hover:text-white"
            onClick={() => canvasRef.current?.focus()}
          >
            Focus Canvas
          </button>
          <button
            type="button"
            class="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70 transition hover:bg-white/10 hover:text-white"
            onClick={openImportDialog}
          >
            Import Replay JSON
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        class="webgl-experiment-canvas"
      />
      <div class="pointer-events-none absolute bottom-4 right-4 w-[min(28rem,calc(100%-2rem))] rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-[11px] text-white/80 backdrop-blur">
        <div class="font-semibold uppercase tracking-[0.16em] text-white/55">
          Event Log
        </div>
        <div class="mt-2 max-h-40 space-y-1 overflow-hidden font-mono leading-5">
          {logs.length === 0
            ? (
              <div class="text-white/45">
                waiting for resize or fullscreen...
              </div>
            )
            : logs.map((entry) => <div key={entry}>{entry}</div>)}
        </div>
      </div>
      <div class="pointer-events-none absolute bottom-4 left-4 w-[min(27rem,calc(100%-2rem))] rounded-2xl border border-emerald-200/10 bg-black/45 px-4 py-3 text-[11px] text-white/80 backdrop-blur">
        <div class="font-semibold uppercase tracking-[0.16em] text-white/55">
          Checkpoints
        </div>
        <div class="mt-2 max-h-40 space-y-1 overflow-hidden font-mono leading-5">
          {checkpointRecords.length === 0
            ? <div class="text-white/45">no checkpoints captured yet</div>
            : checkpointRecords.slice().reverse().map((entry) => (
              <div key={`${entry.ordinal}:${entry.name}`}>
                {String(entry.ordinal).padStart(3, "0")} {entry.name} |{" "}
                {entry.screenshotFilename} | baseline:{" "}
                {entry.baselineConfigured ? "yes" : "no"}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
