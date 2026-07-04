/// <reference lib="dom" />

import {
  CHUNK_EDGE_TILES,
  chunkKeyString,
  chunkOfTile,
  computeStreamingChunks,
  computeVisibleChunks,
  Z_LEVELS_BELOW,
} from "../lib/webgl-chunk-gen.ts";
import {
  advanceWorldMovement,
  entityVisibilityPosition,
  generateWorldSolidChunk,
  recomputeFov,
  startEntityMove,
  type Vec3i,
} from "../lib/webgl-world-sim.ts";
import { getSolidCache } from "./caches/topmost.ts";
import type {
  WebGl2GameState,
  WebGl2UiMode,
  WebGl2ViewMode,
} from "./game-state.ts";

function loadedChunkSet() {
  return new Set(getSolidCache().keys());
}

function deleteLastWord(value: string) {
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
}

export function worldPlayerSnapshot(
  world = null as unknown as {
    entity: { position: { x: number; y: number; z: number } };
  },
) {
  const pos = world.entity.position;
  return { tileX: pos.x, tileY: pos.y, tileZ: pos.z };
}

export function syncScenePlayerFromWorld(state: WebGl2GameState) {
  const pos = state.world.entity.position;
  if (
    pos.x !== state.scene.player.tileX ||
    pos.y !== state.scene.player.tileY ||
    pos.z !== state.scene.player.tileZ
  ) {
    state.scene.player = {
      tileX: pos.x,
      tileY: pos.y,
      tileZ: pos.z,
    };
    state.fovDirty = true;
    state.topmostDirty = true;
  }
}

export function processPlayerMovement(state: WebGl2GameState) {
  if (state.scene.uiMode === "chat") {
    state.playerKeysJustPressed.clear();
    return;
  }

  const isMoving = !!state.world.entity.movement;
  const shouldChainHeld = state.wasMovingLastTick && !isMoving;
  state.wasMovingLastTick = isMoving;

  const jp = state.playerKeysJustPressed;
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
  state.playerKeysJustPressed.clear();
  const justPressedNonZero = justPressedDir.x !== 0 || justPressedDir.y !== 0;

  const h = state.playerKeysHeld;
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
    const result = startEntityMove(state.world, dir, loadedChunkSet());
    if (!result.ok && result.reason !== "moving") {
      state.logs = [`move blocked: ${result.reason}`, ...state.logs].slice(
        0,
        10,
      );
    }
  };

  if (!isMoving) {
    if (justPressedNonZero) {
      tryMove(justPressedDir);
    } else if (shouldChainHeld && heldNonZero) {
      tryMove(heldDir);
    }
  } else if (justPressedNonZero) {
    const mv = state.world.entity.movement!;
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
  state: WebGl2GameState,
) {
  if (state.scene.uiMode === "chat") return;
  const up = state.cameraKeysHeld.has("KeyI");
  const down = state.cameraKeysHeld.has("KeyK");
  const left = state.cameraKeysHeld.has("KeyJ");
  const right = state.cameraKeysHeld.has("KeyL");
  const step = 480 * deltaS;

  if (state.scene.viewMode === "entity") {
    const offset = state.cameraLookOffset;
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
    state.cameraLookOffset = { x: ox, y: oy };
    return;
  }

  if (!up && !down && !left && !right) return;
  const cam = state.scene.camera;
  state.scene.camera = {
    x: cam.x + (left && !right ? -step : right && !left ? step : 0),
    y: cam.y + (up && !down ? -step : down && !up ? step : 0),
    zoom: cam.zoom,
  };
  state.topmostDirty = true;
}

export function processVisibility(state: WebGl2GameState) {
  if (state.scene.viewMode !== "entity") {
    if (state.world.visible.size > 0) {
      state.world.visible = new Set();
      state.scene.visibleTileCount = 0;
      state.scene.rememberedTileCount = state.world.memory.size;
    }
    return;
  }

  if (state.fovDirty) {
    const solidCache = getSolidCache();
    recomputeFov(state.world, (x, y, z) => {
      const { chunkX, chunkY } = chunkOfTile(x, y);
      const chunk = solidCache.get(
        chunkKeyString({ chunkX, chunkY, chunkZ: z }),
      );
      if (!chunk) return undefined;
      const localX = ((x % CHUNK_EDGE_TILES) + CHUNK_EDGE_TILES) %
        CHUNK_EDGE_TILES;
      const localY = ((y % CHUNK_EDGE_TILES) + CHUNK_EDGE_TILES) %
        CHUNK_EDGE_TILES;
      return chunk[localY * CHUNK_EDGE_TILES + localX] === 1;
    });
    state.fovDirty = false;
    state.topmostDirty = true;
  }

  state.scene.visibleTileCount = state.world.visible.size;
  state.scene.rememberedTileCount = state.world.memory.size;
}

