// @ts-check

/**
 * NPC dialogue lives in this file so writers can edit it without changing the
 * conversation rules. Keep each line as a string. Use only these placeholders:
 * `{items}`, `{pieces}`, `{coinsText}`, and `{maxStackCount}`. The game fills
 * them with the real sale outcome. Keep the lower-case starts on replies that
 * follow a player's name and comma.
 */
export const DIALOGUE = Object.freeze({
  traderDescription: "An ore buyer with coin to trade.",
  choices: Object.freeze({
    sell: "I have ore to trade",
    buys: "What do you buy?",
  }),
  buyReplies: Object.freeze([
    "I buy coal, iron, lapis, redstone, gold, emeralds and diamonds.",
    "anything that glitters out of the rock is ore or gems. Never stone.",
    "bring me ore and gems and I pay in coin. Stone and tools I leave.",
  ]),
  saleReplies: Object.freeze({
    kind: Object.freeze([
      "{items}? Here's {coinsText}.",
      "that's {items} for {coinsText}. Fair trade.",
      "I'll take the lot, {items}. {coinsText}, counted out.",
    ]),
    all: Object.freeze([
      "{pieces} of ore? Here's {coinsText}.",
      "that's the lot, {pieces} for {coinsText}.",
      "I'll take all of it, {pieces}. {coinsText} for you.",
    ]),
    nothing: Object.freeze([
      "you have none of that to sell me.",
      "no ore of that sort in your pack. Come back with some.",
      "no ore, no coin. Mine something first.",
    ]),
    full: Object.freeze([
      "I owe you {coinsText}, but you cannot carry more than {maxStackCount} coins.",
      "{coinsText} is more coin than your purse holds. Spend some first.",
      "your purse is full. I cannot pay you {coinsText} until you spend some.",
    ]),
  }),
});
