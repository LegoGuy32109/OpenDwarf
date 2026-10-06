// @ts-check

import { TICK_MS } from "./world.js";

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world.js').Player} Player */
/** @typedef {"text"|"talking"|"none"} ChatBand */
/**
 * One speaker in a listener's chat feed. Speech fields (ADR 0006): a bubble's
 * `startTick` is when its speech and syllable reveal begin; a bubble still
 * waiting in the speaker's queue is never sent, and `queued` says one waits.
 * `syllables` rides on a talking indicator so a far listener can murmur.
 * @typedef {{id:string,x:number,y:number,z:number,text?:string,talking?:boolean,typing?:boolean,queued?:boolean,syllables?:number,expiresTick?:number,bubbles?:{text:string,expiresTick:number,startTick?:number}[]}} ChatRecord
 */

export const CHAT_TEXT_RADIUS = 5;
export const CHAT_TALKING_RADIUS = 12;
export const CHAT_Z_LIMIT = 4;
export const CHAT_BUFFER = 0.1;

/** Width in bubble pixels of the three thought bubble dots. */
export const THOUGHT_DOTS_WIDTH = 24;
const THOUGHT_PERIOD_MS = 1200;

/**
 * Lift of each thought bubble dot at `now`, from 0 (rest) to 1 (top). The dots
 * rise in turn, so the bubble reads as thinking. A player shows the bubble for
 * any reason by setting `typing` on their player (see `setTyping`); the host
 * already sends it to every listener within chat hearing range.
 * @param {number} now milliseconds
 * @returns {[number,number,number]}
 */
export function thoughtDotLifts(now) {
  const phase = (now % THOUGHT_PERIOD_MS) / THOUGHT_PERIOD_MS;
  /** @param {number} offset */
  const lift = (offset) => {
    const local = (phase - offset + 1) % 1;
    return local < 0.4 ? Math.sin(local / 0.4 * Math.PI) : 0;
  };
  return [lift(0), lift(0.15), lift(0.3)];
}

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
      const bubbles = (speaker.messages ?? [])
        .filter((bubble) => world.tick < bubble.until)
        .map((bubble) => ({ text: bubble.text, expiresTick: bubble.until }));
      records.push({
        ...base,
        text: speaker.message,
        expiresTick: speaker.messageUntil,
        ...(bubbles.length ? { bubbles } : {}),
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
      { ...player, message: "", messageUntil: 0, messages: [], typing: false },
    ]),
  );
}

/**
 * A chat record on the listening client, with host ticks turned into local
 * `performance.now()` times. A bubble's `startAt` is when its syllable reveal
 * and chatter begin there (ADR 0006); the reveal and the audio both read it.
 * @typedef {Omit<ChatRecord,"bubbles"> & {expiresAt?:number,bubbles?:{text:string,expiresTick:number,startTick?:number,expiresAt?:number,startAt?:number}[]}} DisplayChatRecord
 */

/** @typedef {"small"|"medium"|"large"} TextSize */
export const TEXT_SIZES = /** @type {TextSize[]} */ ([
  "small",
  "medium",
  "large",
]);
/** Bubble text size as a share of the previous fixed size; medium is the default. */
export const TEXT_SIZE_SCALE = { small: 0.5, medium: 2 / 3, large: 1 };
export const TEXT_SIZE_KEY = "open-dwarf-text-size";

/** @param {unknown} value @returns {TextSize} */
export function parseTextSize(value) {
  return TEXT_SIZES.find((size) => size === value) ?? "medium";
}

/** Bubbles to draw for one record, oldest first, newest last. @param {DisplayChatRecord} record @param {number} now */
export function liveBubbles(record, now) {
  if (record.text === undefined) return [];
  const bubbles = record.bubbles ??
    [{ text: record.text, expiresAt: record.expiresAt }];
  return bubbles.filter((bubble) =>
    bubble.expiresAt === undefined || now < bubble.expiresAt
  ).slice(-3).map((bubble) => bubble.text);
}

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
    const bubbles = record.bubbles?.filter((bubble) =>
      bubble.expiresTick > hostTick
    ).map((bubble) => {
      const oldBubble = old?.bubbles?.find((item) =>
        item.expiresTick === bubble.expiresTick && item.text === bubble.text
      );
      return {
        ...bubble,
        expiresAt: oldBubble?.expiresAt ??
          now + (bubble.expiresTick - hostTick) * TICK_MS,
      };
    });
    records.push({
      ...record,
      ...(bubbles ? { bubbles } : {}),
      expiresAt,
    });
  }
  return records;
}
