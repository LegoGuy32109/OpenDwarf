// Draw the item sprite sheet `public/assets/items.png`.
//
// deno run --allow-run --allow-read --allow-write scripts/make-item-sheet.ts
//
// The sheet is one column of 16×16 frames, in the order of `ITEM_KINDS` in
// src/shared/items.js: stone, coal, iron ore, gold ore, lapis, redstone,
// diamond, emerald, coin, pickaxe. Stone and the ore items come from the
// Excalibur resource pack in art/excalibur/item/ (see the README's credits);
// the coin is drawn here. The pickaxe is cut from the first dwarf
// mining frame on `main` (Assets/CreatureSprites/Dwarf/MineFrames/DwarfMine1.png):
// only its gray head and brown handle pixels stay. Needs ImageMagick (`magick`).

import { ITEM_KINDS } from "../src/shared/items.js";

const SIZE = 16;
const FRAMES = ITEM_KINDS.length;
/** RGBA pixels of the whole sheet. */
const sheet = new Uint8Array(SIZE * SIZE * FRAMES * 4);

type Rgb = [number, number, number];
const hex = (value: string): Rgb => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];

function put(frame: number, x: number, y: number, [r, g, b]: Rgb) {
  const at = ((frame * SIZE + y) * SIZE + x) * 4;
  sheet.set([r, g, b, 255], at);
}

const frameOf = (kind: string) =>
  ITEM_KINDS.find((info) => info.kind === kind)!.frame;

/**
 * Excalibur item textures for each item kind. `stone_block.png` is a 16×16
 * isometric cube rendered from Excalibur's stone block, shaded and outlined.
 */
const EXCALIBUR_ITEMS: Record<string, string> = {
  "stone": "stone_block.png",
  "coal": "coal.png",
  "iron ore": "raw_iron.png",
  "gold ore": "raw_gold.png",
  "lapis": "lapis_lazuli.png",
  "redstone": "redstone.png",
  "diamond": "diamond.png",
  "emerald": "emerald.png",
};
for (const [kind, file] of Object.entries(EXCALIBUR_ITEMS)) {
  const read = await new Deno.Command("magick", {
    args: [`art/excalibur/item/${file}`, "-depth", "8", "rgba:-"],
    stdout: "piped",
  }).output();
  if (!read.success) throw new Error(`magick failed on ${file}`);
  sheet.set(read.stdout, frameOf(kind) * SIZE * SIZE * 4);
}

// A coin: a gold disc with a darker rim and a highlight.
{
  const frame = frameOf("coin");
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const distance = Math.hypot(x - 7.5, y - 7.5);
      if (distance <= 5.5) put(frame, x, y, hex("#7a4e10"));
      if (distance <= 4.6) put(frame, x, y, hex("#f2c230"));
      if (distance <= 3 && x + y < 14) put(frame, x, y, hex("#ffe27a"));
    }
  }
}

// The pickaxe: crop the first mining frame, keep the head and handle colors.
{
  const frame = frameOf("pickaxe");
  const source = "Assets/CreatureSprites/Dwarf/MineFrames/DwarfMine1.png";
  const shown = await new Deno.Command("git", {
    args: ["show", `main:${source}`],
    stdout: "piped",
  }).output();
  const crop = await new Deno.Command("magick", {
    args: [
      "png:-",
      "-crop",
      "16x16+0+1",
      "+repage",
      "-background",
      "none",
      "-extent",
      "16x16",
      "-depth",
      "8",
      "rgba:-",
    ],
    stdin: "piped",
    stdout: "piped",
  }).spawn();
  const writer = crop.stdin.getWriter();
  await writer.write(shown.stdout);
  await writer.close();
  const pixels = new Uint8Array((await crop.output()).stdout);
  const keep = new Set(["595652", "b6a59e", "8f563b", "a96a4c"]);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const [r, g, b, a] = pixels.subarray(i * 4, i * 4 + 4);
    const color = [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join(
      "",
    );
    if (a === 255 && keep.has(color)) {
      put(frame, i % SIZE, Math.floor(i / SIZE), [r, g, b]);
    }
  }
}

const encode = await new Deno.Command("magick", {
  args: [
    "-size",
    `${SIZE}x${SIZE * FRAMES}`,
    "-depth",
    "8",
    "rgba:-",
    "public/assets/items.png",
  ],
  stdin: "piped",
}).spawn();
const writer = encode.stdin.getWriter();
await writer.write(sheet);
await writer.close();
const status = await encode.status;
if (!status.success) throw new Error("magick failed");
console.log(`Wrote public/assets/items.png (${FRAMES} frames)`);
