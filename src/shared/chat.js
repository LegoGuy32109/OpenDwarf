// @ts-check

import { syllableCount } from "./speech.js";
import { bubbleStart, TICK_MS } from "./world.js";

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world.js').Player} Player */
/** @typedef {"text"|"talking"|"none"} ChatBand */
/**
 * One speaker in a listener's chat feed. Speech fields (ADR 0006): a bubble's
 * `startTick` is when its speech and syllable reveal begin; a bubble still
 * waiting in the speaker's queue is never sent, and `queued` says one waits.
 * `syllables` rides on a talking indicator so a far listener can murmur, and
 * `startTick` says which message those syllables belong to (the newest started
 * bubble's start), so the listener can tell a murmur from text it already heard.
 * @typedef {{id:string,x:number,y:number,z:number,text?:string,talking?:boolean,typing?:boolean,queued?:boolean,syllables?:number,startTick?:number,expiresTick?:number,bubbles?:{text:string,expiresTick:number,startTick?:number}[]}} ChatRecord
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
    // Only bubbles whose start has come leave the host (ADR 0006); a waiting
    // bubble's text stays behind and the listener sees only that one waits.
    const live = (speaker.messages ?? []).filter((bubble) =>
      world.tick < bubble.until
    );
    const started = live.filter((bubble) => bubbleStart(bubble) <= world.tick);
    const queued = live.length > started.length;
    if (!started.length && !queued && !speaker.typing) {
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
    const newest = started.at(-1);
    const expiresTick = Math.max(0, ...started.map((bubble) => bubble.until));
    if (newest && band === "text") {
      records.push({
        ...base,
        text: newest.text,
        expiresTick,
        bubbles: started.map((bubble) => ({
          text: bubble.text,
          expiresTick: bubble.until,
          startTick: bubbleStart(bubble),
        })),
        ...(speaker.typing ? { typing: true } : {}),
        ...(queued ? { queued: true } : {}),
      });
    } else if (newest && band === "talking") {
      records.push({
        ...base,
        talking: true,
        syllables: syllableCount(newest.text),
        startTick: bubbleStart(newest),
        expiresTick,
      });
    } else if ((speaker.typing || queued) && band === "text") {
      records.push({
        ...base,
        ...(speaker.typing ? { typing: true } : {}),
        ...(queued ? { queued: true } : {}),
      });
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
 * @typedef {Omit<ChatRecord,"bubbles"> & {expiresAt?:number,startAt?:number,bubbles?:{text:string,expiresTick:number,startTick?:number,expiresAt?:number,startAt?:number}[]}} DisplayChatRecord
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

/**
 * Bubbles to draw for one record, oldest first, newest last, with the local
 * time each began speaking (`startAt`, absent when it has no start).
 * @param {DisplayChatRecord} record @param {number} now
 */
export function liveBubbleItems(record, now) {
  if (record.text === undefined) return [];
  const bubbles = record.bubbles ??
    [{ text: record.text, expiresAt: record.expiresAt }];
  return bubbles.filter((bubble) =>
    bubble.expiresAt === undefined || now < bubble.expiresAt
  ).slice(-3).map((bubble) => ({
    text: bubble.text,
    startAt: /** @type {{startAt?:number}} */ (bubble).startAt,
  }));
}

/** Bubble texts to draw for one record, oldest first. @param {DisplayChatRecord} record @param {number} now */
export function liveBubbles(record, now) {
  return liveBubbleItems(record, now).map((bubble) => bubble.text);
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
        ...(bubble.startTick === undefined ? {} : {
          startAt: oldBubble?.startAt ??
            (old?.startTick === bubble.startTick ? old.startAt : undefined) ??
            now + (bubble.startTick - hostTick) * TICK_MS,
        }),
      };
    });
    const startAt = record.startTick === undefined ? undefined : (
      old?.startTick === record.startTick && old.startAt !== undefined
        ? old.startAt
        : old?.bubbles?.find((item) => item.startTick === record.startTick)
          ?.startAt
    ) ?? now + (record.startTick - hostTick) * TICK_MS;
    records.push({
      ...record,
      ...(bubbles ? { bubbles } : {}),
      ...(startAt === undefined ? {} : { startAt }),
      expiresAt,
    });
  }
  return records;
}
