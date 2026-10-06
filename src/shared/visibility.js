// @ts-check

import { isSolid } from "./world.js";
import {
  chunkCoord,
  chunkIndex,
  getChunk,
  localCoord,
  nearLoadedTerrain,
  UNKNOWN,
  WORLD_TOP,
} from "./terrain.js";
import { centerTile } from "./locomotion.js";

export const FOV_RADIUS = 20;

/** @typedef {import('./world.js').Tile} Tile */
/** @typedef {import('./world.js').Player} Player */
/** @typedef {import('./world.js').World} World */
/**
 * `memory` holds tiles that left sight on the world host. A guest does not
 * receive it (ADR 0005); its `fromTerrain` is set, and a tile it remembers is
 * one its own copy of the terrain knows and sight does not hold.
 * @typedef {{visible:Set<string>,memory:Set<string>,sample:string,fromTerrain?:boolean}} Visibility
 */

/** @param {number} x @param {number} y @param {number} z */
export function tileKey(x, y, z) {
  return `${x},${y},${z}`;
}

/** Parse a `tileKey` back to `[x, y, z]`. Faster than `split`, which sight loops call thousands of times. */
/** @param {string} key @returns {[number,number,number]} */
export function parseTileKey(key) {
  const first = key.indexOf(",");
  const second = key.indexOf(",", first + 1);
  return [
    Number(key.slice(0, first)),
    Number(key.slice(first + 1, second)),
    Number(key.slice(second + 1)),
  ];
}

/** @returns {Visibility} */
export function createVisibility() {
  return { visible: new Set(), memory: new Set(), sample: "" };
}

/** @param {Player} player @param {number} tick */
export function visibilityPosition(player, tick) {
  if (player.free) {
    return {
      x: centerTile(player.x),
      y: centerTile(player.y),
      z: player.z,
    };
  }
  const move = player.move;
  if (move && (tick - move.startTick) / move.durationTicks >= 0.25) {
    return move.target;
  }
  return { x: player.x, y: player.y, z: player.z };
}

/** A center-to-center grid ray that checks both cells touched at a corner. */
/** @param {World} world @param {Tile} from @param {Tile} to */
export function hasLineOfSight(world, from, to) {
  if (from.x === to.x && from.y === to.y && from.z === to.z) return true;
  if (from.z === to.z) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    let x = from.x;
    let y = from.y;
    let crossedX = 0;
    let crossedY = 0;
    while (x !== to.x || y !== to.y) {
      const nextX = crossedX < ax ? (2 * crossedX + 1) * ay : Infinity;
      const nextY = crossedY < ay ? (2 * crossedY + 1) * ax : Infinity;
      if (nextX === nextY) {
        if (
          isSolid(world, x + sx, y, from.z) ||
          isSolid(world, x, y + sy, from.z)
        ) return false;
        x += sx;
        y += sy;
        crossedX++;
        crossedY++;
      } else if (nextX < nextY) {
        x += sx;
        crossedX++;
      } else {
        y += sy;
        crossedY++;
      }
      if (x === to.x && y === to.y) return true;
      if (isSolid(world, x, y, from.z)) return false;
    }
    return true;
  }
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
    if (isSolid(world, x, y, z)) return false;
  }
  return true;
}

/** @param {World} world @param {Visibility} state @param {Tile} position */
export function recomputeVisibility(world, state, position) {
  const sample = tileKey(position.x, position.y, position.z);
  if (state.sample === sample) return false;
  const next = new Set();
  const radiusSquared = FOV_RADIUS * FOV_RADIUS;
  // One stone tile beyond loaded chunks is the farthest exterior surface visible.
  const minX = Math.floor(position.x) - FOV_RADIUS;
  const minY = Math.floor(position.y) - FOV_RADIUS;
  for (let z = -1; z <= WORLD_TOP + 1; z++) {
    for (let y = minY; y <= minY + 2 * FOV_RADIUS + 1; y++) {
      for (let x = minX; x <= minX + 2 * FOV_RADIUS + 1; x++) {
        const dx = x - position.x;
        const dy = y - position.y;
        const dz = z - position.z;
        if (dx * dx + dy * dy + dz * dz > radiusSquared) continue;
        if (!nearLoadedTerrain(world, x, y)) continue;
        if (hasLineOfSight(world, position, { x, y, z })) {
          next.add(tileKey(x, y, z));
        }
      }
    }
  }
  // Reveal walls next to visible air, even when the wall center is behind a ray.
  for (const key of [...next]) {
    const [x, y, z] = parseTileKey(key);
    if (isSolid(world, x, y, z)) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (isSolid(world, x + dx, y + dy, z)) {
        next.add(tileKey(x + dx, y + dy, z));
      }
    }
    if (z <= position.z) next.add(tileKey(x, y, z - 1));
  }
  for (const key of state.visible) if (!next.has(key)) state.memory.add(key);
  for (const key of next) state.memory.delete(key);
  state.visible = next;
  state.sample = sample;
  return true;
}

