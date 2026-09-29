// @ts-check

import { isSolid, TICK_MS, WORLD_TOP } from "./world.js";

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world.js').Player} Player */

export const PLAYER_SIZE = 0.5;
export const WALK_SPEED = 2.8;
export const STEP_TICKS = 6;
const EPS = 0.001;

/** @param {number} coordinate */
export const centerTile = (coordinate) => Math.floor(coordinate + 0.5);

/** @param {Player} player @param {number} [size] */
export function enableLocomotion(player, size = PLAYER_SIZE) {
  player.free = true;
  player.size = size;
  player.vx = 0;
  player.vy = 0;
  player.previousX = player.x;
  player.previousY = player.y;
  return player;
}

/** @param {number} center @param {number} size */
function cells(center, size) {
  return [
    centerTile(center - size / 2 + EPS),
    centerTile(center + size / 2 - EPS),
  ];
}

/** @param {Player} other @param {Player} mover @param {number} x @param {number} y @param {number} z */
function overlaps(other, mover, x, y, z) {
  const reach = ((other.size ?? PLAYER_SIZE) +
        (mover.size ?? PLAYER_SIZE)) / 2 - EPS;
  return z >= other.z && z < other.z + 1 &&
    Math.abs(x - other.x) < reach && Math.abs(y - other.y) < reach;
}

/** @param {World} world @param {Player} player @param {number} x @param {number} y @param {number} z */
function entityBlocked(world, player, x, y, z) {
  return Object.values(world.players).some((other) => {
    if (other.id === player.id) return false;
    if (overlaps(other, player, x, y, z)) return true;
    const origin = other.move?.origin;
    if (
      origin && z === origin.z &&
      Math.abs(x - origin.x) <
        ((player.size ?? PLAYER_SIZE) + (other.size ?? PLAYER_SIZE)) / 2 -
          EPS &&
      Math.abs(y - origin.y) <
        ((player.size ?? PLAYER_SIZE) + (other.size ?? PLAYER_SIZE)) / 2 - EPS
    ) {
      return true;
    }
    const target = other.move?.target;
    return !!target && z === target.z &&
      Math.abs(x - target.x) <
        ((player.size ?? PLAYER_SIZE) + (other.size ?? PLAYER_SIZE)) / 2 -
          EPS &&
      Math.abs(y - target.y) <
        ((player.size ?? PLAYER_SIZE) + (other.size ?? PLAYER_SIZE)) / 2 - EPS;
  });
}

/** @param {World} world @param {Player} player @param {number} x @param {number} y @param {number} z */
function terrainBlocked(world, player, x, y, z) {
  const size = player.size ?? PLAYER_SIZE;
  const [left, right] = cells(x, size);
  const [top, bottom] = cells(y, size);
  for (let ty = top; ty <= bottom; ty++) {
    for (let tx = left; tx <= right; tx++) {
      if (isSolid(world, tx, ty, z)) return true;
    }
  }
  return false;
}

/** @param {World} world @param {Player} player @param {number} x @param {number} y @param {number} z */
function clear(world, player, x, y, z) {
  return !terrainBlocked(world, player, x, y, z) &&
    !entityBlocked(world, player, x, y, z);
}

/** @param {World} world @param {number} x @param {number} y @param {number} z */
function supported(world, x, y, z) {
  return isSolid(world, centerTile(x), centerTile(y), z - 1);
}

/** @param {Player} player @param {number} axis @param {number} direction */
function landingAxis(player, axis, direction) {
  if (!direction) return axis;
  const origin = centerTile(axis);
  return origin + direction * (0.5 + (player.size ?? PLAYER_SIZE) / 2 + EPS);
}

/** @param {World} world @param {Player} player @param {number} x @param {number} y @param {number} z */
function beginStep(world, player, x, y, z) {
  if (z < 0 || z > WORLD_TOP || !clear(world, player, x, y, z)) {
    return false;
  }
  const origin = { x: player.x, y: player.y, z: player.z };
  const target = { x, y, z };
  player.move = {
    origin,
    target,
    startPosition: origin,
    startTick: world.tick,
    durationTicks: STEP_TICKS,
    sequence: world.tick,
  };
  player.vx = 0;
  player.vy = 0;
  return true;
}

