// Build the item sprite sheet `public/assets/items.png` and the breaking
// decal sheet `public/assets/cracks.png`.
//
// deno run --allow-run --allow-read --allow-write scripts/make-item-sheet.ts
//
// The sheet is one column of 16×16 frames, in the order of `ITEM_KINDS` in
// src/shared/items.js: stone, coal, iron ore, gold ore, lapis, redstone,
// diamond, emerald, coin, pickaxe. Every frame comes from the Excalibur
// resource pack in art/excalibur/item/ (see the README's credits); the coin is
// the emerald with its hue turned to gold. The decal sheet is one column of
// Excalibur's ten destroy stages, art/excalibur/block/destroy_stage_0-9.png.
// Needs ImageMagick (`magick`).

import { ITEM_KINDS } from "../src/shared/items.js";

const SIZE = 16;
const FRAMES = ITEM_KINDS.length;
/** RGBA pixels of the whole sheet. */
const sheet = new Uint8Array(SIZE * SIZE * FRAMES * 4);

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
  "pickaxe": "stone_pickaxe.png",
};
/** Paste an art file into a kind's frame; `extra` are magick options applied to it. */
async function paste(kind: string, file: string, extra: string[] = []) {
  const read = await new Deno.Command("magick", {
    args: [`art/excalibur/item/${file}`, ...extra, "-depth", "8", "rgba:-"],
    stdout: "piped",
  }).output();
  if (!read.success) throw new Error(`magick failed on ${file}`);
  sheet.set(read.stdout, frameOf(kind) * SIZE * SIZE * 4);
}
for (const [kind, file] of Object.entries(EXCALIBUR_ITEMS)) {
  await paste(kind, file);
}
// The coin for now: the emerald, its hue turned to gold.
await paste("coin", "emerald.png", ["-modulate", "115,120,50"]);

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

const stages = Array.from(
  { length: 10 },
  (_, n) => `art/excalibur/block/destroy_stage_${n}.png`,
);
const cracks = await new Deno.Command("magick", {
  args: [
    ...stages,
    "-background",
    "none",
    "-append",
    "+repage",
    "PNG32:public/assets/cracks.png",
  ],
}).output();
if (!cracks.success) throw new Error("magick failed on the destroy stages");
console.log("Wrote public/assets/cracks.png (10 frames)");
