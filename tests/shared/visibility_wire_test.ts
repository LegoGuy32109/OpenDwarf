import { assertEquals, assertThrows } from "@std/assert";
import {
  packVisibility,
  unpackVisibility,
} from "../../src/shared/visibility-wire.js";
import { createVisibility, tileKey } from "../../src/shared/visibility.js";

Deno.test("visibility masks preserve visible and remembered boundary tiles", () => {
  const original = createVisibility();
  original.visible.add(tileKey(-1, -1, -1));
  original.visible.add(tileKey(16, 16, 8));
  original.memory.add(tileKey(7, 8, 0));
  original.sample = tileKey(7, 7, 0);

  const packed = packVisibility(original);
  assertEquals(packed.encoding, "bitset-v1");
  assertEquals(packed.visible.length, 540);
  assertEquals(packed.memory.length, 540);
  const restored = unpackVisibility(packed);
  assertEquals(restored, original);

  original.visible.add(tileKey(17, 0, 0));
  assertThrows(() => packVisibility(original), RangeError);
});

Deno.test("expanded view bit mask reaches all four authored chunks", () => {
  const original = createVisibility();
  original.visible.add(tileKey(31, 31, 7));
  original.memory.add(tileKey(32, 32, 8));
  original.sample = tileKey(20, 20, 0);
  const packed = packVisibility(original, 32);
  assertEquals(packed.edge, 32);
  assertEquals(unpackVisibility(packed), original);
});
