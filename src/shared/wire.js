// @ts-check

import { WORLD_TOP } from "./terrain.js";
import { decodeChunks, MAX_REVEAL_CHUNKS } from "./chunk-wire.js";
import { isItemKind, MAX_STACK_COUNT } from "./items.js";
import { MAX_SOUND_ENTRIES, MAX_SOUND_TAGS } from "./sound.js";
import { unpackVisibility } from "./visibility-wire.js";

/** @typedef {import('./world.js').Player} Player */
/** @typedef {import('./world.js').World} World */
/** @typedef {Omit<Player,'typing'|'message'|'messageUntil'>} MotionPlayer */
/** @typedef {import('./chat.js').ChatRecord} ChatRecord */
/** @typedef {{attempt:string,viewRevision:number,sightRevision:number}} Envelope */
/** @typedef {Envelope & {type:"state",world:Pick<World,'tick'|'players'>,reveal:Map<string,import('./terrain.js').ChunkData>,visibility:import('./visibility-wire.js').WireVisibility|null,mode:"entity"|"master",playerId:string,chat:ChatRecord[],acknowledgedSequence:number}} StatePacket */
/** @typedef {Envelope & {type:"motion",tick:number,players:World['players'],acknowledgedSequence:number}} MotionPacket */
/** @typedef {Envelope & {type:"chat",tick:number,chat:ChatRecord[]}} ChatPacket */

export const PROTOCOL_VERSION = 4;
export const MAX_PACKET_BYTES = 256 * 1024;
const MAX_ENTITIES = 1024;
const MAX_TICK = Number.MAX_SAFE_INTEGER;
/** Tile coordinates are bounded, not tied to a world size; terrain is chunked. */
const MAX_COORD = 1 << 24;

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

/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @param {number} min @param {number} max @returns {value is number} */
function finite(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min &&
    value <= max;
}

/** @param {unknown} value @param {number} [max] @returns {value is number} */
function counter(value, max = MAX_TICK) {
  return finite(value, 0, max) && Number.isSafeInteger(value);
}

/** @param {unknown} value @param {number} [limit] @returns {value is string} */
function identifier(value, limit = 128) {
  return typeof value === "string" && value.length > 0 &&
    value.length <= limit &&
    ![...value].some((char) => char.charCodeAt(0) < 32) &&
    value !== "__proto__" && value !== "constructor" && value !== "prototype";
}

/** @param {Record<string,unknown>} value */
function envelope(value) {
  return identifier(value.attempt) && counter(value.viewRevision) &&
    counter(value.sightRevision);
}

