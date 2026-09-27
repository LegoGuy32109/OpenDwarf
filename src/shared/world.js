// @ts-check

export const WORLD_EDGE = 16;
export const WORLD_TOP = 7;
export const Z_LEVELS_BELOW = 5;
export const TICK_MS = 50;
export const MOVE_TICKS = 10;

/** @typedef {{x:number,y:number,z:number}} Tile */
/** @typedef {{origin:Tile,target:Tile,startPosition:Tile,startTick:number,durationTicks:number,sequence:number}} Move */
/** @typedef {{id:string,name:string,x:number,y:number,z:number,facingLeft:boolean,move:Move|null,typing:boolean,message:string,messageUntil:number}} Player */
/** @typedef {{tick:number,players:Record<string,Player>}} World */

/** @param {number} x @param {number} y @param {number} z */
export function isSolid(x, y, z) {
  if (x < 0 || x >= WORLD_EDGE || y < 0 || y >= WORLD_EDGE) return true;
  if (z < 0) return true;
  if (z > WORLD_TOP) return false;
  if (x === 8 && y === 8) return true;
  // Seven one-tile risers reach player level 7; the landing shares its floor.
  if (y === 13 && x >= 2 && x <= 8) return z <= x - 2;
  if (x >= 9 && x <= 12 && (y === 13 || y === 14)) return z <= 6;
  return false;
}

/** @returns {World} */
export function createWorld() {
  return { tick: 0, players: {} };
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

/** @param {Tile} origin @param {number} dx @param {number} dy */
function resolveMove(origin, dx, dy) {
  const x = origin.x + dx;
  const y = origin.y + dy;
  const z = origin.z;
  if (!isSolid(x, y, z) && isSolid(x, y, z - 1)) return { x, y, z };
  if (
    isSolid(x, y, z) && !isSolid(x, y, z + 1) &&
    !isSolid(origin.x, origin.y, z + 1)
  ) {
    return { x, y, z: z + 1 };
  }
  if (!isSolid(x, y, z) && !isSolid(x, y, z - 1) && isSolid(x, y, z - 2)) {
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
  const target = resolveMove(origin, dx, dy);
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
    dx && dy && (!resolveMove(origin, dx, 0) || !resolveMove(origin, 0, dy))
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
      const move = player.move;
      if (move) {
        const progress = (world.tick - move.startTick) / move.durationTicks;
        if (progress >= 0.75) {
          player.x = move.target.x;
          player.y = move.target.y;
          player.z = move.target.z;
        }
        if (progress >= 1) player.move = null;
      }
      if (player.message && world.tick >= player.messageUntil) {
        player.message = "";
      }
    }
  }
}

/** @param {Player} player @param {number} renderTick */
export function renderPosition(player, renderTick) {
  if (!player.move) return { x: player.x, y: player.y, z: player.z };
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
  player.message = text;
  player.messageUntil = world.tick + 100;
  return true;
}
