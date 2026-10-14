// @ts-check

import {
  chunkCoord,
  chunkIndex,
  chunkKey,
  createChunkData,
  getChunk,
  localCoord,
  UNKNOWN,
  WORLD_TOP,
} from "./terrain.js";
import { centerTile } from "./locomotion.js";
import {
  parseTileKey,
  recomputeVisibility,
  tileKey,
  tileSeen,
  visibilityPosition,
} from "./visibility.js";
import { packVisibility } from "./visibility-wire.js";
import { markPending } from "./reveal.js";

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./visibility.js').Visibility} Visibility */
/** Terrain a joining player has seen: chunk data with `UNKNOWN` for tiles never seen. */
/** @typedef {Map<string,import('./terrain.js').ChunkData>} RememberedTerrain */

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

/** @param {World} world @param {Visibility} sight @param {RememberedTerrain} rememberedTerrain @param {import('./reveal.js').PendingReveal} [pending] */
function rememberVisibleTiles(world, sight, rememberedTerrain, pending) {
  // Visible tiles arrive in runs inside one chunk, so remember the last pair.
  let lastCx = NaN;
  let lastCy = NaN;
  /** @type {import('./terrain.js').ChunkData|null} */
  let source = null;
  /** @type {import('./terrain.js').ChunkData|null} */
  let remembered = null;
  for (const key of sight.visible) {
    const [x, y, z] = parseTileKey(key);
    if (z < 0 || z > WORLD_TOP) continue;
    const cx = chunkCoord(x);
    const cy = chunkCoord(y);
    if (cx !== lastCx || cy !== lastCy) {
      lastCx = cx;
      lastCy = cy;
      source = getChunk(world, cx, cy);
      remembered = null;
      if (source) {
        const rememberedKey = chunkKey(cx, cy);
        remembered = rememberedTerrain.get(rememberedKey) ?? null;
        if (!remembered) {
          remembered = createChunkData(UNKNOWN);
          rememberedTerrain.set(rememberedKey, remembered);
        }
      }
    }
    if (!source || !remembered) continue;
    const index = chunkIndex(localCoord(x), localCoord(y), z);
    if (remembered[index] === source[index]) continue;
    remembered[index] = source[index];
    if (pending) markPending(pending, chunkKey(cx, cy), index);
  }
}

/** @param {import('./world.js').Move} move @param {boolean} originSeen @param {boolean} targetSeen @param {number} progress @returns {boolean|null} */
function boundaryDirection(move, originSeen, targetSeen, progress) {
  if (
    move.origin.z === move.target.z && originSeen && !targetSeen &&
    progress < 0.75
  ) {
    return false;
  } else if (
    move.origin.z === move.target.z && targetSeen && !originSeen &&
    progress >= 0.25
  ) {
    return true;
  }
  return null;
}

/** @param {import('./world.js').Player} player @param {import('./world.js').Move} move @param {Visibility} sight @param {number} tick */
function visibleMove(player, move, sight, tick) {
  const originSeen = tileSeen(sight.visible, move.origin);
  const targetSeen = tileSeen(sight.visible, move.target);
  const startSeen = tileSeen(sight.visible, move.startPosition);
  if (originSeen && targetSeen && startSeen) {
    return player;
  }
  const progress = (tick - move.startTick) / move.durationTicks;
  const entering = boundaryDirection(move, originSeen, targetSeen, progress);
  if (entering !== null) return boundaryPlayer(player, entering);
  if (originSeen && progress < 0.5) {
    return { ...player, ...move.origin, move: null };
  } else if (targetSeen && progress >= 0.5) {
    return { ...player, ...move.target, move: null };
  }
  return null;
}

/** @param {import('./world.js').Player} player @param {boolean} viewer @param {Visibility} sight @param {number} tick */
function visiblePlayer(player, viewer, sight, tick) {
  if (viewer) return player;
  if (player.free) {
    return sight.visible.has(
        tileKey(centerTile(player.x), centerTile(player.y), player.z),
      )
      ? player
      : null;
  }
  if (!player.move) return tileSeen(sight.visible, player) ? player : null;
  return visibleMove(player, player.move, sight, tick);
}

/** Sight copies each newly seen or changed tile into `rememberedTerrain` and marks it in `pending`. */
/** @param {World} world @param {string} viewerId @param {Visibility} sight @param {RememberedTerrain} rememberedTerrain @param {import('./reveal.js').PendingReveal} [pending] */
export function entityPlayers(
  world,
  viewerId,
  sight,
  rememberedTerrain,
  pending,
) {
  const viewer = world.players[viewerId];
  if (viewer) {
    recomputeVisibility(world, sight, visibilityPosition(viewer, world.tick));
  }
  rememberVisibleTiles(world, sight, rememberedTerrain, pending);
  /** @type {World['players']} */
  const players = {};
  for (const [id, player] of Object.entries(world.players)) {
    const seen = visiblePlayer(player, id === viewerId, sight, world.tick);
    if (seen) players[id] = seen;
  }
  return players;
}

/** @param {World} world @param {string} viewerId @param {Visibility} sight @param {RememberedTerrain} rememberedTerrain @param {import('./reveal.js').PendingReveal} [pending] */
export function entityView(
  world,
  viewerId,
  sight,
  rememberedTerrain,
  pending,
) {
  const players = entityPlayers(
    world,
    viewerId,
    sight,
    rememberedTerrain,
    pending,
  );
  return {
    world: {
      tick: world.tick,
      players,
    },
    visibility: packVisibility(sight),
  };
}
