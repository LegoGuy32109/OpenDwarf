# Excalibur source art

Block and item textures come from [Excalibur by Matt Dillow (Maffhew)](https://www.curseforge.com/minecraft/texture-packs/excalibur),
licensed [CC BY-NC-ND 3.0](http://creativecommons.org/licenses/by-nc-nd/3.0/us/).

The source PNGs are unchanged copies from the locally available official
Excalibur V1.21.10 pack at
`/home/josh/Projects/assets/tilesheets/Excalibur_V1.21.10/assets/minecraft/textures/block/`.

## Palette after preview correction 140

Natural walls and supporting floors use only `stone`, `andesite`, `diorite`, and
`granite`. Plain stone occupies roughly 75% of broad sampled terrain. Two fixed
coordinate-noise fields select coherent accent patches; their thresholds are
calibrated against observed coverage, rather than treating smooth noise as a
uniform distribution. These are visual variants of stone with unchanged mining
times and drops. Ores retain their own atlas, identity, mining times and drops.

The authored spawn interior alone keeps the preview's existing paving: the
unchanged `smooth_stone`, `polished_andesite`, `polished_diorite`, and
`polished_granite` source tiles, with exactly the previous four-way patch
selection. Inspection of the actual room render and enlarged source tiles
confirmed both square paving and offset brickwork in this treatment. The pack's
polished filenames describe this authored art; they are excluded from the
natural palette. `stone_bricks.png` was inspected as a comparison, but importing
it would replace the floor Josh asked to keep.

The room recipe opts into `floorStyle: "spawn-room"`. Rendering applies it only
to supporting floors within X=12–20, Y=12–18. Room walls, placed walls, doorway,
tunnels, caves, and other recipes use the natural palette. The old tuff and
cobbled-deepslate source copies remain available as historical source art but
are absent from the runtime atlas and natural selection.

`deno run --allow-run --allow-read --allow-write scripts/make-terrain-sheet.ts`
assembles the eight unchanged tiles into `public/assets/terrain.png` with
Aseprite batch mode. It does not open the Aseprite UI, edit `dwarf.png`, or replace
the legacy floor atlas. `TERRAIN_TEXTURES` specifies the atlas order;
`NATURAL_TERRAIN_TEXTURES` specifies the four permitted natural variants.
