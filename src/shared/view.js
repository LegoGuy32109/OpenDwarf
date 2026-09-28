// @ts-check

import { terrainIndex, WORLD_EDGE, WORLD_TOP } from "./world.js";
import {
  recomputeVisibility,
  tileKey,
  visibilityPosition,
} from "./visibility.js";

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./visibility.js').Visibility} Visibility */

/** Animate only the visible half of a move across a sight boundary. */
/** @param {import('./world.js').Player} player @param {boolean} entering */
function boundaryPlayer(player, entering) {
  const move = player.move;
  if (!move) return player;
  const anchor = entering ? move.target : move.origin;
  const other = entering ? move.origin : move.target;
  const edge = {
    x: anchor.x + Math.sign(other.x - anchor.x) * 0.49,
    y: anchor.y + Math.sign(other.y - anchor.y) * 0.49,
    z: anchor.z,
  };
  return {
    ...player,
    ...anchor,
    move: null,
    viewMotion: {
      from: entering ? edge : anchor,
      to: entering ? anchor : edge,
      startTick: move.startTick,
      durationTicks: move.durationTicks,
      sequence: move.sequence,
      entering,
    },
  };
}

/** @param {import('./world.js').ViewMotion} motion @param {number} tick */
export function viewMotionOpacity(motion, tick) {
  const progress = (tick - motion.startTick) / motion.durationTicks;
  const blend = Math.max(0, Math.min(1, (progress - 0.25) / 0.5));
  return motion.entering ? blend : 1 - blend;
}

/** @param {import('./world.js').ViewMotion} motion @param {number} tick */
export function viewMotionPosition(motion, tick) {
  const progress = (tick - motion.startTick) / motion.durationTicks;
  const blend = motion.entering
    ? Math.max(0, Math.min(1, (progress - 0.25) / 0.75))
    : Math.max(0, Math.min(1, progress / 0.75));
  return {
    x: motion.from.x + (motion.to.x - motion.from.x) * blend,
    y: motion.from.y + (motion.to.y - motion.from.y) * blend,
    z: motion.from.z + (motion.to.z - motion.from.z) * blend,
  };
}

/** @param {World} world @param {string} viewerId @param {Visibility} sight @param {number[]} rememberedTerrain */
export function entityView(world, viewerId, sight, rememberedTerrain) {
  const viewer = world.players[viewerId];
  if (viewer) {
    recomputeVisibility(world, sight, visibilityPosition(viewer, world.tick));
  }
  for (const key of sight.visible) {
    const [x, y, z] = key.split(",").map(Number);
    if (
      x >= 0 && x < WORLD_EDGE && y >= 0 && y < WORLD_EDGE &&
      z >= 0 && z <= WORLD_TOP
    ) {
      const index = terrainIndex(x, y, z);
      rememberedTerrain[index] = world.terrain[index];
    }
  }
  /** @type {World['players']} */
  const players = {};
  for (const [id, player] of Object.entries(world.players)) {
    if (id === viewerId) {
      players[id] = player;
      continue;
    }
    const move = player.move;
    if (!move) {
      if (sight.visible.has(tileKey(player.x, player.y, player.z))) {
        players[id] = player;
      }
      continue;
    }
    const originSeen = sight.visible.has(tileKey(
      move.origin.x,
      move.origin.y,
      move.origin.z,
    ));
    const targetSeen = sight.visible.has(tileKey(
      move.target.x,
      move.target.y,
      move.target.z,
    ));
    const startSeen = sight.visible.has(tileKey(
      move.startPosition.x,
      move.startPosition.y,
      move.startPosition.z,
    ));
    if (originSeen && targetSeen && startSeen) {
      players[id] = player;
      continue;
    }
    const progress = (world.tick - move.startTick) / move.durationTicks;
    if (
      move.origin.z === move.target.z && originSeen && !targetSeen &&
      progress < 0.75
    ) {
      players[id] = boundaryPlayer(player, false);
    } else if (
      move.origin.z === move.target.z && targetSeen && !originSeen &&
      progress >= 0.25
    ) {
      players[id] = boundaryPlayer(player, true);
    } else if (originSeen && progress < 0.5) {
      players[id] = { ...player, ...move.origin, move: null };
    } else if (targetSeen && progress >= 0.5) {
      players[id] = { ...player, ...move.target, move: null };
    }
  }
  return {
    world: {
      tick: world.tick,
      terrain: [...rememberedTerrain],
      players,
    },
    visibility: {
      visible: [...sight.visible],
      memory: [...sight.memory],
      sample: sight.sample,
    },
  };
}
