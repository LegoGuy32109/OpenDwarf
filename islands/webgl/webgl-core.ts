import type { PerfWindow } from "../../lib/webgl-harness-types.ts";

export type WebGlCapabilityReport = {
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

export type WebGlViewMode = "entity" | "master";
export type WebGlUiMode = "world" | "chat";

export type PlayerState = {
  tileX: number;
  tileY: number;
  tileZ: number;
};

export type ChatBubbleRecord = {
  message: string;
  target: PlayerState;
  tick: number;
};

export type CameraLookOffset = {
  x: number;
  y: number;
};

export type FrameMetric = {
  cpuMs: number;
  drawCalls: number;
  uploadBytes: number;
  visibleChunks: number;
};

export type WebGlSceneSnapshot = {
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

export type ReplayEvent =
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

export type InputLogEvent =
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

export type WebGlCheckpointRecord = {
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

export type WebGlScreenshotBaselineManifest = {
  version: 1;
  flow: string;
  screenshots: Record<string, { path: string; sha256?: string }>;
};

export type ReplayDocument = {
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

export type ReplayPreview = {
  eventCount: number;
  checkpointCount: number;
  lastResize: ReplayEvent | null;
  fullscreenActive: boolean;
  textureCount: number;
  screenshotCount: number;
};

export type WebGlArtifactManifest = {
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

export type WebGlSerializableArtifact = {
  filename: string;
  dataUrl: string;
};

export type WebGlExportBundleData = {
  replayJson: string;
  manifestJson: string;
  frames: WebGlSerializableArtifact[];
  screenshots: WebGlSerializableArtifact[];
  states: WebGlSerializableArtifact[];
};

export type WebGlTestHarness = {
  loadFlow: (
    descriptor: import("../../lib/webgl-harness-types.ts").FlowDescriptor,
  ) => void;
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

export const FLOW_NAME = "webgl-step1-single-rock";
export const SEED_NAME = "single-rock-step1";
export const TILE_TEXTURE_SRC = "/assets/sprites/StackedTextures.png";
export const PLAYER_TEXTURE_SRC = "/assets/sprites/Dwarf_16x16.png";
export const SHADOW_TEXTURE_SRC = "/assets/atlases/ShadowAtlas.png";
export const CEIL_SHADOW_TEXTURE_SRC = "/assets/atlases/ObscureAtlas.png";
export const SHADOW_ALPHA_MULTIPLIER = 0.55;
export const EDGE_SEGMENT_DARK_ALPHA = 0.28;
export const EDGE_SEGMENT_LIGHT_ALPHA = 0.11;
export const EDGE_SEGMENT_BAND_PX = 4;
export const STREAM_PADDING = 1;
export const MAX_STREAMING_CHUNKS = 64;
export const PLAYER_KEYS = new Set(["KeyE", "KeyS", "KeyD", "KeyF"]);
export const CAMERA_KEYS = new Set(["KeyI", "KeyJ", "KeyK", "KeyL"]);

export function createRunId() {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const entropy = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
    .toString(16)
    .padStart(8, "0");
  return `${stamp}__${entropy}`;
}

export function slugifyName(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(
    /_+/g,
    "_",
  ).replace(/^_|_$/g, "");
}

export function makeArtifactFilename(
  ordinal: number,
  name: string,
  extension: string,
) {
  return `${FLOW_NAME}__${String(ordinal).padStart(3, "0")}__${
    slugifyName(name)
  }.${extension}`;
}

export function makeStateFilename(ordinal: number, name: string) {
  return `${FLOW_NAME}__${String(ordinal).padStart(3, "0")}__${
    slugifyName(name)
  }.json`;
}

export function browserVersionFromUserAgent(userAgent: string) {
  const chromeMatch = userAgent.match(/Chrome\/([0-9.]+)/);
  if (chromeMatch) return chromeMatch[1];
  const firefoxMatch = userAgent.match(/Firefox\/([0-9.]+)/);
  if (firefoxMatch) return firefoxMatch[1];
  const safariMatch = userAgent.match(/Version\/([0-9.]+).*Safari\//);
  if (safariMatch) return safariMatch[1];
  return null;
}

export async function hashJson(value: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `sha256:${bytes}`;
}

export function createJsonBlob(value: unknown) {
  return new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json;charset=utf-8",
  });
}

export function buildSceneHash(
  snapshot: Omit<WebGlSceneSnapshot, "sceneHash" | "perf">,
) {
  return hashJson(snapshot);
}

export function computePerfWindow(metrics: FrameMetric[]): PerfWindow {
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

export function waitForAnimationFrame() {
  return new Promise<void>((resolve) => {
    const raf = (
      globalThis as unknown as {
        requestAnimationFrame: (callback: () => void) => number;
      }
    ).requestAnimationFrame;
    raf(() => resolve());
  });
}

export function summarizeReplay(events: ReplayEvent[]): ReplayPreview {
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
