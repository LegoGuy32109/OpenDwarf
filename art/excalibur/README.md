# Excalibur source art

Block and item textures come from [Excalibur by Matt Dillow (Maffhew)](https://www.curseforge.com/minecraft/texture-packs/excalibur),
licensed [CC BY-NC-ND 3.0](http://creativecommons.org/licenses/by-nc-nd/3.0/us/).

The ten stone-family block PNGs added for portrait presentation are unchanged
copies from the locally available official Excalibur V1.21.10 pack at
`/home/josh/Projects/assets/tilesheets/Excalibur_V1.21.10/assets/minecraft/textures/block/`.
`stone`, `andesite`, `diorite`, `granite`, `tuff`, and `cobbled_deepslate` supply
wall faces. `smooth_stone` and the polished andesite, diorite, and granite
textures supply supporting floors. They are visual variants of existing stone,
with no new material rules.

`deno run --allow-run --allow-read --allow-write scripts/make-terrain-sheet.ts`
assembles the unchanged tiles into `public/assets/terrain.png` with Aseprite
batch mode. It does not edit `dwarf.png` or replace the legacy floor atlas.
