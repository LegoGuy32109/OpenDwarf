// @ts-check

import { WORLD_TOP } from "./world.js";
import { unpackVisibility } from "./visibility-wire.js";

/** @typedef {import('./world.js').Player} Player */
/** @typedef {import('./world.js').World} World */
/** @typedef {Omit<Player,'typing'|'message'|'messageUntil'>} MotionPlayer */
/** @typedef {import('./chat.js').ChatRecord} ChatRecord */
/** @typedef {{attempt:string,viewRevision:number,sightRevision:number}} Envelope */
/** @typedef {Envelope & {type:"state",world:World,visibility:import('./visibility-wire.js').WireVisibility|null,mode:"entity"|"master",playerId:string,chat:ChatRecord[],acknowledgedSequence:number}} StatePacket */
/** @typedef {Envelope & {type:"motion",tick:number,players:World['players'],acknowledgedSequence:number}} MotionPacket */
/** @typedef {Envelope & {type:"chat",tick:number,chat:ChatRecord[]}} ChatPacket */

export const PROTOCOL_VERSION = 2;
export const MAX_PACKET_BYTES = 256 * 1024;
const MAX_ENTITIES = 1024;
const MAX_TICK = Number.MAX_SAFE_INTEGER;

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

/** @param {unknown} value @param {number} edge */
function tile(value, edge) {
  return record(value) && finite(value.x, -1, edge) &&
    finite(value.y, -1, edge) && finite(value.z, -1, WORLD_TOP + 1);
}

/** @param {unknown} value @param {number} edge @param {boolean} [boundary] */
function movement(value, edge, boundary = false) {
  if (!record(value)) return false;
  return counter(value.startTick) && counter(value.durationTicks, 1000) &&
    value.durationTicks > 0 && counter(value.sequence) &&
    (boundary
      ? tile(value.from, edge) && tile(value.to, edge) &&
        typeof value.entering === "boolean"
      : tile(value.origin, edge) && tile(value.target, edge) &&
        tile(value.startPosition, edge));
}

/** @param {unknown} value @param {number} edge @returns {value is Player} */
function player(value, edge) {
  if (
    !record(value) || !identifier(value.id) || !tile(value, edge) ||
    !Number.isInteger(value.z)
  ) {
    return false;
  }
  if (
    typeof value.name !== "string" || value.name.length > 24 ||
    typeof value.facingLeft !== "boolean" ||
    (value.move !== null && !movement(value.move, edge))
  ) return false;
  if (
    value.viewMotion !== undefined && !movement(value.viewMotion, edge, true)
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

/** @param {unknown} value @param {number} edge @returns {World['players']|null} */
function players(value, edge) {
  if (!record(value) || Object.keys(value).length > MAX_ENTITIES) return null;
  for (const [id, entity] of Object.entries(value)) {
    if (!identifier(id) || !player(entity, edge) || entity.id !== id) {
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

/** @param {unknown} value @returns {ChatRecord[]|null} */
function chatRecords(value) {
  if (!Array.isArray(value) || value.length > MAX_ENTITIES) return null;
  const ids = new Set();
  for (const item of value) {
    if (!record(item) || !identifier(item.id) || !tile(item, 32)) return null;
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
    if (item.expiresTick !== undefined && !counter(item.expiresTick)) {
      return null;
    }
    if (
      item.text === undefined && item.talking !== true && item.typing !== true
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
    ...(item.talking !== undefined ? { talking: item.talking } : {}),
    ...(item.typing !== undefined ? { typing: item.typing } : {}),
    ...(item.expiresTick !== undefined
      ? { expiresTick: item.expiresTick }
      : {}),
  }));
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
  if (world.edge !== 16 && world.edge !== 32) return null;
  const edge = world.edge;
  if (!counter(world.tick) || !Array.isArray(world.terrain)) return null;
  if (
    world.terrain.length !== (WORLD_TOP + 1) * world.edge ** 2 ||
    !world.terrain.every((cell) => cell === 0 || cell === 1 || cell === 2)
  ) return null;
  if (
    !Array.isArray(world.chunks) ||
    world.chunks.length !== (world.edge / 16) ** 2
  ) {
    return null;
  }
  const expectedChunks = Array.from(
    { length: (world.edge / 16) ** 2 },
    (_, i) => `${i % (edge / 16)},${Math.floor(i / (edge / 16))}`,
  );
  if (!world.chunks.every((chunk, index) => chunk === expectedChunks[index])) {
    return null;
  }
  const parsedPlayers = players(world.players, world.edge);
  const chat = chatRecords(value.chat);
  if (!parsedPlayers || !parsedPlayers[value.playerId] || !chat) return null;
  if (value.mode === "master") {
    if (value.visibility !== null) return null;
  } else {
    if (
      !record(value.visibility) || value.visibility.edge !== world.edge ||
      typeof value.visibility.sample !== "string" ||
      value.visibility.sample.length > 128 ||
      typeof value.visibility.visible !== "string" ||
      typeof value.visibility.memory !== "string"
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
      edge: parsed.visibility.edge,
      sample: parsed.visibility.sample,
      visible: parsed.visibility.visible,
      memory: parsed.visibility.memory,
    },
    world: {
      tick: parsed.world.tick,
      edge: parsed.world.edge,
      chunks: [...parsed.world.chunks],
      terrain: [...parsed.world.terrain],
      players: parsedPlayers,
    },
    chat,
  };
}

/** @param {unknown} value @returns {MotionPacket|null} */
export function decodeMotion(value) {
  if (
    !record(value) || value.type !== "motion" || !envelope(value) ||
    !counter(value.tick) || !counter(value.acknowledgedSequence)
  ) return null;
  const parsedPlayers = players(value.players, 32);
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
    case "move":
      return counter(value.sequence) && finite(value.dx, -1, 1) &&
          Number.isInteger(value.dx) &&
          finite(value.dy, -1, 1) && Number.isInteger(value.dy)
        ? value
        : null;
    case "cancel":
      return counter(value.sequence) ? value : null;
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