/** Floor and ceiling shells (z -1 and above the top) are not stored; the level beside them stands for them. */
/** @param {World} world @param {number} x @param {number} y @param {number} z */
function terrainKnows(world, x, y, z) {
  const chunk = getChunk(world, chunkCoord(x), chunkCoord(y));
  if (!chunk) return false;
  const level = Math.min(Math.max(z, 0), WORLD_TOP);
  return chunk[chunkIndex(localCoord(x), localCoord(y), level)] !== UNKNOWN;
}

/** @param {Visibility} state @param {number} x @param {number} y @param {number} z @param {World} [world] needed when `state.fromTerrain` is set */
export function tileVisibility(state, x, y, z, world) {
  const key = tileKey(x, y, z);
  if (state.visible.has(key)) return "visible";
  if (state.memory.has(key)) return "remembered";
  if (state.fromTerrain && world && terrainKnows(world, x, y, z)) {
    return "remembered";
  }
  return "unseen";
}

/** Fade other entities through the overlap interval of their occupied tiles. */
/** @param {Player} player @param {number} tick @param {(x:number,y:number,z:number)=>boolean} visible @param {{x:number,y:number,z:number}} [position] */
export function entityOpacity(player, tick, visible, position = player) {
  if (player.free) {
    return boundaryOpacity({ ...position, z: player.z }, visible);
  }
  const move = player.move;
  if (!move) return visible(player.x, player.y, player.z) ? 1 : 0;
  const originSeen = visible(move.origin.x, move.origin.y, move.origin.z);
  const targetSeen = visible(move.target.x, move.target.y, move.target.z);
  if (originSeen === targetSeen) return originSeen ? 1 : 0;
  const progress = (tick - move.startTick) / move.durationTicks;
  const blend = Math.max(0, Math.min(1, (progress - 0.25) / 0.5));
  return originSeen ? 1 - blend : blend;
}

/** @param {{x:number,y:number,z:number}} position @param {(x:number,y:number,z:number)=>boolean} visible */
export function boundaryOpacity(position, visible) {
  const cx = centerTile(position.x);
  const cy = centerTile(position.y);
  const z = Math.round(position.z);
  if (!visible(cx, cy, z)) return 0;
  let closest = Infinity;
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 1; x <= cx + 1; x++) {
      if (!visible(x, y, z)) continue;
      const left = x - 0.5;
      const right = x + 0.5;
      const top = y - 0.5;
      const bottom = y + 0.5;
      if (!visible(x - 1, y, z)) {
        closest = Math.min(
          closest,
          Math.hypot(
            position.x - left,
            position.y - Math.max(top, Math.min(bottom, position.y)),
          ),
        );
      }
      if (!visible(x + 1, y, z)) {
        closest = Math.min(
          closest,
          Math.hypot(
            position.x - right,
            position.y - Math.max(top, Math.min(bottom, position.y)),
          ),
        );
      }
      if (!visible(x, y - 1, z)) {
        closest = Math.min(
          closest,
          Math.hypot(
            position.x - Math.max(left, Math.min(right, position.x)),
            position.y - top,
          ),
        );
      }
      if (!visible(x, y + 1, z)) {
        closest = Math.min(
          closest,
          Math.hypot(
            position.x - Math.max(left, Math.min(right, position.x)),
            position.y - bottom,
          ),
        );
      }
    }
  }
  return Math.max(0, Math.min(1, closest * 2));
}