/** @param {World} world @param {Player} player @param {number} dx @param {number} dy */
function tryClimb(world, player, dx, dy) {
  if (player.z >= WORLD_TOP) return false;
  const tx = centerTile(player.x) + Math.sign(dx);
  const ty = centerTile(player.y) + Math.sign(dy);
  if (!isSolid(world, tx, ty, player.z)) return false;
  const x = landingAxis(player, player.x, Math.sign(dx));
  const y = landingAxis(player, player.y, Math.sign(dy));
  if (!clear(world, player, player.x, player.y, player.z + 1)) {
    return false;
  }
  return beginStep(world, player, x, y, player.z + 1);
}

/** @param {World} world @param {Player} player @param {number} x @param {number} y @param {number} dx @param {number} dy */
function tryDescend(world, player, x, y, dx, dy) {
  if (player.z <= 0 || supported(world, x, y, player.z)) return false;
  if (!supported(world, x, y, player.z - 1)) return false;
  const targetX = landingAxis(player, player.x, Math.sign(dx));
  const targetY = landingAxis(player, player.y, Math.sign(dy));
  return beginStep(world, player, targetX, targetY, player.z - 1);
}

/** Move an entity once at the shared simulation tick. */
/** @param {World} world @param {string} id @param {number} dx @param {number} dy */
export function moveEntity(world, id, dx, dy) {
  const player = world.players[id];
  if (!player?.free || player.move) return false;
  if (!supported(world, player.x, player.y, player.z)) {
    return beginStep(world, player, player.x, player.y, player.z - 1);
  }
  const length = Math.hypot(dx, dy);
  const targetX = length ? dx / length * WALK_SPEED : 0;
  const targetY = length ? dy / length * WALK_SPEED : 0;
  const blend = length ? 0.65 : 0.55;
  player.vx = (player.vx ?? 0) + (targetX - (player.vx ?? 0)) * blend;
  player.vy = (player.vy ?? 0) + (targetY - (player.vy ?? 0)) * blend;
  if (Math.abs(player.vx) < 0.015) player.vx = 0;
  if (Math.abs(player.vy) < 0.015) player.vy = 0;
  if (dx) player.facingLeft = dx < 0;
  let remainingX = player.vx * TICK_MS / 1000;
  let remainingY = player.vy * TICK_MS / 1000;
  const parts = Math.max(
    1,
    Math.ceil(Math.hypot(remainingX, remainingY) / 0.04),
  );
  remainingX /= parts;
  remainingY /= parts;
  let changed = false;
  for (let part = 0; part < parts; part++) {
    const x = player.x + remainingX;
    const y = player.y + remainingY;
    if (clear(world, player, x, y, player.z)) {
      if (!supported(world, x, y, player.z)) {
        if (tryDescend(world, player, x, y, remainingX, remainingY)) {
          return true;
        }
      } else {
        player.x = x;
        player.y = y;
        changed = true;
        continue;
      }
    } else if (terrainBlocked(world, player, x, y, player.z)) {
      if (tryClimb(world, player, remainingX, remainingY)) return true;
      // A raised diagonal corner is one contact, not two independent walls.
      // If its landing is occupied, wait for the whole corner to clear.
      if (
        remainingX && remainingY &&
        isSolid(
          world,
          centerTile(player.x) + Math.sign(remainingX),
          centerTile(player.y) + Math.sign(remainingY),
          player.z,
        )
      ) {
        player.vx = 0;
        player.vy = 0;
        break;
      }
    }
    // A flat wall keeps the free tangent component at walking speed.
    const sideX = player.x + Math.sign(remainingX) * WALK_SPEED * TICK_MS /
        1000 / parts;
    const sideY = player.y + Math.sign(remainingY) * WALK_SPEED * TICK_MS /
        1000 / parts;
    if (
      remainingX && clear(world, player, sideX, player.y, player.z) &&
      supported(world, sideX, player.y, player.z)
    ) {
      player.x = sideX;
      changed = true;
    } else if (
      remainingY && clear(world, player, player.x, sideY, player.z) &&
      supported(world, player.x, sideY, player.z)
    ) {
      player.y = sideY;
      changed = true;
    } else {
      player.vx = 0;
      player.vy = 0;
      break;
    }
  }
  return changed;
}
