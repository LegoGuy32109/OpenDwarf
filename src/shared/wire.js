// @ts-check

import {
  counter,
  fields,
  finite,
  identifier,
  record,
  tile,
} from "./wire-parse.js";
import { WORLD_TOP } from "./terrain.js";
import { ROLES } from "./world.js";
import { decodeChunks, MAX_REVEAL_CHUNKS } from "./chunk-wire.js";
import { unpackVisibility } from "./visibility-wire.js";

/** @typedef {import('./world.js').Player} Player */
/** @typedef {import('./world.js').World} World */
/** @typedef {Omit<Player,'typing'|'message'|'messageUntil'>} MotionPlayer */
/** @typedef {import('./chat.js').ChatRecord} ChatRecord */
/** @typedef {{attempt:string,viewRevision:number,sightRevision:number}} Envelope */
/** @typedef {Envelope & {type:"state",world:Pick<World,'tick'|'players'|'limits'>,reveal:Map<string,import('./terrain.js').ChunkData>,visibility:import('./visibility-wire.js').WireVisibility|null,mode:"entity"|"master",playerId:string,chat:ChatRecord[],acknowledgedSequence:number}} StatePacket */
/** @typedef {Envelope & {type:"motion",tick:number,players:World['players'],acknowledgedSequence:number}} MotionPacket */
/** @typedef {Envelope & {type:"chat",tick:number,chat:ChatRecord[]}} ChatPacket */

export const PROTOCOL_VERSION = 7;
export const MAX_PACKET_BYTES = 256 * 1024;
const MAX_ENTITIES = 1024;

/** Reject oversized transport payloads before JSON parsing or scene decoding. */
/** @param {unknown} raw @returns {Record<string,unknown>|null} */
export function parsePacket(raw) {
  if (typeof raw !== "string" || raw.length > MAX_PACKET_BYTES) return null;
  if (new TextEncoder().encode(raw).byteLength > MAX_PACKET_BYTES) return null;
  try {
    const value = JSON.parse(raw);
    return record(value) ? value : null;
  } catch {
    return null;
  }
}

/** @param {Record<string,unknown>} value */
function envelope(value) {
  return identifier(value.attempt) && counter(value.viewRevision) &&
    counter(value.sightRevision);
}

/** @param {unknown} value @param {boolean} [boundary] */
function movement(value, boundary = false) {
  if (!record(value)) return false;
  return counter(value.startTick) && counter(value.durationTicks, 1000) &&
    value.durationTicks > 0 && counter(value.sequence) &&
    (boundary
      ? tile(value.from) && tile(value.to) &&
        typeof value.entering === "boolean"
      : tile(value.origin) && tile(value.target) &&
        tile(value.startPosition));
}

/** @param {unknown} value */
const boolean = (value) => typeof value === "boolean";
/** @param {unknown} value @param {number} limit @param {boolean} [nonempty] */
const shortText = (value, limit, nonempty = false) =>
  typeof value === "string" && value.length <= limit &&
  (!nonempty || value.length > 0);
/** @type {import('./wire-parse.js').FieldRules} */
const PLAYER_REQUIRED = {
  id: identifier,
  name: (value) => shortText(value, 24),
  facingLeft: boolean,
  move: (value) => value === null || movement(value),
};
/** @type {import('./wire-parse.js').FieldRules} */
const PLAYER_OPTIONAL = {
  viewMotion: (value) => movement(value, true),
  npc: boolean,
  role: (value) => ROLES.includes(/** @type {string} */ (value)),
  free: boolean,
  size: (value) => finite(value, 0.01, 4),
  vx: (value) => finite(value, -10, 10),
  vy: (value) => finite(value, -10, 10),
};
/** @param {unknown} value @returns {value is Player} */
function player(value) {
  return record(value) && tile(value) && Number.isInteger(value.z) &&
    fields(value, PLAYER_REQUIRED, PLAYER_OPTIONAL);
}

/** Explicit wire fields prevent simulation and chat state escaping on motion. */
/** @param {World['players']} players @returns {Record<string,MotionPlayer>} */
export function encodeMotionPlayers(players) {
  return Object.fromEntries(
    Object.entries(players).map(([id, value]) => [id, {
      id: value.id,
      name: value.name,
      x: value.x,
      y: value.y,
      z: value.z,
      facingLeft: value.facingLeft,
      move: value.move,
      ...(value.viewMotion ? { viewMotion: value.viewMotion } : {}),
      ...(value.npc !== undefined ? { npc: value.npc } : {}),
      ...(value.role !== undefined ? { role: value.role } : {}),
      ...(value.free !== undefined ? { free: value.free } : {}),
      ...(value.size !== undefined ? { size: value.size } : {}),
      ...(value.vx !== undefined ? { vx: value.vx } : {}),
      ...(value.vy !== undefined ? { vy: value.vy } : {}),
    }]),
  );
}

