/// <reference lib="dom" />

import {
  CHUNK_EDGE_TILES,
  chunkKeyString,
  chunkOfTile,
  computeStreamingChunks,
  Z_LEVELS_BELOW,
} from "../../lib/webgl-chunk-gen.ts";
import {
  advanceWorldMovement,
  entityVisibilityPosition,
  generateWorldSolidChunk,
  recomputeFov,
  startEntityMove,
  type Vec3i,
  type WorldSimState,
} from "../../lib/webgl-world-sim.ts";
import {
  type CameraLookOffset,
  type PlayerState,
  STREAM_PADDING,
  type WebGlUiMode,
  type WebGlViewMode,
} from "./webgl-core.ts";

type Ref<T> = { current: T };

type SceneState = {
  camera: { x: number; y: number; zoom: number };
  player: PlayerState;
  viewMode: WebGlViewMode;
  uiMode: WebGlUiMode;
  viewport: {
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

type RuntimeArgs = {
  worldRef: Ref<WorldSimState>;
  sceneStateRef: Ref<SceneState>;
  solidCacheRef: Ref<Map<string, Uint8Array>>;
  pendingChunkGenerationRef: Ref<string[]>;
  playerKeysHeldRef: Ref<Set<string>>;
  playerKeysJustPressedRef: Ref<Set<string>>;
  cameraKeysHeldRef: Ref<Set<string>>;
  wasMovingLastTickRef: Ref<boolean>;
  cameraLookOffsetRef: Ref<CameraLookOffset>;
  fovDirtyRef: Ref<boolean>;
  topmostCacheDirtyRef: Ref<boolean>;
  streamingKeySetRef: Ref<string>;
  viewModeRef: Ref<WebGlViewMode>;
  uiModeRef: Ref<WebGlUiMode>;
  simTickRef: Ref<number>;
  eventTickRef: Ref<number>;
  simTicksThisSecondRef: Ref<number>;
  simTickSecondStartRef: Ref<number>;
  appendLog: (text: string) => void;
};

function loadedChunkSet(solidCacheRef: Ref<Map<string, Uint8Array>>) {
  return new Set(solidCacheRef.current.keys());
}

export function worldPlayerSnapshot(world: WorldSimState): PlayerState {
  const pos = world.entity.position;
  return { tileX: pos.x, tileY: pos.y, tileZ: pos.z };
}

export function syncScenePlayerFromWorld(
  worldRef: Ref<WorldSimState>,
  sceneStateRef: Ref<SceneState>,
  fovDirtyRef: Ref<boolean>,
) {
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
}

export function processPlayerMovement(args: RuntimeArgs) {
  const {
    worldRef,
    playerKeysHeldRef,
    playerKeysJustPressedRef,
    uiModeRef,
    wasMovingLastTickRef,
    appendLog,
  } = args;

  if (uiModeRef.current === "chat") {
    playerKeysJustPressedRef.current.clear();
    return;
  }

  const isMoving = !!worldRef.current.entity.movement;
  const wasMoving = wasMovingLastTickRef.current;
  wasMovingLastTickRef.current = isMoving;
  const shouldChainHeld = wasMoving && !isMoving;

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
    const result = startEntityMove(
      worldRef.current,
      dir,
      loadedChunkSet(args.solidCacheRef),
    );
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
    const activeInHeld = (heldDir.x !== 0 || heldDir.y !== 0) &&
      (activeDir.x === 0 || Math.sign(heldDir.x) === activeDir.x) &&
      (activeDir.y === 0 || Math.sign(heldDir.y) === activeDir.y);
    const sameAsActive = justPressedDir.x === activeDir.x &&
      justPressedDir.y === activeDir.y;
    if (!sameAsActive && !activeInHeld) {
      tryMove(justPressedDir);
    }
  }
}

export function processCameraMovement(
  deltaS: number,
  args: {
    uiModeRef: Ref<WebGlUiMode>;
    viewModeRef: Ref<WebGlViewMode>;
    cameraKeysHeldRef: Ref<Set<string>>;
    cameraLookOffsetRef: Ref<CameraLookOffset>;
    sceneStateRef: Ref<SceneState>;
    cameraSpeedPxPerS: number;
  },
) {
  if (args.uiModeRef.current === "chat") return;
  const up = args.cameraKeysHeldRef.current.has("KeyI");
  const down = args.cameraKeysHeldRef.current.has("KeyK");
  const left = args.cameraKeysHeldRef.current.has("KeyJ");
  const right = args.cameraKeysHeldRef.current.has("KeyL");
  const step = args.cameraSpeedPxPerS * deltaS;

  if (args.viewModeRef.current === "entity") {
    const offset = args.cameraLookOffsetRef.current;
    let ox = offset.x;
    let oy = offset.y;
    if (up && !down) oy -= step;
    if (down && !up) oy += step;
    if (left && !right) ox -= step;
    if (right && !left) ox += step;
    if (!up && !down && !left && !right) {
      const returnRate = 1 - Math.exp(-5 * deltaS);
      ox += (0 - ox) * returnRate;
      oy += (0 - oy) * returnRate;
      if (Math.abs(ox) < 0.5) ox = 0;
      if (Math.abs(oy) < 0.5) oy = 0;
    }
    args.cameraLookOffsetRef.current = { x: ox, y: oy };
    return;
  }

  if (!up && !down && !left && !right) return;
  const cam = args.sceneStateRef.current.camera;
  args.sceneStateRef.current.camera = {
    x: cam.x + (left && !right ? -step : right && !left ? step : 0),
    y: cam.y + (up && !down ? -step : down && !up ? step : 0),
    zoom: cam.zoom,
  };
}

export function processVisibility(
  args: {
    worldRef: Ref<WorldSimState>;
    sceneStateRef: Ref<SceneState>;
    viewModeRef: Ref<WebGlViewMode>;
    fovDirtyRef: Ref<boolean>;
    solidCacheRef: Ref<Map<string, Uint8Array>>;
    topmostCacheDirtyRef: Ref<boolean>;
  },
) {
  if (args.viewModeRef.current !== "entity") {
    if (args.worldRef.current.visible.size > 0) {
      args.worldRef.current.visible = new Set();
      args.sceneStateRef.current.visibleTileCount = 0;
      args.sceneStateRef.current.rememberedTileCount = args.worldRef.current.memory.size;
    }
    return;
  }

  if (args.fovDirtyRef.current) {
    const solidCache = args.solidCacheRef.current;
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
    recomputeFov(args.worldRef.current, solidCheck);
    args.fovDirtyRef.current = false;
    args.topmostCacheDirtyRef.current = true;
  }
  args.sceneStateRef.current.visibleTileCount = args.worldRef.current.visible.size;
  args.sceneStateRef.current.rememberedTileCount = args.worldRef.current.memory.size;
}

export function buildStreamingChunkKeys(
  sceneStateRef: Ref<SceneState>,
  viewModeRef: Ref<WebGlViewMode>,
  currentViewZ: number,
) {
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
}

export function updateWorldSolidCache(
  worldRef: Ref<WorldSimState>,
  solidCacheRef: Ref<Map<string, Uint8Array>>,
  pendingChunkGenerationRef: Ref<string[]>,
  streamingXYKeys: Array<{ chunkX: number; chunkY: number }>,
  currentViewZ: number,
) {
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

  const pendingSet = new Set(pendingChunkGenerationRef.current);
  pendingChunkGenerationRef.current = pendingChunkGenerationRef.current.filter(
    (k) => wanted.has(k),
  );
  for (const key of wanted) {
    if (!solidCacheRef.current.has(key) && !pendingSet.has(key)) {
      pendingChunkGenerationRef.current.push(key);
    }
  }
}

export function advanceSimulationTick(args: {
  simTickRef: Ref<number>;
  eventTickRef: Ref<number>;
  simTicksThisSecondRef: Ref<number>;
  worldRef: Ref<WorldSimState>;
  processPlayerMovement: () => void;
  processVisibility: () => void;
  syncScenePlayerFromWorld: () => void;
}) {
  args.simTickRef.current += 1;
  args.eventTickRef.current = args.simTickRef.current;
  args.worldRef.current.tick = args.simTickRef.current;
  args.simTicksThisSecondRef.current += 1;
  args.processPlayerMovement();
  advanceWorldMovement(args.worldRef.current);
  args.syncScenePlayerFromWorld();
  args.processVisibility();
}

export function createSolidChunkCache(
  seed: string,
  chunkX: number,
  chunkY: number,
  chunkZ: number,
) {
  return generateWorldSolidChunk(seed, { chunkX, chunkY, chunkZ });
}
