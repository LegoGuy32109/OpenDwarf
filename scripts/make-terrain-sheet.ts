// Assemble unchanged Excalibur block PNGs with Aseprite batch mode.
// deno run --allow-run --allow-read --allow-write scripts/make-terrain-sheet.ts
import { TERRAIN_TEXTURES } from "../src/shared/surface.js";
const result = await new Deno.Command("aseprite", {
  args: [
    "-b",
    ...TERRAIN_TEXTURES.map((name) => `art/excalibur/block/${name}.png`),
    "--sheet-type",
    "vertical",
    "--sheet",
    "public/assets/terrain.png",
  ],
}).output();
if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