/** @param {unknown} value @returns {World['players']|null} */
function players(value) {
  if (!record(value) || Object.keys(value).length > MAX_ENTITIES) return null;
  for (const [id, entity] of Object.entries(value)) {
    if (!identifier(id) || !player(entity) || entity.id !== id) {
      return null;
    }
  }
  return Object.fromEntries(
    Object.entries(encodeMotionPlayers(
      /** @type {World['players']} */ (value),
    )).map(([id, entity]) => [id, {
      ...entity,
      typing: false,
      message: "",
      messageUntil: 0,
    }]),
  );
}

/** Each speech piece holds at most 40 characters. */
const MAX_SYLLABLES = 40;

/** @type {import('./wire-parse.js').FieldRules} */
const CHAT_OPTIONAL = {
  text: (value) => shortText(value, 240, true),
  talking: boolean,
  typing: boolean,
  queued: boolean,
  syllables: (value) => counter(value, MAX_SYLLABLES),
  startTick: counter,
  expiresTick: counter,
};
/** @param {Record<string,unknown>} item */
function bubbles(item) {
  if (
    item.text === undefined || !Array.isArray(item.bubbles) ||
    item.bubbles.length > 3
  ) return false;
  return item.bubbles.every((bubble) => {
    if (
      !record(bubble) || !fields(bubble, {
        text: (value) => shortText(value, 40, true),
        expiresTick: counter,
      }, { startTick: counter, group: counter, part: counter, parts: counter })
    ) {
      return false;
    }
    const grouped = bubble.group !== undefined || bubble.part !== undefined ||
      bubble.parts !== undefined;
    return !grouped || (
      counter(bubble.group) && counter(bubble.part) &&
      counter(bubble.parts) && bubble.parts > 0 && bubble.part < bubble.parts
    );
  });
}

/** @param {Record<string,unknown>} item */
function validChatContent(item) {
  if (!fields(item, {}, CHAT_OPTIONAL)) return false;
  if (item.bubbles !== undefined && !bubbles(item)) return false;
  if (
    item.text === undefined && item.talking !== true &&
    item.typing !== true && item.queued !== true
  ) {
    return false;
  }
  if (
    (item.text !== undefined || item.talking === true) &&
    item.expiresTick === undefined
  ) {
    return false;
  }
  return true;
}

/** @param {unknown} value @returns {ChatRecord[]|null} */
function chatRecords(value) {
  if (!Array.isArray(value) || value.length > MAX_ENTITIES) return null;
  const ids = new Set();
  for (const item of value) {
    if (!record(item) || !identifier(item.id) || !tile(item)) return null;
    if (ids.has(item.id)) return null;
    ids.add(item.id);
    if (!validChatContent(item)) return null;
  }
  return (/** @type {ChatRecord[]} */ (value)).map((item) => ({
    id: item.id,
    x: item.x,
    y: item.y,
    z: item.z,
    ...(item.text !== undefined ? { text: item.text } : {}),
    ...(item.bubbles !== undefined
      ? {
        bubbles: item.bubbles.map((bubble) => ({
          text: bubble.text,
          expiresTick: bubble.expiresTick,
          ...(bubble.startTick !== undefined
            ? { startTick: bubble.startTick }
            : {}),
          ...(bubble.group !== undefined ? { group: bubble.group } : {}),
          ...(bubble.part !== undefined ? { part: bubble.part } : {}),
          ...(bubble.parts !== undefined ? { parts: bubble.parts } : {}),
        })),
      }
      : {}),
    ...(item.talking !== undefined ? { talking: item.talking } : {}),
    ...(item.typing !== undefined ? { typing: item.typing } : {}),
    ...(item.queued !== undefined ? { queued: item.queued } : {}),
    ...(item.syllables !== undefined ? { syllables: item.syllables } : {}),
    ...(item.startTick !== undefined ? { startTick: item.startTick } : {}),
    ...(item.expiresTick !== undefined
      ? { expiresTick: item.expiresTick }
      : {}),
  }));
}

/** Wire form of a world snapshot: players keep only wire fields. Terrain travels as `reveal`. */
/** @param {Pick<World,'tick'|'players'|'limits'>} world */
export function encodeWorld(world) {
  return {
    tick: world.tick,
    players: encodeMotionPlayers(world.players),
    ...(world.limits ? { limits: { ...world.limits } } : {}),
  };
}

