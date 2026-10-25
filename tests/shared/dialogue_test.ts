import { assert, assertEquals } from "@std/assert";
import { DIALOGUE } from "../../src/shared/dialogue.js";
import {
  BUY_REPLIES,
  SALE_REPLIES,
} from "../../src/shared/npc-conversation.js";

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(strings);
  }
  return [];
}

Deno.test("dialogue placeholders are known and every authored line renders", () => {
  const lines = strings(DIALOGUE);
  assert(lines.length > 0);
  for (const line of lines) {
    for (const [, key] of line.matchAll(/\{(\w+)\}/g)) {
      assert(
        ["items", "pieces", "coinsText", "maxStackCount"].includes(key),
        `unknown placeholder {${key}} in ${line}`,
      );
    }
  }
  assertEquals(BUY_REPLIES, DIALOGUE.buyReplies);
  const facts = { name: "diamond", count: 3, coins: 12 };
  const expectedValues = {
    kind: ["12 coins"],
    all: ["12 coins"],
    nothing: [],
    full: ["12 coins"],
  };
  for (const [kind, replies] of Object.entries(SALE_REPLIES)) {
    for (const reply of replies) {
      const rendered = reply(facts);
      assert(rendered.length > 0);
      assert(!/\{\w+\}|undefined/.test(rendered), rendered);
      for (const value of expectedValues[kind as keyof typeof SALE_REPLIES]) {
        assert(
          rendered.includes(value),
          `${kind} reply omitted ${value}: ${rendered}`,
        );
      }
    }
  }
  assert(SALE_REPLIES.kind[0](facts).includes("3 diamonds"));
  assert(SALE_REPLIES.all[0](facts).includes("3 pieces"));
  assert(SALE_REPLIES.full[0](facts).includes("99"));
});
