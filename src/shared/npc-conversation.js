// @ts-check

import { inventoryOf, itemInfo, MAX_STACK_COUNT } from "./items.js";
import {
  coinsText,
  isSellable,
  isTrader,
  priceOf,
  reachesTrader,
  sellItems,
} from "./shop.js";
import { speechDurationMs, syllableCount, voiceFromId } from "./speech.js";
import { DIALOGUE } from "./dialogue.js";
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
/** @typedef {import('./shop.js').SaleResult} SaleResult */
/** @typedef {{id:string,line:string,replies?:readonly string[]}} Choice */

/** The silent context a trader's menu shows. */
export const TRADER_DESCRIPTION = DIALOGUE.traderDescription;

/** The authored answers to "What do you buy?". The host picks one. Each reads after "<name>, ", so it starts in lower case unless it starts with "I". */
export const BUY_REPLIES = DIALOGUE.buyReplies;

/** The trader's choices, in menu order. Only a choice with replies is answered. @type {readonly Choice[]} */
export const TRADER_CHOICES = Object.freeze([
  { id: "sell", line: DIALOGUE.choices.sell },
  { id: "buys", line: DIALOGUE.choices.buys, replies: BUY_REPLIES },
]);

/** The choice id of a spoken sale. It carries a `sale` request: one ore kind or all ore. */
export const SALE_CHOICE = "sale";

/**
 * @typedef {{name:string,count:number,coins:number}} SaleFacts
 * The real numbers of a sale: the item name (a per-kind sale), the item count,
 * and the coins paid, or owed when the coin stack is full.
 */
/** Item names that take an s in the plural. */
const COUNTABLE = new Set(["emerald", "diamond"]);
/** "3 coal", "1 diamond", "2 diamonds". @param {number} count @param {string} name */
const items = (count, name) =>
  `${count} ${name}${count !== 1 && COUNTABLE.has(name) ? "s" : ""}`;
/** @param {number} count */
const pieces = (count) => `${count} piece${count === 1 ? "" : "s"}`;

/**
 * The authored answers to a spoken sale, three per outcome. Each is a function
 * of the sale's real numbers and reads after "<name>, " like `BUY_REPLIES`.
 * `kind` and `all` are accepted sales, `nothing` is a request with nothing to
 * sell, and `full` is a sale refused because the coin stack is full.
 * @type {Readonly<Record<"kind"|"all"|"nothing"|"full",readonly ((facts:SaleFacts)=>string)[]>>}
 */
export const SALE_REPLIES = Object.freeze(
  /** @type {Readonly<Record<"kind"|"all"|"nothing"|"full",readonly ((facts:SaleFacts)=>string)[]>>} */ ({
    kind: DIALOGUE.saleReplies.kind.map(
      (line) => (/** @type {SaleFacts} */ facts) =>
        render(line, {
          items: items(facts.count, facts.name),
          coinsText: coinsText(facts.coins),
          maxStackCount: MAX_STACK_COUNT,
        }, ["items", "coinsText"]),
    ),
    all: DIALOGUE.saleReplies.all.map(
      (line) => (/** @type {SaleFacts} */ facts) =>
        render(line, {
          pieces: pieces(facts.count),
          coinsText: coinsText(facts.coins),
          maxStackCount: MAX_STACK_COUNT,
        }, ["pieces", "coinsText"]),
    ),
    nothing: DIALOGUE.saleReplies.nothing.map((line) => () =>
      render(line, {}, [])
    ),
    full: DIALOGUE.saleReplies.full.map(
      (line) => (/** @type {SaleFacts} */ facts) =>
        render(line, {
          coinsText: coinsText(facts.coins),
          maxStackCount: MAX_STACK_COUNT,
        }, ["coinsText", "maxStackCount"]),
    ),
  }),
);

/** @param {string} template @param {Record<string,string|number>} values @param {string[]} allowed */
function render(template, values, allowed) {
  return template.replace(/\{(\w+)\}/g, (_match, key) => {
    if (!allowed.includes(key) || !Object.hasOwn(values, key)) {
      throw new Error(`Unsupported dialogue placeholder {${key}}`);
    }
    return String(values[key]);
  });
}

/** The NPC's thinking time bounds, in milliseconds. */
export const THINK_MIN_MS = 1000;
export const THINK_MAX_MS = 3000;
/** Syllables at which a reply earns the full length-based wait. */
const LONG_REPLY_SYLLABLES = 20;

/** @param {string} id @returns {Choice|undefined} */
export function traderChoice(id) {
  return TRADER_CHOICES.find((choice) => choice.id === id);
}