/** @param {unknown} b */
function validWorldLimits(b) {
  if (
    !record(b) ||
    ![b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ].every(
      Number.isInteger,
    ) || !tile({ x: b.minX, y: b.minY, z: b.minZ }) ||
    !tile({ x: b.maxX, y: b.maxY, z: b.maxZ }) ||
    Number(b.minX) > Number(b.maxX) || Number(b.minY) > Number(b.maxY) ||
    Number(b.minZ) > Number(b.maxZ) || Number(b.minZ) < 0 ||
    Number(b.maxZ) > WORLD_TOP
  ) return false;
  return true;
}

/** @param {Record<string,unknown>} world */
function worldMetadata(world) {
  if (world.limits !== undefined) {
    if (!validWorldLimits(world.limits)) return false;
  }
  return true;
}

/** @param {Record<string,unknown>} value */
function stateVisibility(value) {
  if (value.mode === "master") {
    if (value.visibility !== null) return false;
  } else {
    if (
      !record(value.visibility) ||
      typeof value.visibility.sample !== "string" ||
      value.visibility.sample.length > 128 ||
      !record(value.visibility.visible)
    ) return false;
    try {
      unpackVisibility(
        /** @type {import('./visibility-wire.js').WireVisibility} */ (value
          .visibility),
      );
    } catch {
      return false;
    }
  }
  return true;
}

/** Returns null without exposing partially validated snapshot state. */
/** @param {unknown} value @returns {StatePacket|null} */
export function decodeState(value) {
  if (!record(value) || value.type !== "state" || !envelope(value)) return null;
  if (
    (value.mode !== "entity" && value.mode !== "master") ||
    !identifier(value.playerId) || !counter(value.acknowledgedSequence) ||
    !record(value.world)
  ) return null;
  const world = value.world;
  if (!counter(world.tick)) return null;
  if (!worldMetadata(world)) return null;
  const reveal = decodeChunks(value.reveal);
  if (!reveal || reveal.size > MAX_REVEAL_CHUNKS) return null;
  const parsedPlayers = players(world.players);
  const chat = chatRecords(value.chat);
  if (
    !parsedPlayers || !Object.hasOwn(parsedPlayers, value.playerId) || !chat
  ) return null;
  if (!stateVisibility(value)) return null;
  const parsed = /** @type {StatePacket} */ (value);
  return {
    type: "state",
    attempt: parsed.attempt,
    viewRevision: parsed.viewRevision,
    sightRevision: parsed.sightRevision,
    acknowledgedSequence: parsed.acknowledgedSequence,
    playerId: parsed.playerId,
    mode: parsed.mode,
    visibility: parsed.visibility === null ? null : {
      encoding: parsed.visibility.encoding,
      sample: parsed.visibility.sample,
      visible: parsed.visibility.visible,
    },
    world: {
      tick: parsed.world.tick,
      players: parsedPlayers,
      ...(parsed.world.limits ? { limits: { ...parsed.world.limits } } : {}),
    },
    reveal,
    chat,
  };
}

/** @param {unknown} value @returns {MotionPacket|null} */
export function decodeMotion(value) {
  if (
    !record(value) || value.type !== "motion" || !envelope(value) ||
    !counter(value.tick) || !counter(value.acknowledgedSequence)
  ) return null;
  const parsedPlayers = players(value.players);
  if (!parsedPlayers) return null;
  const parsed = /** @type {MotionPacket} */ (value);
  return {
    type: "motion",
    attempt: parsed.attempt,
    viewRevision: parsed.viewRevision,
    sightRevision: parsed.sightRevision,
    acknowledgedSequence: parsed.acknowledgedSequence,
    tick: parsed.tick,
    players: parsedPlayers,
  };
}

/** @param {unknown} value @returns {ChatPacket|null} */
export function decodeChat(value) {
  if (
    !record(value) || value.type !== "chat" || !envelope(value) ||
    !counter(value.tick)
  ) return null;
  const chat = chatRecords(value.chat);
  if (!chat) return null;
  const parsed = /** @type {ChatPacket} */ (value);
  return {
    type: "chat",
    attempt: parsed.attempt,
    viewRevision: parsed.viewRevision,
    sightRevision: parsed.sightRevision,
    tick: parsed.tick,
    chat,
  };
}

export { decodeControl } from "./control-wire.js";

// Host-to-guest feeds live in their own files; this module stays the one place
// the rest of the code imports a codec from.
export { decodeMining } from "./mining-wire.js";
export { decodeSounds } from "./sound-wire.js";
export { decodeMusicCue } from "./music-wire.js";
export { decodeHeld, decodeInventory, decodeItems } from "./items-wire.js";

/** @typedef {import('./music-wire.js').MusicCue} MusicCue */
