// @ts-check
// Host-owned item flight. Coordinates use tile centers, matching locomotion.
import { dropItem, hasItemTag, inventoryOf, takeStack } from "./items.js";
import { heldItem } from "./mining.js";
import { centerTile } from "./locomotion.js";
import { PLAY_Z, THROW_RANGE, THROW_SPEED } from "./single-plane.js";
import { OPEN, readTile } from "./terrain.js";
import { TICK_MS } from "./world.js";

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./single-plane.js').ThrownItem} ThrownItem */
/** @type {WeakMap<World,number>} */
const sequences = new WeakMap();

/** Accept exactly one equipped item; all checks precede inventory mutation.
 * @param {World} world @param {string} id @param {unknown} dx @param {unknown} dy
 */
export function startThrow(world, id, dx, dy) {
  const player = world.players[id];
  if (!player) return { ok: false, reason: "unknown player" };
  if (
    typeof dx !== "number" || typeof dy !== "number" ||
    !Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) > 1 ||
    Math.abs(dy) > 1 || (!dx && !dy)
  ) return { ok: false, reason: "invalid direction" };
  if (
    player.z !== PLAY_Z ||
    (world.planeZ !== undefined && world.planeZ !== PLAY_Z)
  ) {
    return { ok: false, reason: "not on the play plane" };
  }
  if (
    !Number.isFinite(player.x) || !Number.isFinite(player.y) ||
    readTile(world, centerTile(player.x), centerTile(player.y), PLAY_Z) !== OPEN
  ) {
    return { ok: false, reason: "invalid origin" };
  }
  const kind = heldItem(player);
  const inventory = inventoryOf(player);
  const index = inventory.findIndex((stack) => stack.kind === kind);
  if (
    !hasItemTag(kind, "throwable") || index < 0 ||
    !Number.isSafeInteger(inventory[index].count) || inventory[index].count < 1
  ) {
    return { ok: false, reason: "no throwable item held" };
  }
  if ((world.throws?.length ?? 0) >= 1024) {
    return { ok: false, reason: "too many throws" };
  }
  const sequence = (sequences.get(world) ?? 0) + 1;
  const length = Math.hypot(dx, dy);
  const entry = {
    id: `throw-${sequence}`,
    owner: id,
    kind,
    x: player.x,
    y: player.y,
    z: PLAY_Z,
    dx: dx / length,
    dy: dy / length,
    remaining: THROW_RANGE,
  };
  if (inventory[index].count === 1) takeStack(inventory, index);
  else inventory[index].count--;
  sequences.set(world, sequence);
  (world.throws ??= []).push(entry);
  return { ok: true };
}

/** First entry into an axis-aligned entity hitbox, on the swept segment.
 * @param {ThrownItem} shot @param {number} distance @param {import('./world.js').Player} player
 */
function entityHit(shot, distance, player) {
  let near = 0, far = distance;
  for (
    const [position, direction, center] of [[shot.x, shot.dx, player.x], [
      shot.y,
      shot.dy,
      player.y,
    ]]
  ) {
    if (!direction) {
      if (Math.abs(position - center) > 0.25) return null;
    } else {
      const a = (center - 0.25 - position) / direction;
      const b = (center + 0.25 - position) / direction;
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
      if (near > far) return null;
    }
  }
  return near;
}

/** Grid traversal checks every crossed wall and both sides of an exact corner.
 * @param {World} world @param {ThrownItem} shot @param {number} distance
 */
function wallHit(world, shot, distance) {
  let x = centerTile(shot.x), y = centerTile(shot.y);
  const sx = Math.sign(shot.dx), sy = Math.sign(shot.dy);
  const open = (/** @type {number} */ tx, /** @type {number} */ ty) => {
    const b = world.limits;
    return !(b && !world.generateChunk &&
      (tx < b.minX || tx > b.maxX || ty < b.minY || ty > b.maxY)) &&
      readTile(world, tx, ty, shot.z) === OPEN;
  };
  let tx = sx ? (x + sx * 0.5 - shot.x) / shot.dx : Infinity;
  let ty = sy ? (y + sy * 0.5 - shot.y) / shot.dy : Infinity;
  while (Math.min(tx, ty) <= distance) {
    const at = Math.min(tx, ty);
    const corner = Math.abs(tx - ty) < 1e-9;
    const nx = x + (tx <= ty || corner ? sx : 0);
    const ny = y + (ty <= tx || corner ? sy : 0);
    if (!open(nx, ny) || (corner && !open(x + sx, y) && !open(x, y + sy))) {
      return { distance: at, x, y };
    }
    x = nx;
    y = ny;
    if (corner) {
      tx += Math.abs(1 / shot.dx);
      ty += Math.abs(1 / shot.dy);
    } else if (tx < ty) tx += Math.abs(1 / shot.dx);
    else ty += Math.abs(1 / shot.dy);
  }
  return null;
}

/** Advance flight and land as ordinary stacks. A full landing stack retains the item for retry.
 * @param {World} world
 */
export function stepThrows(world) {
  world.throws = (world.throws ?? []).filter((shot) => {
    if (shot.remaining === 0) return !dropItem(world, shot, shot.kind, 1);
    const distance = Math.min(shot.remaining, THROW_SPEED * TICK_MS / 1000);
    const wall = wallHit(world, shot, distance);
    let hitDistance = wall?.distance ?? Infinity;
    let landing = wall ? { x: wall.x, y: wall.y, z: shot.z } : null;
    for (const player of Object.values(world.players)) {
      if (player.id === shot.owner || player.z !== shot.z) continue;
      const hit = entityHit(shot, distance, player);
      if (hit !== null && hit < hitDistance) {
        hitDistance = hit;
        landing = {
          x: centerTile(player.x),
          y: centerTile(player.y),
          z: shot.z,
        };
      }
    }
    if (!landing) {
      shot.x += shot.dx * distance;
      shot.y += shot.dy * distance;
      shot.remaining = Math.max(0, shot.remaining - distance);
      if (shot.remaining > 1e-9) return true;
      landing = { x: centerTile(shot.x), y: centerTile(shot.y), z: shot.z };
    }
    if (dropItem(world, landing, shot.kind, 1)) return false;
    // Retain ownership of an overflow item until the ordinary stack has room.
    shot.x = landing.x;
    shot.y = landing.y;
    shot.remaining = 0;
    return true;
  });
}
