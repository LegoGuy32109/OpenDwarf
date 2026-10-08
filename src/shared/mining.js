// @ts-check

import { dropItem, inventoryOf, PICKAXE } from "./items.js";
import { centerTile } from "./locomotion.js";
import { materialInfo } from "./materials.js";
import { inReach } from "./reach.js";
import { MINE_HIT_MS, recordSound } from "./sound.js";
import { OPEN, readTile, WORLD_TOP, writeTile } from "./terrain.js";
import { TICK_MS } from "./world.js";

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world.js').Player} Player */
/** @typedef {{x:number,y:number,z:number}} Tile */
/** @typedef {Player & {held?:string}} Holder */
/**
 * One mining action. It keeps its target until the target leaves reach.
 * @typedef {object} MiningAction
 * @property {string} playerId
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} material what the tile held when mining started
 * @property {string} held the item in hand when mining started
 * @property {number} startTick
 * @property {number} durationTicks
 * @property {number} [hits] mining hit sounds recorded so far
 */
/** @typedef {{ok:true,action:MiningAction}|{ok:false,reason:string}} StartResult */

export { PICKAXE };

/**
 * The item kind an entity holds. A new entity holds its pickaxe, and `setHeldItem`
 * changes it. An item that left the inventory is no longer held.
 * @param {Player} player
 */
export function heldItem(player) {
  const kind = /** @type {Holder} */ (player).held;
  return kind && inventoryOf(player).some((stack) => stack.kind === kind)
    ? kind
    : PICKAXE;
}

/** Mining time in simulation ticks, or null when the material cannot be mined. @param {number} material */
export function miningTicks(material) {
  const seconds = materialInfo(material)?.miningSeconds;
  return typeof seconds === "number"
    ? Math.max(1, Math.round(seconds * 1000 / TICK_MS))
    : null;
}

/** @type {WeakMap<World,Map<string,MiningAction>>} */
const stores = new WeakMap();

/** The host's active mining actions, one per entity. @param {World} world */
export function miningActions(world) {
  let store = stores.get(world);
  if (!store) {
    store = new Map();
    stores.set(world, store);
  }
  return store;
}

/** @typedef {(tile:Tile) => boolean} Sees */

/** Sees every tile: for callers that have no sight set, such as unit tests. @type {Sees} */
const SEES_ALL = () => true;

/**
 * Why `player` may not mine `tile` now, or null when the host would start it:
 * the tile is real, a pickaxe is held, the tile is in reach (path and sight,
 * ADR 0009), and the material can be mined.
 * @param {World} world @param {Player} player @param {Tile} tile @param {Sees} [sees]
 * @returns {string|null}
 */
export function miningRefusal(world, player, tile, sees = SEES_ALL) {
  if (
    !Number.isInteger(tile.x) || !Number.isInteger(tile.y) ||
    !Number.isInteger(tile.z) || tile.z < 0 || tile.z > WORLD_TOP
  ) return "invalid tile";
  if (heldItem(player) !== PICKAXE) return "no pickaxe";
  if (
    tile.z === player.z && tile.x === centerTile(player.x) &&
    tile.y === centerTile(player.y)
  ) return "aim at a neighboring tile";
  if (!inReach(world, player, tile, sees)) return "out of reach";
  if (miningTicks(readTile(world, tile.x, tile.y, tile.z)) === null) {
    return "nothing to mine";
  }
  return null;
}

/**
 * Start mining on the host. The host checks the target, reach, material, and
 * held pickaxe; a guest only names the tile it aimed at. `sees` is the acting
 * entity's current sight. A new target replaces an earlier one. Starting on the
 * tile already being mined changes nothing.
 * @param {World} world @param {string} playerId @param {Tile} tile @param {Sees} [sees] @returns {StartResult}
 */
export function startMining(world, playerId, tile, sees = SEES_ALL) {
  const player = world.players[playerId];
  if (!player) return { ok: false, reason: "unknown player" };
  const reason = miningRefusal(world, player, tile, sees);
  if (reason) return { ok: false, reason };
  const material = readTile(world, tile.x, tile.y, tile.z);
  const durationTicks = miningTicks(material);
  if (durationTicks === null) return { ok: false, reason: "nothing to mine" };
  const store = miningActions(world);
  const current = store.get(playerId);
  if (
    current && current.x === tile.x && current.y === tile.y &&
    current.z === tile.z
  ) return { ok: true, action: current };
  /** @type {MiningAction} */
  const action = {
    playerId,
    x: tile.x,
    y: tile.y,
    z: tile.z,
    material,
    held: heldItem(player),
    startTick: world.tick,
    durationTicks,
  };
  store.set(playerId, action);
  return { ok: true, action };
}

