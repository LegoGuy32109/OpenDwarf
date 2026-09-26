// @ts-check

import { isSolid, WORLD_EDGE, WORLD_TOP } from "./world.js";

export const FOV_RADIUS = 20;

/** @typedef {import('./world.js').Tile} Tile */
/** @typedef {import('./world.js').Player} Player */
/** @typedef {{visible:Set<string>,memory:Set<string>,sample:string}} Visibility */

/** @param {number} x @param {number} y @param {number} z */
export function tileKey(x, y, z) {
  return `${x},${y},${z}`;
}

/** @returns {Visibility} */
export function createVisibility() {
  return { visible: new Set(), memory: new Set(), sample: "" };
}

/** @param {Player} player @param {number} tick */
export function visibilityPosition(player, tick) {
  const move = player.move;
  if (move && (tick - move.startTick) / move.durationTicks >= 0.25) {
    return move.target;
  }
  return { x: player.x, y: player.y, z: player.z };
}

/** The old WebGL world's center-to-center, three-axis grid ray. */
/** @param {Tile} from @param {Tile} to */
export function hasLineOfSight(from, to) {
  if (from.x === to.x && from.y === to.y && from.z === to.z) return true;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const sx = dx >= 0 ? 1 : -1;
  const sy = dy >= 0 ? 1 : -1;
  const sz = dz >= 0 ? 1 : -1;
  const dtx = dx === 0 ? Infinity : Math.abs(1 / dx);
  const dty = dy === 0 ? Infinity : Math.abs(1 / dy);
  const dtz = dz === 0 ? Infinity : Math.abs(1 / dz);
  let tx = dx === 0 ? Infinity : 0.5 / Math.abs(dx);
  let ty = dy === 0 ? Infinity : 0.5 / Math.abs(dy);
  let tz = dz === 0 ? Infinity : 0.5 / Math.abs(dz);
  let x = from.x;
  let y = from.y;
  let z = from.z;
  const max = Math.abs(dx) + Math.abs(dy) + Math.abs(dz) + 1;
  for (let step = 0; step < max; step++) {
    if (tx <= ty && tx <= tz) {
      x += sx;
      tx += dtx;
    } else if (ty <= tz) {
      y += sy;
      ty += dty;
    } else {
      z += sz;
      tz += dtz;
    }
    if (x === to.x && y === to.y && z === to.z) return true;
    if (isSolid(x, y, z)) return false;
  }
  return true;
}

/** @param {Visibility} state @param {Tile} position */
export function recomputeVisibility(state, position) {
  const sample = tileKey(position.x, position.y, position.z);
  if (state.sample === sample) return false;
  const next = new Set();
  const radiusSquared = FOV_RADIUS * FOV_RADIUS;
  // One stone tile beyond XY bounds is the farthest exterior surface visible.
  for (let z = -1; z <= WORLD_TOP + 1; z++) {
    for (let y = -1; y <= WORLD_EDGE; y++) {
      for (let x = -1; x <= WORLD_EDGE; x++) {
        const dx = x - position.x;
        const dy = y - position.y;
        const dz = z - position.z;
        if (dx * dx + dy * dy + dz * dz > radiusSquared) continue;
        if (hasLineOfSight(position, { x, y, z })) next.add(tileKey(x, y, z));
      }
    }
  }
  // Reveal walls next to visible air, even when the wall center is behind a ray.
  for (const key of [...next]) {
    const [x, y, z] = key.split(",").map(Number);
    if (isSolid(x, y, z)) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (isSolid(x + dx, y + dy, z)) next.add(tileKey(x + dx, y + dy, z));
    }
    if (z <= position.z) next.add(tileKey(x, y, z - 1));
  }
  for (const key of state.visible) if (!next.has(key)) state.memory.add(key);
  for (const key of next) state.memory.delete(key);
  state.visible = next;
  state.sample = sample;
  return true;
}

/** @param {Visibility} state @param {number} x @param {number} y @param {number} z */
export function tileVisibility(state, x, y, z) {
  const key = tileKey(x, y, z);
  if (state.visible.has(key)) return "visible";
  if (state.memory.has(key)) return "remembered";
  return "unseen";
}

/** Fade other entities through the overlap interval of their occupied tiles. */
/** @param {Player} player @param {number} tick @param {(x:number,y:number,z:number)=>boolean} visible */
export function entityOpacity(player, tick, visible) {
  const move = player.move;
  if (!move) return visible(player.x, player.y, player.z) ? 1 : 0;
  const originSeen = visible(move.origin.x, move.origin.y, move.origin.z);
  const targetSeen = visible(move.target.x, move.target.y, move.target.z);
  if (originSeen === targetSeen) return originSeen ? 1 : 0;
  const progress = (tick - move.startTick) / move.durationTicks;
  const blend = Math.max(0, Math.min(1, (progress - 0.25) / 0.5));
  return originSeen ? 1 - blend : blend;
}
