import { assert, assertEquals } from "@std/assert";
import { createAuthoredWorld } from "../../src/shared/authored-terrain.js";
import { readTile } from "../../src/shared/terrain.js";
import {
  createVisibility,
  recomputeVisibility,
} from "../../src/shared/visibility.js";
import {
  ceilingMask,
  elevationMask,
  surfaceAt,
  surfaceGrid,
} from "../../src/shared/surface.js";

const world = createAuthoredWorld();
const empty = createVisibility();
const seeing = createVisibility();
recomputeVisibility(world, seeing, { x: 7, y: 8, z: 0 });

Deno.test("surfaceAt reports the material of the surface tile", () => {
  const surface = surfaceAt(world, 2, 13, 5, "master", empty);
  assert(surface);
  assertEquals(surface.material, readTile(world, 2, 13, surface.z));
});

Deno.test("surfaceGrid matches surfaceAt inside and outside its rectangle", () => {
  for (
    const [mode, visibility] of [["master", empty], ["entity", seeing]] as const
  ) {
    for (const viewZ of [0, 3, 5]) {
      const lookup = surfaceGrid(world, -2, 3, 14, 12, viewZ, mode, visibility);
      for (let y = 0; y < 20; y++) {
        for (let x = -4; x < 20; x++) {
          assertEquals(
            lookup(x, y),
            surfaceAt(world, x, y, viewZ, mode, visibility),
            `${mode} z${viewZ} ${x},${y}`,
          );
        }
      }
    }
  }
});

Deno.test("masks give equal results with and without a lookup", () => {
  let nonzero = 0;
  for (
    const [mode, visibility] of [["master", empty], ["entity", seeing]] as const
  ) {
    for (const viewZ of [0, 1, 3]) {
      const lookup = surfaceGrid(
        world,
        -1,
        -1,
        20,
        20,
        viewZ,
        mode,
        visibility,
      );
      for (let y = -1; y < 17; y++) {
        for (let x = -1; x < 17; x++) {
          const elevation = elevationMask(world, x, y, viewZ, mode, visibility);
          const ceiling = ceilingMask(world, x, y, viewZ, mode, visibility);
          assertEquals(
            elevationMask(world, x, y, viewZ, mode, visibility, lookup),
            elevation,
          );
          assertEquals(
            ceilingMask(world, x, y, viewZ, mode, visibility, lookup),
            ceiling,
          );
          if (elevation || ceiling) nonzero++;
        }
      }
    }
  }
  assert(nonzero > 0, "the fixture exercises at least one mask");
});
