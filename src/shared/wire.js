// @ts-check

import {
  counter,
  finite,
  identifier,
  MAX_COORD,
  record,
  tile,
} from "./wire-parse.js";
import { WORLD_TOP } from "./terrain.js";
import { isItemKind, MAX_STACK_COUNT } from "./items.js";
import { decodeChunks, MAX_REVEAL_CHUNKS } from "./chunk-wire.js";
import { unpackVisibility } from "./visibility-wire.js";

/** @typedef {import('./world.js').Player} Player */
/** @typedef {import('./world.js').World} World */
/** @typedef {Omit<Player,'typing'|'message'|'messageUntil'>} MotionPlayer */
/** @typedef {import('./chat.js').ChatRecord} ChatRecord */
/** @typedef {{attempt:string,viewRevision:number,sightRevision:number}} Envelope */
/** @typedef {Envelope & {type:"state",world:Pick<World,'tick'|'players'|'shops'|'limits'>,reveal:Map<string,import('./terrain.js').ChunkData>,visibility:import('./visibility-wire.js').WireVisibility|null,mode:"entity"|"master",playerId:string,chat:ChatRecord[],acknowledgedSequence:number}} StatePacket */
/** @typedef {Envelope & {type:"motion",tick:number,players:World['players'],acknowledgedSequence:number}} MotionPacket */
/** @typedef {Envelope & {type:"chat",tick:number,chat:ChatRecord[]}} ChatPacket */

export const PROTOCOL_VERSION = 5;
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
  if (value.npc !== undefined && typeof value.npc !== "boolean") return false;
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
      ...(value.npc !== undefined ? { npc: value.npc } : {}),
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
/** @param {Pick<World,'tick'|'players'|'shops'|'limits'>} world */
export function encodeWorld(world) {
  return {
    tick: world.tick,
    players: encodeMotionPlayers(world.players),
    ...(world.shops ? { shops: world.shops.map((at) => ({ ...at })) } : {}),
    ...(world.limits ? { limits: { ...world.limits } } : {}),
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
  if (
    world.shops !== undefined &&
    (!Array.isArray(world.shops) || world.shops.length > 1024 ||
      !world.shops.every((at) =>
        record(at) && tile(at) && [at.x, at.y, at.z].every(Number.isInteger)
      ))
  ) return null;
  if (world.limits !== undefined) {
    const b = world.limits;
    if (
      !record(b) ||
      ![b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ].every(
        Number.isInteger,
      ) || !tile({ x: b.minX, y: b.minY, z: b.minZ }) ||
      !tile({ x: b.maxX, y: b.maxY, z: b.maxZ }) ||
      Number(b.minX) > Number(b.maxX) || Number(b.minY) > Number(b.maxY) ||
      Number(b.minZ) > Number(b.maxZ) || Number(b.minZ) < 0 ||
      Number(b.maxZ) > WORLD_TOP
    ) return null;
  }
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
      ...(parsed.world.limits ? { limits: { ...parsed.world.limits } } : {}),
      ...(parsed.world.shops
        ? { shops: parsed.world.shops.map((at) => ({ ...at })) }
        : {}),
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

// Host-to-guest feeds live in their own files; this module stays the one place
// the rest of the code imports a codec from.
export { decodeMining } from "./mining-wire.js";
export { decodeSounds } from "./sound-wire.js";
export { decodeMusicCue } from "./music-wire.js";
export { decodeHeld, decodeInventory, decodeItems } from "./items-wire.js";

/** @typedef {import('./music-wire.js').MusicCue} MusicCue */
