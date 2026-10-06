// @ts-check

import {
  CHUNK_EDGE,
  chunkIndex,
  createChunkData,
  getChunk,
  OPEN,
  setChunk,
  UNKNOWN,
  WORLD_TOP,
} from "./terrain.js";

export { WORLD_TOP };
/** Edge of one chunk, and of the default authored area. */
export const WORLD_EDGE = CHUNK_EDGE;
export const EXPANDED_WORLD_EDGE = 32;
export const Z_LEVELS_BELOW = 5;
export const TICK_MS = 50;
export const MAX_BUBBLES = 3;
const BUBBLE_BASE_TICKS = 100;
const BUBBLE_LONG_LENGTH = 40;

/** Five seconds, plus one tick per character past 40 so long messages can be read. @param {string} text */
export function bubbleTicks(text) {
  return BUBBLE_BASE_TICKS + Math.max(0, text.length - BUBBLE_LONG_LENGTH);
}
export const MOVE_TICKS = 10;

/** @typedef {{x:number,y:number,z:number}} Tile */
/** @typedef {{origin:Tile,target:Tile,startPosition:Tile,startTick:number,durationTicks:number,sequence:number}} Move */
/** @typedef {{from:Tile,to:Tile,startTick:number,durationTicks:number,sequence:number,entering:boolean}} ViewMotion */
/** `start` is the tick its speech begins; a later start means it waits in the queue (ADR 0006). */
/** @typedef {{text:string,until:number,start?:number}} Bubble */
/** @typedef {{id:string,name:string,x:number,y:number,z:number,facingLeft:boolean,move:Move|null,typing:boolean,message:string,messageUntil:number,messages?:Bubble[],viewMotion?:ViewMotion,free?:boolean,size?:number,vx?:number,vy?:number,previousX?:number,previousY?:number}} Player */
/** @typedef {import('./terrain.js').ChunkData} ChunkData */
/** @typedef {{tick:number,chunks:Map<string,ChunkData>,players:Record<string,Player>,generateChunk?:((cx:number,cy:number)=>ChunkData)|null,changes?:Map<string,import('./terrain.js').TileChange>,pinned?:Set<string>,edits?:Map<string,Map<number,number>>}} World */

/**
 * A tile blocks movement and sight unless its material is open. Unknown
 * terrain blocks local prediction until the host reveals it. A missing chunk is
 * solid stone at every level.
 * @param {World} world @param {number} x @param {number} y @param {number} z
 */
export function isSolid(world, x, y, z) {
  if (z < 0) return true;
  // Tile coordinates are integers, so shifts and masks equal floor and modulo.
  const chunk = getChunk(world, x >> 4, y >> 4);
  if (!chunk) return true;
  if (z > WORLD_TOP) return false;
  return chunk[chunkIndex(x & 15, y & 15, z)] !== OPEN;
}

/**
 * Create a world whose authored area has `edge`×`edge` tiles of unknown terrain.
 * Tiles outside it read as solid stone until a chunk is created.
 * @param {number} [edge]
 * @returns {World}
 */
export function createWorld(edge = WORLD_EDGE) {
  if (edge !== WORLD_EDGE && edge !== EXPANDED_WORLD_EDGE) {
    throw new RangeError("unsupported authored area size");
  }
  /** @type {World} */
  const world = { tick: 0, chunks: new Map(), players: {} };
  for (let cy = 0; cy < edge / CHUNK_EDGE; cy++) {
    for (let cx = 0; cx < edge / CHUNK_EDGE; cx++) {
      setChunk(world, cx, cy, createChunkData(UNKNOWN));
    }
  }
  return world;
}

/** @param {World} world @param {string} id @param {Tile} [spawn] */
export function addPlayer(world, id, spawn = { x: 7, y: 7, z: 0 }) {
  if (world.players[id]) return world.players[id];
  const player = {
    id,
    name: "",
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    facingLeft: false,
    move: null,
    typing: false,
    message: "",
    messageUntil: 0,
  };
  world.players[id] = player;
  return player;
}

/** @param {World} world @param {string} id */
export function removePlayer(world, id) {
  delete world.players[id];
}

/** @param {World} world @param {string} id @param {string} requested */
export function setNickname(world, id, requested) {
  const player = world.players[id];
  if (!player) return { ok: false, reason: "unknown player" };
  const name = requested.trim().replace(/\s+/g, " ");
  if (
    !name || name.length > 24 ||
    [...name].some((char) =>
      char === "<" || char === ">" || char.charCodeAt(0) < 32
    )
  ) {
    return { ok: false, reason: "use 1–24 plain characters" };
  }
  const taken = Object.values(world.players).some((other) =>
    other.id !== id &&
    other.name.toLocaleLowerCase() === name.toLocaleLowerCase()
  );
  if (taken) return { ok: false, reason: "name is taken" };
  player.name = name;
  return { ok: true, name };
}

/** @param {World} world @param {Tile} origin @param {number} dx @param {number} dy */
function resolveMove(world, origin, dx, dy) {
  const x = origin.x + dx;
  const y = origin.y + dy;
  const z = origin.z;
  if (!isSolid(world, x, y, z) && isSolid(world, x, y, z - 1)) {
    return { x, y, z };
  }
  if (
    isSolid(world, x, y, z) && !isSolid(world, x, y, z + 1) &&
    !isSolid(world, origin.x, origin.y, z + 1)
  ) {
    return { x, y, z: z + 1 };
  }
  if (
    !isSolid(world, x, y, z) && !isSolid(world, x, y, z - 1) &&
    isSolid(world, x, y, z - 2)
  ) {
    return { x, y, z: z - 1 };
  }
  return null;
}

