// @ts-check

export const WORLD_EDGE = 16;
export const TICK_MS = 50;
export const MOVE_TICKS = 10;

/** @typedef {{x:number,y:number}} Tile */
/** @typedef {{origin:Tile,target:Tile,startTick:number,durationTicks:number,sequence:number}} Move */
/** @typedef {{id:string,name:string,x:number,y:number,facingLeft:boolean,move:Move|null,typing:boolean,message:string,messageUntil:number}} Player */
/** @typedef {{tick:number,players:Record<string,Player>}} World */

/** @returns {World} */
export function createWorld() {
  return { tick: 0, players: {} };
}

/** @param {World} world @param {string} id @param {Tile} [spawn] */
export function addPlayer(world, id, spawn = { x: 7, y: 7 }) {
  if (world.players[id]) return world.players[id];
  const player = {
    id,
    name: "",
    x: spawn.x,
    y: spawn.y,
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

/** @param {World} world @param {string} id @param {number} dx @param {number} dy @param {number} sequence */
export function startMove(world, id, dx, dy, sequence) {
  const player = world.players[id];
  if (!player) return { ok: false, reason: "unknown player" };
  if (
    !Number.isInteger(dx) || !Number.isInteger(dy) ||
    Math.abs(dx) > 1 || Math.abs(dy) > 1 || (!dx && !dy)
  ) {
    return { ok: false, reason: "invalid direction" };
  }
  if (player.move) return { ok: false, reason: "already moving" };
  const target = { x: player.x + dx, y: player.y + dy };
  if (
    target.x < 0 || target.x >= WORLD_EDGE || target.y < 0 ||
    target.y >= WORLD_EDGE
  ) {
    return { ok: false, reason: "world edge" };
  }
  const move = {
    origin: { x: player.x, y: player.y },
    target,
    startTick: world.tick,
    durationTicks: dx && dy ? Math.ceil(MOVE_TICKS * Math.SQRT2) : MOVE_TICKS,
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
      if (
        player.move &&
        world.tick >= player.move.startTick + player.move.durationTicks
      ) {
        player.x = player.move.target.x;
        player.y = player.move.target.y;
        player.move = null;
      }
      if (player.message && world.tick >= player.messageUntil) {
        player.message = "";
      }
    }
  }
}

/** @param {Player} player @param {number} renderTick */
export function renderPosition(player, renderTick) {
  if (!player.move) return { x: player.x, y: player.y };
  const move = player.move;
  const alpha = Math.max(
    0,
    Math.min(1, (renderTick - move.startTick) / move.durationTicks),
  );
  return {
    x: move.origin.x + (move.target.x - move.origin.x) * alpha,
    y: move.origin.y + (move.target.y - move.origin.y) * alpha,
  };
}

/** @param {Player} player @param {number} tick */
export function occupiedTiles(player, tick) {
  if (!player.move) return [{ x: player.x, y: player.y }];
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
