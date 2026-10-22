// @ts-check

import { isTrader, reachesTrader } from "./shop.js";
import { speechDurationMs, syllableCount, voiceFromId } from "./speech.js";
import { bubbleStart, submitMessage, TICK_MS } from "./world.js";

/**
 * NPC conversations on the world host (docs/features/npc-conversations.md). A
 * player confirms a line; the host speaks it through the player's speech queue
 * and, for a line that asks something, queues one reply from the NPC. The NPC
 * answers one request at a time, in order: it shows its thought icon, then
 * speaks the reply with the asker's name.
 */

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world.js').Player} Player */
/** @typedef {{id:string,line:string,replies?:readonly string[]}} Choice */

/** The silent context a trader's menu shows. */
export const TRADER_DESCRIPTION = "An ore buyer with coin to trade.";

/** The authored answers to "What do you buy?". The host picks one. */
export const BUY_REPLIES = Object.freeze([
  "I buy coal, iron, lapis, redstone, gold, emeralds and diamonds.",
  "Anything that glitters out of the rock. Ore and gems, never stone.",
  "Bring me ore and gems and I pay in coin. Stone and tools I leave.",
]);

/** The trader's choices, in menu order. Only a choice with replies is answered. @type {readonly Choice[]} */
export const TRADER_CHOICES = Object.freeze([
  { id: "sell", line: "I have ore to trade" },
  { id: "buys", line: "What do you buy?", replies: BUY_REPLIES },
]);

/** The NPC's thinking time bounds, in milliseconds. */
export const THINK_MIN_MS = 1000;
export const THINK_MAX_MS = 3000;
/** Syllables at which a reply earns the full length-based wait. */
const LONG_REPLY_SYLLABLES = 20;

/** @param {string} id @returns {Choice|undefined} */
export function traderChoice(id) {
  return TRADER_CHOICES.find((choice) => choice.id === id);
}

/** Pick one of a choice's authored replies. The host calls this once, so every listener hears the same line. @param {readonly string[]} replies @param {()=>number} random */
export function pickReply(replies, random) {
  return replies[
    Math.min(replies.length - 1, Math.floor(random() * replies.length))
  ];
}

/**
 * How many ticks the NPC thinks before it speaks `reply`: one to three seconds,
 * longer for a longer reply. `roll` in [0, 1) adds up to half a second. It
 * does not choose the reply text.
 * @param {string} reply @param {number} roll
 */
export function thinkingTicks(reply, roll) {
  const length = Math.min(1, syllableCount(reply) / LONG_REPLY_SYLLABLES);
  const ms = THINK_MIN_MS + length * 1500 +
    Math.max(0, Math.min(1, roll)) * 500;
  return Math.ceil(Math.min(THINK_MAX_MS, ms) / TICK_MS);
}

/** The tick a speaker's last queued message finishes. @param {Player} speaker */
function speechEnd(speaker) {
  const last = speaker.messages?.at(-1);
  if (!last) return 0;
  return bubbleStart(last) +
    Math.ceil(speechDurationMs(last.text, voiceFromId(speaker.id)) / TICK_MS);
}

/**
 * @typedef {{playerId:string,name:string,reply:string,lineEnd:number,speakAt:number|null}} Request
 * A confirmed request waiting for its answer. `speakAt` is set once the NPC
 * starts thinking.
 */

/**
 * The reply queues of a world's NPCs. `ask` takes a confirmed line from a
 * player; `step` runs once a tick.
 * @param {World} world @param {()=>number} [random]
 */
export function createConversations(world, random = Math.random) {
  /** @type {Map<string,Request[]>} */
  const queues = new Map();
  /** The tick each NPC finishes its last reply, so the next one waits its turn. @type {Map<string,number>} */
  const busyUntil = new Map();

  /** @param {string} npcId */
  const queueOf = (npcId) => {
    let queue = queues.get(npcId);
    if (!queue) queues.set(npcId, queue = []);
    return queue;
  };

  return {
    /**
     * A player confirms a choice. The host checks the player, the NPC, the
     * range, and that no earlier request of the player's waits for this NPC.
     * @param {string} playerId @param {unknown} npcId @param {unknown} choiceId
     * @returns {{ok:true}|{ok:false,reason:string}}
     */
    ask(playerId, npcId, choiceId) {
      const player = world.players[playerId];
      if (!player) return { ok: false, reason: "unknown player" };
      const npc =
        typeof npcId === "string" && Object.hasOwn(world.players, npcId)
          ? world.players[npcId]
          : undefined;
      if (!npc || !isTrader(npc)) {
        return { ok: false, reason: "nobody to talk to" };
      }
      if (!reachesTrader(world, player, npc.id)) {
        return { ok: false, reason: "too far to talk" };
      }
      const choice = typeof choiceId === "string"
        ? traderChoice(choiceId)
        : undefined;
      if (!choice) return { ok: false, reason: "unknown choice" };
      const queue = queueOf(npc.id);
      if (choice.replies && queue.some((item) => item.playerId === playerId)) {
        return {
          ok: false,
          reason: `${npc.name || "They"} still owe you an answer`,
        };
      }
      // The thought icon the menu raised stays up while the menu is open.
      const typing = player.typing;
      if (!submitMessage(world, playerId, choice.line)) {
        player.typing = typing;
        return { ok: false, reason: "you are talking too much" };
      }
      player.typing = typing;
      if (choice.replies) {
        queue.push({
          playerId,
          name: player.name || "Traveler",
          reply: pickReply(choice.replies, random),
          lineEnd: speechEnd(player),
          speakAt: null,
        });
      }
      return { ok: true };
    },

    /** Advance every NPC's queue: start thinking once the asker's line and the NPC's last reply are done, then speak. */
    step() {
      for (const [npcId, queue] of queues) {
        const npc = world.players[npcId];
        const head = queue[0];
        if (!npc || !head) {
          if (npc) npc.typing = false;
          if (!npc) queues.delete(npcId);
          continue;
        }
        if (head.speakAt === null) {
          if (
            world.tick < head.lineEnd ||
            world.tick < (busyUntil.get(npcId) ?? 0)
          ) continue;
          head.speakAt = world.tick + thinkingTicks(head.reply, random());
          npc.typing = true;
        }
        if (world.tick < head.speakAt) continue;
        queue.shift();
        npc.typing = false;
        submitMessage(world, npcId, `${head.name}, ${head.reply}`);
        busyUntil.set(npcId, speechEnd(npc));
      }
    },

    /** The asker names waiting on an NPC, in answer order. @param {string} npcId */
    waiting(npcId) {
      return (queues.get(npcId) ?? []).map((item) => item.playerId);
    },
  };
}
