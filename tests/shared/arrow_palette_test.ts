import { assertEquals, assertThrows } from "@std/assert";
import {
  encodeArrowMask,
  parseArrowPalette,
  recolorArrowMask,
} from "../../src/shared/arrow-palette.js";

const palette = {
  outline: "#102030",
  shadow: "#405060",
  body: "#708090",
  highlight: "#A0B0C0",
};
const mask = {
  width: 5,
  height: 1,
  data: new Uint8ClampedArray([
    0,
    0,
    0,
    255,
    85,
    85,
    85,
    255,
    170,
    170,
    170,
    255,
    255,
    255,
    255,
    255,
    79,
    32,
    8,
    0,
  ]),
};

Deno.test("arrow mask roles recolor exactly and transparent pixels remain transparent", () => {
  const before = mask.data.slice();
  const result = recolorArrowMask(mask, palette);
  assertEquals(Array.from(result.data), [
    16,
    32,
    48,
    255,
    64,
    80,
    96,
    255,
    112,
    128,
    144,
    255,
    160,
    176,
    192,
    255,
    0,
    0,
    0,
    0,
  ]);
  assertEquals(mask.data, before);
  assertEquals(
    encodeArrowMask(result, palette).data,
    new Uint8ClampedArray([...mask.data.slice(0, 16), 0, 0, 0, 0]),
  );
});
Deno.test("arrow palettes permit any colors and combine palette alpha with mask coverage", () => {
  const result = recolorArrowMask({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([170, 170, 170, 128]),
  }, { ...palette, body: "#12ABEF80" });
  assertEquals(Array.from(result.data), [18, 171, 239, 64]);
  assertEquals(parseArrowPalette({ ...palette, body: "#ffffff00" })[2], [
    255,
    255,
    255,
    0,
  ]);
});
Deno.test("arrow mask export refuses unmapped art colors and ambiguous source roles", () => {
  assertThrows(
    () =>
      encodeArrowMask({
        width: 1,
        height: 1,
        data: new Uint8ClampedArray([1, 2, 3, 255]),
      }, palette),
    RangeError,
  );
  assertThrows(
    () => encodeArrowMask(mask, { ...palette, shadow: palette.outline }),
    TypeError,
  );
});
Deno.test("invalid palette colors and corrupted mask shades fail explicitly", () => {
  for (
    const bad of [null, [], {}, { ...palette, body: "red" }, {
      ...palette,
      body: "#12345z",
    }]
  ) assertThrows(() => parseArrowPalette(bad), TypeError);
  for (const data of [[86, 86, 86, 255], [85, 84, 85, 255]]) {
    assertThrows(() =>
      recolorArrowMask({
        width: 1,
        height: 1,
        data: new Uint8ClampedArray(data),
      }, palette), RangeError);
  }
  assertThrows(
    () =>
      recolorArrowMask(
        { width: 2, height: 1, data: new Uint8ClampedArray(4) },
        palette,
      ),
    RangeError,
  );
});