/** Pick one of a choice's authored replies. The host calls this once, so every listener hears the same line. @template T @param {readonly T[]} replies @param {()=>number} random @returns {T} */
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

  /**
   * The player and trader a request is for, or the reason it is refused. The
   * host checks the player, the NPC, and the range.
   * @param {string} playerId @param {unknown} npcId
   * @returns {{player:Player,npc:Player}|{ok:false,reason:string}}
   */
  function parties(playerId, npcId) {
    const player = world.players[playerId];
    if (!player) return { ok: false, reason: "unknown player" };
    const npc = typeof npcId === "string" && Object.hasOwn(world.players, npcId)
      ? world.players[npcId]
      : undefined;
    if (!npc || !isTrader(npc)) {
      return { ok: false, reason: "nobody to talk to" };
    }
    if (!reachesTrader(world, player, npc.id)) {
      return { ok: false, reason: "too far to talk" };
    }
    return { player, npc };
  }

  /** The refusal for a player whose earlier request still waits for this NPC, or null. @param {Player} player @param {Player} npc */
  function owedAnswer(player, npc) {
    if (!queueOf(npc.id).some((item) => item.playerId === player.id)) {
      return null;
    }
    return {
      ok: /** @type {const} */ (false),
      reason: `${npc.name || "The trader"} still owes you an answer`,
    };
  }

  /**
   * Speak the player's line, keeping the thought icon the open menu raised. A
   * refusal changes nothing.
   * @param {Player} player @param {string} line
   */
  function speak(player, line) {
    const typing = player.typing;
    const spoken = submitMessage(world, player.id, line);
    player.typing = typing;
    return spoken;
  }

  /** Queue the NPC's reply to the player's spoken line. @param {Player} player @param {Player} npc @param {string} reply */
  function queueReply(player, npc, reply) {
    queueOf(npc.id).push({
      playerId: player.id,
      name: player.name || "Traveler",
      reply,
      lineEnd: speechEnd(player),
      speakAt: null,
    });
  }

  /**
   * A confirmed sale: the player says "Sell all <ore>", the host sells at
   * once with the existing sale rule, and the NPC's reply describes the actual
   * result. A request that names no sellable kind is refused before anything is
   * spoken. A sale that finds nothing to sell, or no room for the coins, is
   * spoken and answered, and changes nothing.
   * @param {Player} player @param {Player} npc @param {unknown} sale
   * @returns {{ok:true,line?:string}|{ok:false,reason:string}}
   */
  function sellByTalk(player, npc, sale) {
    const asked = /** @type {{all?:unknown,kind?:unknown}} */ (sale ?? {});
    const kind = typeof asked.kind === "string" ? asked.kind : "";
    const all = asked.all === true;
    if (!all && !isSellable(kind)) {
      return { ok: false, reason: "the trader does not buy that" };
    }
    const owed = owedAnswer(player, npc);
    if (owed) return owed;
    const name = all ? "ore" : itemInfo(kind)?.name ?? kind;
    if (!speak(player, `Sell all ${name}`)) {
      return { ok: false, reason: "you are talking too much" };
    }
    const lots = inventoryOf(player).filter((stack) =>
      isSellable(stack.kind) && (all || stack.kind === kind)
    );
    const facts = {
      name,
      count: lots.reduce((sum, lot) => sum + lot.count, 0),
      coins: lots.reduce((sum, lot) => sum + lot.count * priceOf(lot.kind), 0),
    };
    /** @type {SaleResult} */
    const result = lots.length
      ? sellItems(
        world,
        player.id,
        all ? { all: true } : { kind, count: facts.count },
      )
      : { ok: false, reason: "nothing to sell" };
    const outcome = result.ok
      ? all ? "all" : "kind"
      : result.reason === "too many coins"
      ? "full"
      : "nothing";
    queueReply(player, npc, pickReply(SALE_REPLIES[outcome], random)(facts));
    return result.ok ? { ok: true, line: result.line } : { ok: true };
  }

  return {
    /**
     * A player confirms a choice. The host checks the player, the NPC, the
     * range, and that no earlier request of the player's waits for this NPC.
     * A `sale` choice carries the ore to sell.
     * @param {string} playerId @param {unknown} npcId @param {unknown} choiceId @param {unknown} [sale]
     * @returns {{ok:true,line?:string}|{ok:false,reason:string}}
     */
    ask(playerId, npcId, choiceId, sale) {
      const found = parties(playerId, npcId);
      if ("ok" in found) return found;
      const { player, npc } = found;
      if (choiceId === SALE_CHOICE) return sellByTalk(player, npc, sale);
      const choice = typeof choiceId === "string"
        ? traderChoice(choiceId)
        : undefined;
      if (!choice) return { ok: false, reason: "unknown choice" };
      if (choice.replies) {
        const owed = owedAnswer(player, npc);
        if (owed) return owed;
      }
      if (!speak(player, choice.line)) {
        return { ok: false, reason: "you are talking too much" };
      }
      if (choice.replies) {
        queueReply(player, npc, pickReply(choice.replies, random));
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

    /** The ids of the players waiting on an NPC, in answer order. @param {string} npcId */
    waiting(npcId) {
      return (queues.get(npcId) ?? []).map((item) => item.playerId);
    },
  };
}
