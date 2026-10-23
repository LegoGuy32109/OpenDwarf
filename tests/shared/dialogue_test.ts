import { assert, assertEquals } from "@std/assert";
import { DIALOGUE } from "../../src/shared/dialogue.js";
import {
  BUY_REPLIES,
  SALE_REPLIES,
} from "../../src/shared/npc-conversation.js";

const KNOWN = new Set(["items", "pieces", "coinsText", "maxStackCount"]);
const SAMPLE = {
  items: "3 diamonds",
  pieces: "3 pieces",
  coinsText: "12 coins",
  maxStackCount: "99",
};

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
      assert(KNOWN.has(key), `unknown placeholder {${key}} in ${line}`);
    }
    const rendered = line.replace(/\{(\w+)\}/g, (_match, key: string) => {
      assert(Object.hasOwn(SAMPLE, key), `no sample for {${key}}`);
      return SAMPLE[key as keyof typeof SAMPLE];
    });
    assert(!/\{\w+\}/.test(rendered), `unrendered placeholder in ${line}`);
  }
  assertEquals(BUY_REPLIES, DIALOGUE.buyReplies);
  for (const reply of Object.values(SALE_REPLIES).flat()) {
    assert(reply({ name: "diamond", count: 3, coins: 12 }).length > 0);
  }
});
