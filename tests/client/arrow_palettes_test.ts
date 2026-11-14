import {
  assertEquals,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { createArrowPaletteLoader } from "../../src/client/arrow-palettes.js";

const gold = {
  outline: "#482B0D",
  shadow: "#5A3C16",
  body: "#F5B630",
  highlight: "#FFE589",
};
const mask = () => ({
  width: 1,
  height: 1,
  data: new Uint8ClampedArray([170, 170, 170, 255]),
});

Deno.test("arrow palettes share mask reads and cache by color values, not palette identity", async () => {
  let reads = 0, files = 0;
  const loader = createArrowPaletteLoader({
    readMask: () => {
      reads++;
      return Promise.resolve(mask());
    },
    readPalette: () => {
      files++;
      return Promise.resolve({ ...gold });
    },
  });
  const [a, b] = await Promise.all([
    loader.load(gold),
    loader.load({ ...gold }),
  ]);
  assertStrictEquals(a, b);
  assertStrictEquals(await loader.load("gold.json"), a);
  assertStrictEquals(await loader.load("gold.json"), a);
  assertEquals([reads, files], [2, 1]);
  assertEquals(Array.from(a.cardinal.data), [245, 182, 48, 255]);
});
Deno.test("palette mutation during PNG loading cannot poison a cached color set", async () => {
  let resolve!: () => void;
  const gate = new Promise<void>((done) => {
    resolve = done;
  });
  const loader = createArrowPaletteLoader({
    readMask: async () => {
      await gate;
      return mask();
    },
  });
  const input = { ...gold };
  const pending = loader.load(input);
  input.body = "#FF0000";
  resolve();
  assertEquals(Array.from((await pending).cardinal.data), [245, 182, 48, 255]);
  assertEquals(Array.from((await loader.load(input)).cardinal.data), [
    255,
    0,
    0,
    255,
  ]);
});
Deno.test("failed PNG or palette fetches can be retried", async () => {
  let fail = true;
  const loader = createArrowPaletteLoader({
    readMask: () => {
      if (fail) return Promise.reject(new Error("mask offline"));
      return Promise.resolve(mask());
    },
    readPalette: () => {
      if (fail) return Promise.reject(new Error("palette offline"));
      return Promise.resolve(gold);
    },
  });
  await assertRejects(() => loader.load(gold));
  await assertRejects(() => loader.load("gold.json"));
  fail = false;
  assertEquals(Array.from((await loader.load("gold.json")).diagonal.data), [
    245,
    182,
    48,
    255,
  ]);
});
Deno.test("palette eviction and explicit clearing retain the shared source masks", async () => {
  let reads = 0;
  const loader = createArrowPaletteLoader({
    maxPalettes: 1,
    readMask: () => {
      reads++;
      return Promise.resolve(mask());
    },
  });
  const first = await loader.load(gold);
  await loader.load({ ...gold, body: "#FF0000" });
  assertNotStrictEquals(first, await loader.load(gold));
  loader.clear();
  assertNotStrictEquals(first, await loader.load(gold));
  assertEquals(reads, 2);
});
