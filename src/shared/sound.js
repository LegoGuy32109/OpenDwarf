// @ts-check
// Sound events: the world host records them and each listener hears the ones
// in range (ADR 0008). The contract commit records nothing; the sound events
// ticket fills it in.

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

/** Records an event for this tick. @param {World} _world @param {Omit<SoundEvent,"tick">} _event */
export function recordSound(_world, _event) {}

/** Takes and clears the events recorded since the last drain. @param {World} _world @returns {SoundEvent[]} */
export function drainSounds(_world) {
  return [];
}

/**
 * The events `listenerId` hears: in range, not its own.
 * @param {World} _world @param {SoundEvent[]} _events @param {string} _listenerId
 * @param {(event:SoundEvent) => boolean} _sees whether the listener sees the event's source or tile
 * @returns {HeardSound[]}
 */
export function soundsFor(_world, _events, _listenerId, _sees) {
  return [];
}