/** @param {unknown} value */
function tile(value) {
  return record(value) && finite(value.x, -MAX_COORD, MAX_COORD) &&
    finite(value.y, -MAX_COORD, MAX_COORD) &&
    finite(value.z, -1, WORLD_TOP + 1);
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

/** @param {unknown} value @returns {value is Player} */
function player(value) {
  if (
    !record(value) || !identifier(value.id) || !tile(value) ||
    !Number.isInteger(value.z)
  ) {
    return false;
  }
  if (
    typeof value.name !== "string" || value.name.length > 24 ||
    typeof value.facingLeft !== "boolean" ||
    (value.move !== null && !movement(value.move))
  ) return false;
  if (
    value.viewMotion !== undefined && !movement(value.viewMotion, true)
  ) {
    return false;
  }
  if (value.free !== undefined && typeof value.free !== "boolean") return false;
  if (value.size !== undefined && !finite(value.size, 0.01, 4)) return false;
  if (value.vx !== undefined && !finite(value.vx, -10, 10)) return false;
  if (value.vy !== undefined && !finite(value.vy, -10, 10)) return false;
  return true;
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

/** A message holds at most 120 characters, so no more syllables than that. */
const MAX_SYLLABLES = 120;

/** @param {unknown} value @returns {ChatRecord[]|null} */
function chatRecords(value) {
  if (!Array.isArray(value) || value.length > MAX_ENTITIES) return null;
  const ids = new Set();
  for (const item of value) {
    if (!record(item) || !identifier(item.id) || !tile(item)) return null;
    if (ids.has(item.id)) return null;
    ids.add(item.id);
    if (
      item.text !== undefined &&
      (typeof item.text !== "string" || !item.text.length ||
        item.text.length > 120)
    ) return null;
    if (item.talking !== undefined && typeof item.talking !== "boolean") {
      return null;
    }
    if (item.typing !== undefined && typeof item.typing !== "boolean") {
      return null;
    }
    if (item.queued !== undefined && typeof item.queued !== "boolean") {
      return null;
    }
    if (
      item.syllables !== undefined && !counter(item.syllables, MAX_SYLLABLES)
    ) return null;
    if (item.startTick !== undefined && !counter(item.startTick)) return null;
    if (item.expiresTick !== undefined && !counter(item.expiresTick)) {
      return null;
    }
    if (item.bubbles !== undefined) {
      if (
        item.text === undefined || !Array.isArray(item.bubbles) ||
        item.bubbles.length > 3
      ) return null;
      for (const bubble of item.bubbles) {
        if (
          !record(bubble) || typeof bubble.text !== "string" ||
          !bubble.text.length || bubble.text.length > 120 ||
          !counter(bubble.expiresTick) ||
          (bubble.startTick !== undefined && !counter(bubble.startTick))
        ) return null;
      }
    }
    if (
      item.text === undefined && item.talking !== true &&
      item.typing !== true && item.queued !== true
    ) {
      return null;
    }
    if (
      (item.text !== undefined || item.talking === true) &&
      item.expiresTick === undefined
    ) {
      return null;
    }
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
/** @param {Pick<World,'tick'|'players'>} world */
export function encodeWorld(world) {
  return {
    tick: world.tick,
    players: encodeMotionPlayers(world.players),
  };
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
  const reveal = decodeChunks(value.reveal);
  if (!reveal || reveal.size > MAX_REVEAL_CHUNKS) return null;
  const parsedPlayers = players(world.players);
  const chat = chatRecords(value.chat);
  if (
    !parsedPlayers || !Object.hasOwn(parsedPlayers, value.playerId) || !chat
  ) return null;
  if (value.mode === "master") {
    if (value.visibility !== null) return null;
  } else {
    if (
      !record(value.visibility) ||
      typeof value.visibility.sample !== "string" ||
      value.visibility.sample.length > 128 ||
      !record(value.visibility.visible)
    ) return null;
    try {
      unpackVisibility(
        /** @type {import('./visibility-wire.js').WireVisibility} */ (value
          .visibility),
      );
    } catch {
      return null;
    }
  }
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

/** Control commands have small, independent schemas. No number coercion. */
/** @param {unknown} value @returns {Record<string,unknown>|null} */
export function decodeControl(value) {
  if (!record(value)) return null;
  switch (value.type) {
    case "input":
      return counter(value.sequence) && finite(value.dx, -1, 1) &&
          Number.isInteger(value.dx) &&
          finite(value.dy, -1, 1) && Number.isInteger(value.dy) &&
          (value.sprint === undefined || typeof value.sprint === "boolean")
        ? value
        : null;
    case "move":
      return counter(value.sequence) && finite(value.dx, -1, 1) &&
          Number.isInteger(value.dx) &&
          finite(value.dy, -1, 1) && Number.isInteger(value.dy)
        ? value
        : null;
    case "cancel":
      return counter(value.sequence) ? value : null;
    case "mine":
    case "place":
      return Number.isInteger(value.x) &&
          finite(value.x, -MAX_COORD, MAX_COORD) &&
          Number.isInteger(value.y) && finite(value.y, -MAX_COORD, MAX_COORD) &&
          Number.isInteger(value.z) && finite(value.z, 0, WORLD_TOP)
        ? value
        : null;
    case "mine-cancel":
      return value;
    case "pickup":
      return typeof value.kind === "string" && value.kind.length <= 24 &&
          Number.isInteger(value.x) &&
          finite(value.x, -MAX_COORD, MAX_COORD) &&
          Number.isInteger(value.y) && finite(value.y, -MAX_COORD, MAX_COORD) &&
          Number.isInteger(value.z) && finite(value.z, 0, WORLD_TOP)
        ? value
        : null;
    case "hold":
      return isItemKind(value.kind) ? value : null;
    case "sell":
      return value.all === true ||
          (identifier(value.kind, 24) &&
            counter(value.count, MAX_STACK_COUNT) &&
            value.count >= 1)
        ? value
        : null;
    case "mode":
      return value.mode === "entity" || value.mode === "master" ? value : null;
    case "typing":
      return typeof value.typing === "boolean" ? value : null;
    case "message":
      return typeof value.text === "string" && value.text.length <= 120
        ? value
        : null;
    case "nick":
      return typeof value.name === "string" && value.name.length <= 24
        ? value
        : null;
    case "ping":
    case "pong":
      return identifier(value.id) ? value : null;
    case "resync":
      return value;
    default:
      return null;
  }
}

/** Most mining entries one message may carry. */
export const MAX_MINING_ENTRIES = 256;

/**
 * Host to guest: the mining actions the guest can see, replacing the earlier
 * list. Returns null for anything malformed.
 * @param {unknown} value @returns {import('./mining.js').MiningEntry[]|null}
 */
export function decodeMining(value) {
  if (
    !record(value) || value.type !== "mining" ||
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_MINING_ENTRIES
  ) return null;
  /** @type {import('./mining.js').MiningEntry[]} */
  const entries = [];
  for (const entry of value.entries) {
    if (
      !record(entry) || !identifier(entry.id) ||
      !finite(entry.x, -MAX_COORD, MAX_COORD) || !Number.isInteger(entry.x) ||
      !finite(entry.y, -MAX_COORD, MAX_COORD) || !Number.isInteger(entry.y) ||
      !finite(entry.z, 0, WORLD_TOP) || !Number.isInteger(entry.z) ||
      !finite(entry.elapsedMs, 0, 60_000) ||
      !finite(entry.totalMs, 1, 60_000)
    ) return null;
    entries.push({
      id: entry.id,
      x: entry.x,
      y: entry.y,
      z: entry.z,
      elapsedMs: entry.elapsedMs,
      totalMs: entry.totalMs,
    });
  }
  return entries;
}

/**
 * Host to guest: the sound events the guest hears this tick (ADR 0008).
 * Returns null for anything malformed.
 * @param {unknown} value @returns {import('./sound.js').HeardSound[]|null}
 */
export function decodeSounds(value) {
  if (
    !record(value) || value.type !== "sounds" || !Array.isArray(value.list) ||
    value.list.length > MAX_SOUND_ENTRIES
  ) return null;
  /** @type {import('./sound.js').HeardSound[]} */
  const list = [];
  for (const entry of value.list) {
    if (
      !record(entry) || !Array.isArray(entry.tags) || !entry.tags.length ||
      entry.tags.length > MAX_SOUND_TAGS ||
      !entry.tags.every((tag) => identifier(tag, 32)) ||
      !finite(entry.x, -MAX_COORD, MAX_COORD) ||
      !finite(entry.y, -MAX_COORD, MAX_COORD) ||
      !finite(entry.z, 0, WORLD_TOP) || !counter(entry.tick) ||
      typeof entry.seen !== "boolean"
    ) return null;
    list.push({
      tags: /** @type {string[]} */ (entry.tags),
      x: entry.x,
      y: entry.y,
      z: entry.z,
      tick: entry.tick,
      seen: entry.seen,
    });
  }
  return list;
}

/**
 * A music cue: the track the world host started and the tick it started on
 * (ADR 0009).
 * @typedef {{key:string,hash:string,startTick:number,atTick?:number,position?:number}} MusicCue
 */

/** One segment of a media key, as the shell's `/media/` route accepts it. */
const MEDIA_SEGMENT = /^[A-Za-z0-9 ._()~-]+$/;

/** @param {unknown} value @returns {value is string} */
function mediaKey(value) {
  return typeof value === "string" && value.length >= 1 &&
    value.length <= 512 &&
    value.split("/").every((part) =>
      MEDIA_SEGMENT.test(part) && !part.startsWith(".")
    );
}

/** The longest track position a cue may carry, in seconds. */
const MAX_MUSIC_POSITION = 24 * 60 * 60;

/**
 * Host to guest: the current music cue. Returns null for anything malformed:
 * a key that is not a media key, a hash that is not 12 hex digits, or a start
 * tick that is not a bounded whole number. A heartbeat adds `atTick` and
 * `position`, the seconds the host's track was at on that tick; both or
 * neither, or the cue is malformed.
 * @param {unknown} value @returns {MusicCue|null}
 */
export function decodeMusicCue(value) {
  if (
    !record(value) || value.type !== "music" || !mediaKey(value.key) ||
    typeof value.hash !== "string" || !/^[0-9a-f]{12}$/.test(value.hash) ||
    !counter(value.startTick)
  ) return null;
  /** @type {MusicCue} */
  const cue = { key: value.key, hash: value.hash, startTick: value.startTick };
  if (value.atTick === undefined && value.position === undefined) return cue;
  const position = value.position;
  if (
    !counter(value.atTick) || typeof position !== "number" ||
    !Number.isFinite(position) || position < 0 ||
    position > MAX_MUSIC_POSITION
  ) return null;
  return { ...cue, atTick: value.atTick, position };
}

/** Most stacks one tile or one inventory may carry in a message: one per item kind. */
const MAX_STACKS = 16;
/** Most tiles one dropped item message may carry. */
export const MAX_ITEM_ENTRIES = 1024;

/** @param {unknown} value @returns {import('./items.js').Stack[]|null} */
function decodeStacks(value) {
  if (!Array.isArray(value) || value.length > MAX_STACKS) return null;
  /** @type {import('./items.js').Stack[]} */
  const stacks = [];
  for (const stack of value) {
    if (
      !record(stack) || !isItemKind(stack.kind) ||
      !counter(stack.count, MAX_STACK_COUNT) || stack.count < 1 ||
      stacks.some((other) => other.kind === stack.kind)
    ) return null;
    stacks.push({
      kind: /** @type {string} */ (stack.kind),
      count: stack.count,
    });
  }
  return stacks;
}

/**
 * Host to guest: the dropped items on the tiles the guest can see, replacing
 * the earlier list. Returns null for anything malformed.
 * @param {unknown} value @returns {import('./items.js').DroppedEntry[]|null}
 */
export function decodeItems(value) {
  if (
    !record(value) || value.type !== "items" || !Array.isArray(value.entries) ||
    value.entries.length > MAX_ITEM_ENTRIES
  ) return null;
  /** @type {import('./items.js').DroppedEntry[]} */
  const entries = [];
  for (const entry of value.entries) {
    if (
      !record(entry) || !Number.isInteger(entry.x) ||
      !finite(entry.x, -MAX_COORD, MAX_COORD) || !Number.isInteger(entry.y) ||
      !finite(entry.y, -MAX_COORD, MAX_COORD) || !Number.isInteger(entry.z) ||
      !finite(entry.z, 0, WORLD_TOP)
    ) return null;
    const stacks = decodeStacks(entry.stacks);
    if (!stacks || !stacks.length) return null;
    entries.push({ x: entry.x, y: entry.y, z: entry.z, stacks });
  }
  return entries;
}

/**
 * Host to its owner only: an entity's inventory. Returns null for anything
 * malformed.
 * @param {unknown} value @returns {import('./items.js').Stack[]|null}
 */
export function decodeInventory(value) {
  if (!record(value) || value.type !== "inventory") return null;
  return decodeStacks(value.stacks);
}

/**
 * Host to its owner only: the item kind the entity holds. Returns null for
 * anything malformed.
 * @param {unknown} value @returns {string|null}
 */
export function decodeHeld(value) {
  if (!record(value) || value.type !== "held") return null;
  return isItemKind(value.kind) ? /** @type {string} */ (value.kind) : null;
}
