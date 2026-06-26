/// <reference lib="dom" />

import { TILE_SIZE_PX } from "../lib/webgl-chunk-gen.ts";
import { createWorldSim, type WorldSimState } from "../lib/webgl-world-sim.ts";

export type WebGl2ViewMode = "entity" | "master";
export type WebGl2UiMode = "world" | "chat";

export type WebGl2ChatBubble = {
  message: string;
  target: { x: number; y: number; z: number };
  tick: number;
};

export type WebGl2SceneState = {
  camera: { x: number; y: number; zoom: number };
  player: { tileX: number; tileY: number; tileZ: number };
  viewMode: WebGl2ViewMode;
  uiMode: WebGl2UiMode;
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
  chatBubbles: WebGl2ChatBubble[];
};

export type WebGl2LayerState = {
  floor: boolean;
  edgeShadow: boolean;
  ceilShadow: boolean;
  depthTint: boolean;
};

export type WebGl2GameState = {
  world: WorldSimState;
  scene: WebGl2SceneState;
  viewZ: number;
  layers: WebGl2LayerState;
  uiOverlayVisible: boolean;
  activeTyping: boolean;
  keysHeld: Set<string>;
  playerKeysHeld: Set<string>;
  playerKeysJustPressed: Set<string>;
  cameraKeysHeld: Set<string>;
  cameraLookOffset: { x: number; y: number };
  wasMovingLastTick: boolean;
  fovDirty: boolean;
  topmostDirty: boolean;
  streamingKeySet: string;
  pendingChunkGeneration: string[];
  smoothPlayerWorldPos: [number, number] | null;
  simAccumulatorMs: number;
  lastFrameTime: number | null;
  frameNumber: number;
  simTick: number;
  eventTick: number;
  simTicksThisSecond: number;
  simTickSecondStart: number;
  simTpsDisplay: number;
  fpsHistory: number[];
  logs: string[];
  status: string;
};

export const DEFAULT_WEBGL2_SEED = "single-rock-step1";

export function createWebGl2GameState(
  seed = DEFAULT_WEBGL2_SEED,
): WebGl2GameState {
  const world = createWorldSim(seed);
  const [playerX, playerY] = [
    world.entity.position.x,
    world.entity.position.y,
  ];

  return {
    world,
    scene: {
      camera: {
        x: (playerX + 0.5) * TILE_SIZE_PX,
        y: (playerY + 0.5) * TILE_SIZE_PX,
        zoom: 1,
      },
      player: {
        tileX: world.entity.position.x,
        tileY: world.entity.position.y,
        tileZ: world.entity.position.z,
      },
      viewMode: "entity",
      uiMode: "world",
      fullscreen: false,
      viewport: {
        cssWidth: 0,
        cssHeight: 0,
        devicePixelRatio: 1,
        framebufferWidth: 0,
        framebufferHeight: 0,
      },
      visibleChunks: [],
      streamingChunks: [],
      residentChunks: 0,
      assetsLoaded: [],
      chatBuffer: "",
      submittedChatMessages: [],
      visibleTileCount: 0,
      rememberedTileCount: 0,
      drawOrderLabels: [],
      chatBubbles: [],
    },
    viewZ: world.entity.position.z,
    layers: {
      floor: true,
      edgeShadow: true,
      ceilShadow: true,
      depthTint: true,
    },
    uiOverlayVisible: false,
    activeTyping: false,
    keysHeld: new Set(),
    playerKeysHeld: new Set(),
    playerKeysJustPressed: new Set(),
    cameraKeysHeld: new Set(),
    cameraLookOffset: { x: 0, y: 0 },
    wasMovingLastTick: false,
    fovDirty: true,
    topmostDirty: true,
    streamingKeySet: "",
    pendingChunkGeneration: [],
    smoothPlayerWorldPos: null,
    simAccumulatorMs: 0,
    lastFrameTime: null,
    frameNumber: 0,
    simTick: 0,
    eventTick: 0,
    simTicksThisSecond: 0,
    simTickSecondStart: performance.now(),
    simTpsDisplay: 0,
    fpsHistory: [],
    logs: [],
    status: "booting",
  };
}
