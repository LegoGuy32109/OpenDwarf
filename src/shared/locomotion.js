// @ts-check

import { isSolid, TICK_MS, WORLD_TOP } from "./world.js";

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world.js').Player} Player */

export const PLAYER_SIZE = 0.5;
/** One tile is a 5 ft square and a D&D round is 6 seconds. */
const FEET_PER_TILE = 5;
const ROUND_SECONDS = 6;
/** Walk speed in feet per round. */
const WALK_SPEED_FT = 30;

/** Convert the walk speed to tiles per second. Sprint doubles it. */
/** @param {boolean} [sprint] */
export function speedTilesPerSecond(sprint = false) {
  return WALK_SPEED_FT / FEET_PER_TILE / ROUND_SECONDS * (sprint ? 2 : 1);
}

const WALK_SPEED = speedTilesPerSecond();
const STEP_TICKS = 6;
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

/**
 * Whether `mover`, already overlapping `other`, steps further from it, so two
 * entities that overlap (a join onto an occupied tile) can walk apart.
 * @param {Player} other @param {Player} mover @param {number} x @param {number} y
 */
function separating(other, mover, x, y) {
  return overlaps(other, mover, mover.x, mover.y, mover.z) &&
    Math.hypot(x - other.x, y - other.y) >
      Math.hypot(mover.x - other.x, mover.y - other.y);
}

/** @param {Player} other @param {Player} mover @param {import('./world.js').Tile|undefined} at @param {number} x @param {number} y @param {number} z */
function reservedAt(other, mover, at, x, y, z) {
  if (!at || z !== at.z) return false;
  const reach =
    ((mover.size ?? PLAYER_SIZE) + (other.size ?? PLAYER_SIZE)) / 2 - EPS;
  return Math.abs(x - at.x) < reach && Math.abs(y - at.y) < reach;
}

/** @param {World} world @param {Player} player @param {number} x @param {number} y @param {number} z */
function entityBlocked(world, player, x, y, z) {
  return Object.values(world.players).some((other) => {
    if (other.id === player.id) return false;
    if (overlaps(other, player, x, y, z) && !separating(other, player, x, y)) {
      return true;
    }
    return reservedAt(other, player, other.move?.origin, x, y, z) ||
      reservedAt(other, player, other.move?.target, x, y, z);
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
  return supported(world, x, y, player.z + 1) &&
    beginStep(world, player, x, y, player.z + 1);
}

/** @param {World} world @param {Player} player @param {number} x @param {number} y */
function tryDescend(world, player, x, y) {
  if (player.z <= 0 || supported(world, x, y, player.z)) return false;
  if (!supported(world, x, y, player.z - 1)) return false;
  const crossedX = centerTile(x) - centerTile(player.x);
  const crossedY = centerTile(y) - centerTile(player.y);
  if (!crossedX && !crossedY) return false;
  const targetX = landingAxis(player, player.x, crossedX || 0);
  const targetY = landingAxis(player, player.y, crossedY || 0);
  return supported(world, targetX, targetY, player.z - 1) &&
    beginStep(world, player, targetX, targetY, player.z - 1);
}

/** Move an entity once at the shared simulation tick. */
/** @param {Player} player @param {number} dx @param {number} dy @param {number} speed */
function updateVelocity(player, dx, dy, speed) {
  const length = Math.hypot(dx, dy);
  const targetX = length ? dx / length * speed : 0;
  const targetY = length ? dy / length * speed : 0;
  const blend = length ? 0.65 : 0.55;
  player.vx = (player.vx ?? 0) + (targetX - (player.vx ?? 0)) * blend;
  player.vy = (player.vy ?? 0) + (targetY - (player.vy ?? 0)) * blend;
  if (Math.abs(player.vx) < 0.015) player.vx = 0;
  if (Math.abs(player.vy) < 0.015) player.vy = 0;
  if (dx) player.facingLeft = dx < 0;
}

/** @param {World} world @param {Player} player @param {number} x @param {number} y @returns {0|1|2} */
function advanceClearPosition(world, player, x, y) {
  if (!supported(world, x, y, player.z)) {
    return tryDescend(world, player, x, y) ? 2 : 0;
  }
  player.x = x;
  player.y = y;
  return 1;
}
/** @param {World} world @param {Player} player @param {number} dx @param {number} dy @returns {0|2|-1} */
function raisedContact(world, player, dx, dy) {
  if (tryClimb(world, player, dx, dy)) return 2;
  // An occupied raised diagonal waits as one contact, rather than sliding around its corner.
  if (
    dx && dy &&
    isSolid(
      world,
      centerTile(player.x) + Math.sign(dx),
      centerTile(player.y) + Math.sign(dy),
      player.z,
    )
  ) {
    player.vx = 0;
    player.vy = 0;
    return -1;
  }
  return 0;
}
/** @param {World} world @param {Player} player @param {number} dx @param {number} dy @param {number} speed @param {number} parts @returns {1|-1} */
function slideTangent(world, player, dx, dy, speed, parts) {
  const sideX = player.x + Math.sign(dx) * speed * TICK_MS / 1000 / parts;
  const sideY = player.y + Math.sign(dy) * speed * TICK_MS / 1000 / parts;
  if (
    dx && clear(world, player, sideX, player.y, player.z) &&
    supported(world, sideX, player.y, player.z)
  ) {
    player.x = sideX;
    return 1;
  }
  if (
    dy && clear(world, player, player.x, sideY, player.z) &&
    supported(world, player.x, sideY, player.z)
  ) {
    player.y = sideY;
    return 1;
  }
  player.vx = 0;
  player.vy = 0;
  return -1;
}
/** @param {World} world @param {Player} player @param {number} dx @param {number} dy @param {number} speed @param {number} parts @returns {1|2|-1} */
function movePart(world, player, dx, dy, speed, parts) {
  const x = player.x + dx, y = player.y + dy;
  if (clear(world, player, x, y, player.z)) {
    const moved = advanceClearPosition(world, player, x, y);
    if (moved) return moved;
  } else if (terrainBlocked(world, player, x, y, player.z)) {
    const contact = raisedContact(world, player, dx, dy);
    if (contact) return contact;
  }
  return slideTangent(world, player, dx, dy, speed, parts);
}

/** @param {World} world @param {string} id @param {number} dx @param {number} dy @param {number} [speed] tiles per second */
export function moveEntity(world, id, dx, dy, speed = WALK_SPEED) {
  const player = world.players[id];
  if (!player?.free || player.move) return false;
  if (!supported(world, player.x, player.y, player.z)) {
    return beginStep(world, player, player.x, player.y, player.z - 1);
  }
  updateVelocity(player, dx, dy, speed);
  let remainingX = (player.vx ?? 0) * TICK_MS / 1000;
  let remainingY = (player.vy ?? 0) * TICK_MS / 1000;
  const parts = Math.max(
    1,
    Math.ceil(Math.hypot(remainingX, remainingY) / 0.04),
  );
  remainingX /= parts;
  remainingY /= parts;
  let changed = false;
  for (let part = 0; part < parts; part++) {
    const result = movePart(
      world,
      player,
      remainingX,
      remainingY,
      speed,
      parts,
    );
    if (result === 2) return true;
    if (result === -1) break;
    changed = true;
  }
  return changed;
}