/** Cancel an entity's mining. Returns whether there was an action. @param {World} world @param {string} playerId */
export function cancelMining(world, playerId) {
  return miningActions(world).delete(playerId);
}

/**
 * Why an action must stop, or null to keep going. Moving does not cancel while
 * the target stays in reach. Leaving reach (path or sight), a changed held
 * item, a missing entity, or a tile that no longer holds the same material
 * does.
 * @param {World} world @param {MiningAction} action @param {Sees} [sees]
 */
export function miningCancelReason(world, action, sees = SEES_ALL) {
  const player = world.players[action.playerId];
  if (!player) return "gone";
  if (!inReach(world, player, action, sees)) return "out of reach";
  if (heldItem(player) !== action.held) return "held item changed";
  if (readTile(world, action.x, action.y, action.z) !== action.material) {
    return "tile changed";
  }
  return null;
}

/**
 * The one place the host handles a finished mining action. The tile becomes
 * air, `writeTile` queues the change for `drainTileChanges`, and one item of
 * the material's item kind drops on the tile, merging with a stack of that
 * kind already there.
 * @param {World} world @param {MiningAction} action
 */
export function completeMining(world, action) {
  writeTile(world, action.x, action.y, action.z, OPEN);
  const tile = { x: action.x, y: action.y, z: action.z };
  const info = materialInfo(action.material);
  recordSound(world, {
    tags: ["mine", "break", info?.name ?? "stone"],
    ...tile,
    source: action.playerId,
  });
  const kind = info?.itemKind ?? null;
  if (kind) dropItem(world, tile, kind, 1);
  return { playerId: action.playerId, tile, material: action.material, kind };
}

/**
 * Advance every action by one simulation tick on the host: cancel the ones
 * that lost their target and finish the ones that are done. Returns the
 * finished actions' results. `sightOf` names an entity's current sight, as the
 * host knows it; an entity it names no sight for keeps the path rule alone.
 * @param {World} world @param {(playerId:string) => Sees|undefined} [sightOf]
 */
export function stepMining(world, sightOf) {
  const store = miningActions(world);
  /** @type {ReturnType<typeof completeMining>[]} */
  const finished = [];
  for (const [id, action] of [...store]) {
    if (miningCancelReason(world, action, sightOf?.(id))) {
      store.delete(id);
    } else if (world.tick - action.startTick >= action.durationTicks) {
      store.delete(id);
      finished.push(completeMining(world, action));
    } else {
      const due = Math.floor(
        (world.tick - action.startTick) * TICK_MS /
          MINE_HIT_MS,
      ) + 1;
      for (; (action.hits ?? 0) < due; action.hits = (action.hits ?? 0) + 1) {
        recordSound(world, {
          tags: ["mine", "hit", materialInfo(action.material)?.name ?? "stone"],
          x: action.x,
          y: action.y,
          z: action.z,
          source: action.playerId,
        });
      }
    }
  }
  return finished;
}

/** @typedef {{id:string,x:number,y:number,z:number,elapsedMs:number,totalMs:number}} MiningEntry */

/** Active actions as wire entries: how long each has run and how long it takes. @param {World} world @returns {MiningEntry[]} */
export function miningEntries(world) {
  return [...miningActions(world).values()].map((action) => ({
    id: action.playerId,
    x: action.x,
    y: action.y,
    z: action.z,
    elapsedMs: Math.max(0, world.tick - action.startTick) * TICK_MS,
    totalMs: action.durationTicks * TICK_MS,
  }));
}

/** Number of breaking decal frames. */
export const DECAL_FRAMES = 5;

/** Decal frame, 0 through 4, for mining progress from 0 to 1. @param {number} progress */
export function decalFrame(progress) {
  return Math.max(
    0,
    Math.min(DECAL_FRAMES - 1, Math.floor(progress * DECAL_FRAMES)),
  );
}
