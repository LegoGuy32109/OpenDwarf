// @ts-check

import { isSolid, WORLD_EDGE, Z_LEVELS_BELOW } from "./world.js";
import { tileVisibility } from "./visibility.js";

/** @typedef {import('./visibility.js').Visibility} Visibility */
/** @typedef {import('./world.js').Player} Player */

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

/** @param {number} x @param {number} y @param {number} viewZ @param {string} mode @param {Visibility} visibility */
export function surfaceAt(x, y, viewZ, mode, visibility) {
  for (let depth = 0; depth <= Z_LEVELS_BELOW; depth++) {
    const z = viewZ - depth;
    if (!isSolid(x, y, z)) continue;
    const seen = mode === "master"
      ? "visible"
      : tileVisibility(visibility, x, y, z);
    if (seen !== "unseen") return { z, depth, seen };
  }
  return null;
}

/** @param {number} x @param {number} y @param {number} viewZ @param {string} mode @param {Visibility} visibility */
export function ceilingMask(x, y, viewZ, mode, visibility) {
  let mask = 0;
  for (const [dx, dy, bit] of [[0, 0, 1], [1, 0, 2], [0, 1, 4], [1, 1, 8]]) {
    const tx = x + dx;
    const ty = y + dy;
    const surface = surfaceAt(tx, ty, viewZ, mode, visibility);
    if (!surface || (mode === "entity" && surface.depth !== 0)) continue;
    const upper = mode === "master"
      ? "visible"
      : tileVisibility(visibility, tx, ty, viewZ + 1);
    if (upper !== "unseen" && isSolid(tx, ty, viewZ + 1)) mask |= bit;
  }
  return mask;
}

/** @param {number} x @param {number} y @param {number} viewZ @param {string} mode @param {Visibility} visibility */
export function elevationMask(x, y, viewZ, mode, visibility) {
  const depths = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) =>
    surfaceAt(x + dx, y + dy, viewZ, mode, visibility)?.depth ?? 127
  );
  const highest = Math.min(...depths);
  if (highest === 127) return 0;
  let mask = 0;
  for (let i = 0; i < 4; i++) if (depths[i] === highest) mask |= 1 << i;
  return mask === 15 ? 0 : mask;
}

/** @param {Player} player @param {number} viewZ */
export function playerOccluded(player, viewZ) {
  if (player.z === viewZ) return false;
  const low = player.z < viewZ ? player.z + 1 : viewZ + 1;
  const high = player.z < viewZ ? viewZ : player.z;
  for (let z = low; z <= high; z++) {
    if (isSolid(player.x, player.y, z)) return true;
  }
  return false;
}

/** Keep one full column and row visible, or center when the chunk fits. */
/** @param {number} desired @param {number} viewportPx @param {number} zoom */
export function clampCameraAxis(desired, viewportPx, zoom) {
  const chunkPx = WORLD_EDGE * 64;
  const visiblePx = viewportPx / zoom;
  if (visiblePx >= chunkPx) return chunkPx / 2;
  const half = visiblePx / 2;
  return Math.max(64 - half, Math.min(chunkPx - 64 + half, desired));
}