/** @param {World} world @param {string} id @param {number} dx @param {number} dy @param {number} sequence */
export function startMove(world, id, dx, dy, sequence) {
  const player = world.players[id];
  if (!player) return { ok: false, reason: "unknown player" };
  if (
    !Number.isInteger(dx) || !Number.isInteger(dy) ||
    Math.abs(dx) > 1 || Math.abs(dy) > 1 || (!dx && !dy)
  ) return { ok: false, reason: "invalid direction" };
  const origin = { x: player.x, y: player.y, z: player.z };
  if (
    dx && dy &&
    (isSolid(world, origin.x + dx, origin.y, origin.z) ||
      isSolid(world, origin.x, origin.y + dy, origin.z))
  ) return { ok: false, reason: "blocked corner" };
  const target = resolveMove(world, origin, dx, dy);
  if (!target) return { ok: false, reason: "blocked" };
  if (
    Object.values(world.players).some((other) =>
      other.id !== id &&
      occupiedTiles(other, world.tick).some((tile) =>
        tile.x === target.x && tile.y === target.y && tile.z === target.z
      )
    )
  ) return { ok: false, reason: "occupied" };
  if (
    dx && dy &&
    (!resolveMove(world, origin, dx, 0) || !resolveMove(world, origin, 0, dy))
  ) {
    return { ok: false, reason: "blocked corner" };
  }
  if (player.move) {
    const active = player.move;
    if (
      Math.sign(active.target.x - active.origin.x) === dx &&
      Math.sign(active.target.y - active.origin.y) === dy
    ) {
      return { ok: false, reason: "already moving" };
    }
  }
  const startPosition = renderPosition(player, world.tick);
  const durationTicks = Math.max(
    1,
    Math.ceil(
      Math.hypot(
        target.x - startPosition.x,
        target.y - startPosition.y,
        target.z - startPosition.z,
      ) * MOVE_TICKS,
    ),
  );
  const move = {
    origin,
    target,
    startPosition,
    startTick: world.tick,
    durationTicks,
    sequence,
  };
  player.move = move;
  if (dx) player.facingLeft = dx < 0;
  return { ok: true, move };
}

/** @param {World} world @param {number} [count] */
export function advanceTicks(world, count = 1) {
  for (let i = 0; i < count; i++) {
    world.tick++;
    for (const player of Object.values(world.players)) {
      if (player.free) {
        player.previousX = player.x;
        player.previousY = player.y;
      }
      const move = player.move;
      if (move) {
        const progress = (world.tick - move.startTick) / move.durationTicks;
        if (progress >= 0.75) {
          player.x = move.target.x;
          player.y = move.target.y;
          player.z = move.target.z;
        }
        if (progress >= 1) {
          player.x = move.target.x;
          player.y = move.target.y;
          player.z = move.target.z;
          player.move = null;
        }
      }
      if (player.messages) {
        player.messages = player.messages.filter((bubble) =>
          world.tick < bubble.until
        );
      }
      if (player.message && world.tick >= player.messageUntil) {
        player.message = "";
      }
    }
  }
}

/** @param {Player} player @param {number} renderTick */
export function renderPosition(player, renderTick) {
  if (!player.move) {
    const alpha = player.free ? renderTick - Math.floor(renderTick) : 0;
    return {
      x: (player.previousX ?? player.x) * (1 - alpha) + player.x * alpha,
      y: (player.previousY ?? player.y) * (1 - alpha) + player.y * alpha,
      z: player.z,
    };
  }
  const move = player.move;
  const alpha = Math.max(
    0,
    Math.min(1, (renderTick - move.startTick) / move.durationTicks),
  );
  return {
    x: move.startPosition.x + (move.target.x - move.startPosition.x) * alpha,
    y: move.startPosition.y + (move.target.y - move.startPosition.y) * alpha,
    z: move.startPosition.z + (move.target.z - move.startPosition.z) * alpha,
  };
}

/** @param {Player} player @param {number} tick */
export function occupiedTiles(player, tick) {
  if (!player.move) return [{ x: player.x, y: player.y, z: player.z }];
  const progress = (tick - player.move.startTick) / player.move.durationTicks;
  return [
    ...(progress < 0.75 ? [player.move.origin] : []),
    ...(progress >= 0.25 ? [player.move.target] : []),
  ];
}

/** @param {World} world @param {string} id @param {boolean} typing */
export function setTyping(world, id, typing) {
  const player = world.players[id];
  if (player) player.typing = typing;
}

/** @param {World} world @param {string} id @param {string} message */
export function submitMessage(world, id, message) {
  const player = world.players[id];
  if (!player) return false;
  const text = message.trim().slice(0, 120);
  player.typing = false;
  if (!text) return false;
  const live = (player.messages ?? []).filter((bubble) =>
    world.tick < bubble.until
  );
  const until = Math.max(
    world.tick + bubbleTicks(text),
    ...live.map((bubble) => bubble.until),
  );
  player.messages = [...live, { text, until }].slice(-MAX_BUBBLES);
  player.message = text;
  player.messageUntil = until;
  return true;
}
