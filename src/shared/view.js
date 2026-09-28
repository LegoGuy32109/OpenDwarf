// @ts-check

import { terrainIndex, WORLD_EDGE, WORLD_TOP } from "./world.js";
import {
  recomputeVisibility,
  tileKey,
  visibilityPosition,
} from "./visibility.js";

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./visibility.js').Visibility} Visibility */

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
    if (originSeen && progress < 0.5) {
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
