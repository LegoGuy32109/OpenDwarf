// @ts-check

import { isSolid, WORLD_EDGE, Z_LEVELS_BELOW } from "./world.js";
import { tileVisibility } from "./visibility.js";
import { centerTile } from "./locomotion.js";
import { readTile } from "./terrain.js";

/** @typedef {import('./visibility.js').Visibility} Visibility */
/** @typedef {import('./world.js').Player} Player */
/** @typedef {import('./world.js').World} World */

export const DEPTH_TINTS = [
  [1, 1, 1],
  [0.75, 0.75, 0.75],
  [0.65, 0.65, 0.8],
  [0.43, 0.45, 0.61],
  [0.32, 0.34, 0.61],
  [0.2, 0.2, 0.4],
];

/** @param {number} mask */
export function shadowMaskToAtlasId(mask) {
  return ((mask & 1) << 2) | (mask & 2 ? 8 : 0) |
    ((mask & 4) >> 2) | (mask & 8 ? 2 : 0);
}

/** @typedef {{z:number,depth:number,seen:string,material:number}} Surface The top solid tile at a column: its level, its depth below `viewZ`, how it is seen, and its material. */
/** @typedef {(x:number,y:number)=>(Surface|null)} SurfaceLookup */

/** @param {World} world @param {number} x @param {number} y @param {number} viewZ @param {string} mode @param {Visibility} visibility @returns {Surface|null} */
export function surfaceAt(world, x, y, viewZ, mode, visibility) {
  for (let depth = 0; depth <= Z_LEVELS_BELOW; depth++) {
    const z = viewZ - depth;
    if (!isSolid(world, x, y, z)) continue;
    const seen = mode === "master"
      ? "visible"
      : tileVisibility(visibility, x, y, z, world);
    if (seen !== "unseen") {
      return { z, depth, seen, material: readTile(world, x, y, z) };
    }
  }
  return null;
}

/**
 * Compute `surfaceAt` once for every tile of a rectangle, into a flat array.
 * The returned lookup reads the grid inside the rectangle and falls back to
 * `surfaceAt` outside it.
 * @param {World} world @param {number} left @param {number} top @param {number} width @param {number} height @param {number} viewZ @param {string} mode @param {Visibility} visibility
 * @returns {SurfaceLookup}
 */
export function surfaceGrid(
  world,
  left,
  top,
  width,
  height,
  viewZ,
  mode,
  visibility,
) {
  /** @type {(Surface|null)[]} */
  const cells = new Array(width * height);
  for (let gy = 0, at = 0; gy < height; gy++) {
    for (let gx = 0; gx < width; gx++, at++) {
      cells[at] = surfaceAt(
        world,
        left + gx,
        top + gy,
        viewZ,
        mode,
        visibility,
      );
    }
  }
  return (x, y) => {
    const gx = x - left;
    const gy = y - top;
    if (gx < 0 || gy < 0 || gx >= width || gy >= height) {
      return surfaceAt(world, x, y, viewZ, mode, visibility);
    }
    return cells[gy * width + gx];
  };
}

/**
 * Which corners of the tile at (x, y) have a solid tile one level above their
 * surface. Pass `lookup` to read surfaces from a `surfaceGrid`.
 * @param {World} world @param {number} x @param {number} y @param {number} viewZ @param {string} mode @param {Visibility} visibility @param {SurfaceLookup} [lookup]
 */
export function ceilingMask(world, x, y, viewZ, mode, visibility, lookup) {
  let mask = 0;
  for (let corner = 0; corner < 4; corner++) {
    const tx = x + (corner & 1);
    const ty = y + (corner >> 1);
    const surface = lookup
      ? lookup(tx, ty)
      : surfaceAt(world, tx, ty, viewZ, mode, visibility);
    if (!surface || (mode === "entity" && surface.depth !== 0)) continue;
    const upper = mode === "master"
      ? "visible"
      : tileVisibility(visibility, tx, ty, viewZ + 1, world);
    if (upper !== "unseen" && isSolid(world, tx, ty, viewZ + 1)) {
      mask |= 1 << corner;
    }
  }
  return mask;
}

/**
 * Which corners of the tile at (x, y) sit at the highest surface of the four,
 * or 0 when all do. Pass `lookup` to read surfaces from a `surfaceGrid`.
 * @param {World} world @param {number} x @param {number} y @param {number} viewZ @param {string} mode @param {Visibility} visibility @param {SurfaceLookup} [lookup]
 */
export function elevationMask(world, x, y, viewZ, mode, visibility, lookup) {
  let highest = 127;
  let mask = 0;
  for (let corner = 0; corner < 4; corner++) {
    const tx = x + (corner & 1);
    const ty = y + (corner >> 1);
    const surface = lookup
      ? lookup(tx, ty)
      : surfaceAt(world, tx, ty, viewZ, mode, visibility);
    const depth = surface ? surface.depth : 127;
    if (depth < highest) {
      highest = depth;
      mask = 1 << corner;
    } else if (depth === highest) mask |= 1 << corner;
  }
  if (highest === 127) return 0;
  return mask === 15 ? 0 : mask;
}

/** @param {World} world @param {Player} player @param {number} viewZ */
export function playerOccluded(world, player, viewZ) {
  if (player.z === viewZ) return false;
  const low = player.z < viewZ ? player.z + 1 : viewZ + 1;
  const high = player.z < viewZ ? viewZ : player.z;
  for (let z = low; z <= high; z++) {
    if (isSolid(world, centerTile(player.x), centerTile(player.y), z)) {
      return true;
    }
  }
  return false;
}

/**
 * Keep one full column and row of the loaded chunks (tiles `min` up to `max`)
 * visible. The camera may pass the loaded extent by up to half a viewport, so a
 * view wider than the terrain still pans; unknown terrain draws as stone.
 */
/** @param {number} desired @param {number} viewportPx @param {number} zoom @param {number} [max] @param {number} [min] */
export function clampCameraAxis(
  desired,
  viewportPx,
  zoom,
  max = WORLD_EDGE,
  min = 0,
) {
  const half = viewportPx / zoom / 2;
  return Math.max(
    min * 64 + 64 - half,
    Math.min(max * 64 - 64 + half, desired),
  );
}

/** Master view pan speed in world pixels per millisecond at zoom 1. */
export const MASTER_PAN_SPEED = 0.48;

/**
 * How far the master camera moves in one frame, in world pixels. Dividing by
 * the zoom keeps the screen speed the same at every zoom.
 * @param {number} direction -1 to 1 @param {number} dtMs @param {number} zoom
 */
export function masterPanStep(direction, dtMs, zoom) {
  return direction * dtMs * MASTER_PAN_SPEED / zoom;
}

/**
 * The tiles the master camera looks at, as a rectangle (`max` values exclusive).
 * @param {{x:number,y:number}} camera world pixels @param {number} widthPx @param {number} heightPx @param {number} zoom
 */
export function masterViewTiles(camera, widthPx, heightPx, zoom) {
  const halfX = widthPx / zoom / 2 / 64;
  const halfY = heightPx / zoom / 2 / 64;
  const x = camera.x / 64;
  const y = camera.y / 64;
  return { minX: x - halfX, minY: y - halfY, maxX: x + halfX, maxY: y + halfY };
}
