import { assertEquals, assertThrows } from "@std/assert";
import {
  packVisibility,
  unpackVisibility,
} from "../../src/shared/visibility-wire.js";
import { createVisibility, tileKey } from "../../src/shared/visibility.js";

Deno.test("visibility masks preserve visible boundary tiles", () => {
  const original = createVisibility();
  original.visible.add(tileKey(-1, -1, -1));
  original.visible.add(tileKey(16, 16, 8));
  original.sample = tileKey(7, 7, 0);

  const packed = packVisibility(original);
  assertEquals(packed.encoding, "bitset-v2");
  // One mask per chunk that holds a tile: chunks -1,-1 and 1,1 for the corners.
  assertEquals(Object.keys(packed.visible).sort(), ["-1,-1", "1,1"]);
  // Remembered tiles do not travel; the guest derives them from its terrain.
  assertEquals("memory" in packed, false);
  const restored = unpackVisibility(packed);
  assertEquals(restored, { ...original, fromTerrain: true });

  original.visible.add(tileKey(17, 0, 10));
  assertThrows(() => packVisibility(original), RangeError);
});

Deno.test("expanded view bit mask reaches all four authored chunks", () => {
  const original = createVisibility();
  original.visible.add(tileKey(31, 31, 7));
  original.sample = tileKey(20, 20, 0);
  const packed = packVisibility(original);
  assertEquals(unpackVisibility(packed), { ...original, fromTerrain: true });
});

Deno.test("visibility masks keep tiles across negative chunk borders", () => {
  const original = createVisibility();
  for (const [x, y] of [[-1, -1], [-16, -17], [-17, 0], [15, -1], [16, 16]]) {
    original.visible.add(tileKey(x, y, 3));
  }
  const restored = unpackVisibility(packVisibility(original));
  assertEquals(restored, { ...original, fromTerrain: true });
});

Deno.test("visibility masks reject malformed chunk keys and sizes", () => {
  const packed = packVisibility(createVisibility());
  for (
    const visible of [{ "0,0": "AA==" }, { "-0,0": "" }, { x: "" }] as Record<
      string,
      string
    >[]
  ) {
    assertThrows(() =>
      unpackVisibility({ ...packed, visible } as typeof packed)
    );
  }
});