export function buildStreamingChunkKeys(
  state: WebGl2GameState,
  currentViewZ: number,
) {
  const viewport = state.scene.viewport;
  const camera = state.scene.camera;
  const visibleXY = computeVisibleChunks(camera, {
    framebufferWidth: viewport.framebufferWidth,
    framebufferHeight: viewport.framebufferHeight,
  });
  const streamingXY = computeStreamingChunks(camera, {
    framebufferWidth: viewport.framebufferWidth,
    framebufferHeight: viewport.framebufferHeight,
  }, 1);

  const visibleChunkKeys = visibleXY.map((key) => ({
    ...key,
    chunkZ: currentViewZ,
  }));
  const streamingChunkKeys = streamingXY.map((key) => ({
    ...key,
    chunkZ: currentViewZ,
  }));

  if (state.scene.viewMode === "entity") {
    const playerChunk = chunkOfTile(
      state.scene.player.tileX,
      state.scene.player.tileY,
    );
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        streamingChunkKeys.push({
          chunkX: playerChunk.chunkX + dx,
          chunkY: playerChunk.chunkY + dy,
          chunkZ: currentViewZ,
        });
      }
    }
  }

  const dedupe = <T extends { chunkX: number; chunkY: number; chunkZ: number }>(
    items: T[],
  ) => [...new Map(items.map((item) => [chunkKeyString(item), item])).values()];

  return {
    visibleChunkKeys: dedupe(visibleChunkKeys),
    streamingChunkKeys: dedupe(streamingChunkKeys),
  };
}

export function updateWorldSolidCache(
  state: WebGl2GameState,
  streamingXYKeys: Array<{ chunkX: number; chunkY: number }>,
  currentViewZ: number,
) {
  const wanted = new Set<string>();
  const visibilityZ = entityVisibilityPosition(state.world.entity).z;
  const minZ = Math.min(currentViewZ - Z_LEVELS_BELOW, visibilityZ - 6);
  const maxZ = Math.max(currentViewZ + 1, visibilityZ + 6);
  for (const { chunkX, chunkY } of streamingXYKeys) {
    for (let z = minZ; z <= maxZ; z++) {
      wanted.add(chunkKeyString({ chunkX, chunkY, chunkZ: z }));
    }
  }

  const solidCache = getSolidCache();
  for (const key of [...solidCache.keys()]) {
    if (!wanted.has(key)) {
      solidCache.delete(key);
    }
  }

  const pendingSet = new Set(state.pendingChunkGeneration);
  state.pendingChunkGeneration = state.pendingChunkGeneration.filter((k) =>
    wanted.has(k)
  );
  for (const key of wanted) {
    if (!solidCache.has(key) && !pendingSet.has(key)) {
      state.pendingChunkGeneration.push(key);
    }
  }
}

export function processPendingSolidChunks(state: WebGl2GameState) {
  const pending = state.pendingChunkGeneration;
  if (pending.length === 0) {
    return;
  }
  const batch = pending.splice(0, 5);
  const solidCache = getSolidCache();
  for (const key of batch) {
    if (!solidCache.has(key)) {
      const [cx, cy, cz] = key.split(",").map(Number);
      solidCache.set(
        key,
        generateWorldSolidChunk(state.world.seed, {
          chunkX: cx,
          chunkY: cy,
          chunkZ: cz,
        }),
      );
    }
  }
  state.topmostDirty = true;
}

export function advanceSimulationTick(state: WebGl2GameState) {
  state.simTick += 1;
  state.eventTick = state.simTick;
  state.world.tick = state.simTick;
  state.simTicksThisSecond += 1;
  processPlayerMovement(state);
  advanceWorldMovement(state.world);
  syncScenePlayerFromWorld(state);
  processVisibility(state);
}

export function openChat(state: WebGl2GameState, initialValue: string) {
  state.scene.uiMode = "chat";
  state.activeTyping = true;
  state.scene.chatBuffer = initialValue;
  if (initialValue.length > 0) {
    state.logs = [`chat open ${JSON.stringify(initialValue)}`, ...state.logs]
      .slice(0, 10);
  }
}

export function closeChat(state: WebGl2GameState) {
  state.scene.uiMode = "world";
  state.activeTyping = false;
  state.scene.chatBuffer = "";
}

export function submitChat(state: WebGl2GameState) {
  const trimmed = state.scene.chatBuffer.trim();
  if (trimmed.length === 0) {
    closeChat(state);
    return;
  }

  if (trimmed.startsWith("/")) {
    const command = trimmed.slice(1).toLowerCase();
    if (command === "master") {
      state.scene.viewMode = "master";
      state.fovDirty = true;
      state.topmostDirty = true;
    } else if (command === "entity") {
      state.scene.viewMode = "entity";
      state.fovDirty = true;
      state.topmostDirty = true;
    }
    closeChat(state);
    return;
  }

  state.scene.chatBubbles = [
    ...state.scene.chatBubbles,
    {
      message: trimmed,
      target: {
        x: state.scene.player.tileX,
        y: state.scene.player.tileY,
        z: state.scene.player.tileZ,
      },
      tick: state.simTick,
    },
  ].slice(-6);
  state.scene.submittedChatMessages = [
    ...state.scene.submittedChatMessages,
    trimmed,
  ].slice(-20);
  closeChat(state);
}

export function deleteChatBufferWord(state: WebGl2GameState) {
  state.scene.chatBuffer = deleteLastWord(state.scene.chatBuffer);
}

export function setViewMode(
  state: WebGl2GameState,
  mode: WebGl2ViewMode,
) {
  state.scene.viewMode = mode;
  state.fovDirty = true;
  state.topmostDirty = true;
}

export function setUiMode(state: WebGl2GameState, mode: WebGl2UiMode) {
  state.scene.uiMode = mode;
  state.activeTyping = mode === "chat";
}
