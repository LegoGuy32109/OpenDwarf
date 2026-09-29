// @ts-check

import { TICK_MS } from "./world.js";

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world.js').Player} Player */
/** @typedef {"text"|"talking"|"none"} ChatBand */
/** @typedef {{id:string,x:number,y:number,z:number,text?:string,talking?:boolean,typing?:boolean,expiresTick?:number}} ChatRecord */

export const CHAT_TEXT_RADIUS = 5;
export const CHAT_TALKING_RADIUS = 12;
export const CHAT_Z_LIMIT = 4;
export const CHAT_BUFFER = 0.1;

/** @param {Player} listener @param {Player} speaker @param {ChatBand|undefined} previous */
export function chatBand(listener, speaker, previous) {
  if (Math.abs(listener.z - speaker.z) > CHAT_Z_LIMIT) return "none";
  const distance = Math.hypot(listener.x - speaker.x, listener.y - speaker.y);
  if (previous === "text") {
    if (distance <= CHAT_TEXT_RADIUS + CHAT_BUFFER) return "text";
    return distance <= CHAT_TALKING_RADIUS + CHAT_BUFFER ? "talking" : "none";
  }
  if (previous === "talking") {
    if (distance < CHAT_TEXT_RADIUS - CHAT_BUFFER) return "text";
    return distance <= CHAT_TALKING_RADIUS + CHAT_BUFFER ? "talking" : "none";
  }
  if (previous === "none") {
    if (distance < CHAT_TEXT_RADIUS - CHAT_BUFFER) return "text";
    return distance < CHAT_TALKING_RADIUS - CHAT_BUFFER ? "talking" : "none";
  }
  if (distance <= CHAT_TEXT_RADIUS) return "text";
  return distance <= CHAT_TALKING_RADIUS ? "talking" : "none";
}

/** @param {World} world @param {string} listenerId @param {Map<string,ChatBand>} bands @returns {ChatRecord[]} */
export function chatView(world, listenerId, bands) {
  const listener = world.players[listenerId];
  if (!listener) return [];
  /** @type {ChatRecord[]} */
  const records = [];
  for (const speaker of Object.values(world.players)) {
    const hasMessage = Boolean(speaker.message) &&
      world.tick < speaker.messageUntil;
    if (!hasMessage && !speaker.typing) {
      bands.delete(speaker.id);
      continue;
    }
    const band = chatBand(listener, speaker, bands.get(speaker.id));
    bands.set(speaker.id, band);
    if (band === "none") continue;
    const base = {
      id: speaker.id,
      x: speaker.x,
      y: speaker.y,
      z: speaker.z,
    };
    if (hasMessage && band === "text") {
      records.push({
        ...base,
        text: speaker.message,
        expiresTick: speaker.messageUntil,
      });
    } else if (hasMessage && band === "talking") {
      records.push({
        ...base,
        talking: true,
        expiresTick: speaker.messageUntil,
      });
    } else if (speaker.typing && band === "text") {
      records.push({ ...base, typing: true });
    }
  }
  return records;
}

/** @param {World['players']} players @returns {World['players']} */
export function withoutChat(players) {
  return Object.fromEntries(
    Object.entries(players).map(([id, player]) => [
      id,
      { ...player, message: "", messageUntil: 0, typing: false },
    ]),
  );
}

/** @typedef {ChatRecord & {expiresAt?:number}} DisplayChatRecord */

/** @param {DisplayChatRecord[]} existing @param {ChatRecord[]} incoming @param {number} hostTick @param {number} [now] */
export function receiveChat(
  existing,
  incoming,
  hostTick,
  now = performance.now(),
) {
  const prior = new Map(existing.map((record) => [record.id, record]));
  /** @type {DisplayChatRecord[]} */
  const records = [];
  for (const record of incoming) {
    if (record.expiresTick !== undefined && record.expiresTick <= hostTick) {
      continue;
    }
    const old = prior.get(record.id);
    const expiresAt = record.expiresTick === undefined
      ? undefined
      : old?.expiresTick === record.expiresTick && old.expiresAt !== undefined
      ? old.expiresAt
      : now + (record.expiresTick - hostTick) * TICK_MS;
    records.push({ ...record, expiresAt });
  }
  return records;
}
