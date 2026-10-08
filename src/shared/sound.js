// @ts-check
// Sound events: the world host records them and each listener hears the ones
// in range (ADR 0008).

import { centerTile } from "./locomotion.js";
import { materialInfo } from "./materials.js";
import { readTile } from "./terrain.js";
import { renderPosition } from "./world.js";

/** @typedef {import('./world.js').World} World */
/**
 * One sound in the world. `source` is the entity that made it.
 * @typedef {{tags:string[],x:number,y:number,z:number,tick:number,source:string}} SoundEvent
 */
/**
 * A sound event as one listener receives it. `seen` says whether the listener
 * sees the source entity, or the tile for a break or a place.
 * @typedef {{tags:string[],x:number,y:number,z:number,tick:number,seen:boolean}} HeardSound
 */

/** A listener hears events within this many tiles horizontally... */
export const SOUND_RANGE = 12;
/** ...and this many levels. */
export const SOUND_Z_LIMIT = 4;
/** An entity makes a step every this many tiles traveled. */
export const STEP_DISTANCE = 0.5;
/** A mining action hits when it starts, then every this many ms. */
export const MINE_HIT_MS = 500;
/** Most events one `sounds` message carries. */
export const MAX_SOUND_ENTRIES = 64;
/** Most tags one event carries. */
export const MAX_SOUND_TAGS = 4;

/** Events kept while nobody drains them, such as a world without a host. */
const MAX_PENDING = 256;
/** A jump this far in one tick is a teleport or a respawn, not walking. */
const MAX_STEP_JUMP = 2;

/** @typedef {{x:number,y:number,distance:number}} StepTracker */
/** @type {WeakMap<World,{events:SoundEvent[],trackers:Map<string,StepTracker>}>} */
const stores = new WeakMap();

/** @param {World} world */
function storeOf(world) {
  let store = stores.get(world);
  if (!store) {
    store = { events: [], trackers: new Map() };
    stores.set(world, store);
  }
  return store;
}

/** Records an event for this tick. @param {World} world @param {Omit<SoundEvent,"tick">} event */
export function recordSound(world, event) {
  const { events } = storeOf(world);
  events.push({ ...event, tags: [...event.tags], tick: world.tick });
  if (events.length > MAX_PENDING) {
    events.splice(0, events.length - MAX_PENDING);
  }
}

/** Takes and clears the events recorded since the last drain. @param {World} world @returns {SoundEvent[]} */
export function drainSounds(world) {
  const store = storeOf(world);
  const events = store.events;
  store.events = [];
  return events;
}

/** A new step tracker. Every client and the host count steps with the same one. @returns {StepTracker} */
export function createStepTracker() {
  return { x: NaN, y: NaN, distance: 0 };
}

/**
 * The step accumulator rule: each call adds the horizontal distance since the
 * last call and returns how many whole `STEP_DISTANCE` steps that completes.
 * The first call, and a jump over `MAX_STEP_JUMP` tiles, only set the start.
 * @param {StepTracker} tracker @param {number} x @param {number} y
 */
export function stepsTaken(tracker, x, y) {
  const jump = Math.hypot(x - tracker.x, y - tracker.y);
  const first = Number.isNaN(jump);
  tracker.x = x;
  tracker.y = y;
  if (first || jump > MAX_STEP_JUMP) {
    tracker.distance = 0;
    return 0;
  }
  tracker.distance += jump;
  const count = Math.floor(tracker.distance / STEP_DISTANCE);
  tracker.distance -= count * STEP_DISTANCE;
  return count;
}

/**
 * Whether an entity is walking: on a tile move, or with speed. A correction
 * that snaps a standing entity to another tile is not a step.
 * @param {import('./world.js').Player} player
 */
export function isWalking(player) {
  return Boolean(player.move) ||
    Math.hypot(player.vx ?? 0, player.vy ?? 0) > 0.05;
}

/**
 * The tags of a step: `step`, the gait, and the material of the floor tile
 * under the entity when it is a named solid material.
 * @param {World} world @param {number} x @param {number} y @param {number} z @param {boolean} running
 */
export function stepTags(world, x, y, z, running) {
  const tags = ["step", running ? "run" : "walk"];
  const name = materialInfo(
    readTile(world, centerTile(x), centerTile(y), z - 1),
  )
    ?.name;
  if (name && name !== "air" && name !== "unknown") tags.push(name);
  return tags;
}

/**
 * Records the steps every entity took this tick. Call once per host tick.
 * @param {World} world @param {(id:string) => boolean} isRunning whether an entity is sprinting
 */
export function recordSteps(world, isRunning) {
  const { trackers } = storeOf(world);
  for (const id of trackers.keys()) {
    if (!world.players[id]) trackers.delete(id);
  }
  for (const player of Object.values(world.players)) {
    let tracker = trackers.get(player.id);
    if (!tracker) {
      tracker = createStepTracker();
      trackers.set(player.id, tracker);
    }
    const at = player.move ? renderPosition(player, world.tick) : player;
    const count = stepsTaken(tracker, at.x, at.y);
    if (!count || !isWalking(player)) continue;
    const tags = stepTags(world, at.x, at.y, player.z, isRunning(player.id));
    for (let i = 0; i < count; i++) {
      recordSound(world, {
        tags,
        x: Math.round(at.x * 100) / 100,
        y: Math.round(at.y * 100) / 100,
        z: player.z,
        source: player.id,
      });
    }
  }
}

/** Whether an event comes from a tile, a break or a place, rather than from an entity. @param {{tags:string[]}} event */
export function isTileSound(event) {
  return event.tags[0] === "place" ||
    (event.tags[0] === "mine" && event.tags[1] === "break");
}

/**
 * The tile whose sight decides `seen`: the tile of a break or a place, else the
 * tile the source entity stands on.
 * @param {World} world @param {SoundEvent} event
 */
export function sourceTile(world, event) {
  const source = isTileSound(event) ? undefined : world.players[event.source];
  const at = source ?? event;
  return {
    x: centerTile(at.x),
    y: centerTile(at.y),
    z: source ? source.z : event.z,
  };
}

/**
 * The events `listenerId` hears: in range, not its own.
 * @param {World} world @param {SoundEvent[]} events @param {string} listenerId
 * @param {(event:SoundEvent) => boolean} sees whether the listener sees the event's source or tile
 * @returns {HeardSound[]}
 */
export function soundsFor(world, events, listenerId, sees) {
  const listener = world.players[listenerId];
  if (!listener) return [];
  /** @type {HeardSound[]} */
  const heard = [];
  for (const event of events) {
    if (
      event.source === listenerId ||
      Math.abs(event.z - listener.z) > SOUND_Z_LIMIT ||
      Math.hypot(event.x - listener.x, event.y - listener.y) > SOUND_RANGE
    ) continue;
    heard.push({
      tags: event.tags,
      x: event.x,
      y: event.y,
      z: event.z,
      tick: event.tick,
      seen: sees(event),
    });
  }
  return heard.length > MAX_SOUND_ENTRIES
    ? heard.slice(-MAX_SOUND_ENTRIES)
    : heard;
}
