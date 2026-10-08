import { createAuthoredWorld } from "../../src/shared/authored-terrain.js";
import { assert, assertEquals } from "@std/assert";
import {
  addPlayer,
  advanceTicks,
  isSolid,
  startMove,
} from "../../src/shared/world.js";
import {
  createVisibility,
  entityOpacity,
  hasLineOfSight,
  recomputeVisibility,
  tileVisibility,
} from "../../src/shared/visibility.js";
import {
  clampCameraAxis,
  DEPTH_TINTS,
  MASTER_PAN_SPEED,
  masterPanStep,
  masterViewTiles,
  playerOccluded,
  surfaceAt,
} from "../../src/shared/surface.js";

Deno.test("one authored chunk has eight reachable levels and solid unknown XY", () => {
  const world = createAuthoredWorld();
  assert(isSolid(world, -1, 7, 0));
  assert(isSolid(world, 16, 7, 7));
  assert(isSolid(world, 7, 7, -1));
  assertEquals(isSolid(world, 7, 7, 8), false);
  const player = addPlayer(world, "self", { x: 1, y: 13, z: 0 });
  for (let x = 2; x <= 9; x++) {
    const result = startMove(world, "self", 1, 0, x);
    assertEquals(result.ok, true);
    advanceTicks(world, 20);
    assertEquals(player.x, x);
    assertEquals(player.z, Math.min(x - 1, 7));
  }
  for (let x = 8; x >= 1; x--) {
    assertEquals(startMove(world, "self", -1, 0, 20 + x).ok, true);
    advanceTicks(world, 20);
    assertEquals(player.x, x);
    assertEquals(player.z, Math.max(0, x - 1));
  }
  assertEquals(startMove(world, "self", -1, 0, 50).ok, true);
  advanceTicks(world, 20);
  assertEquals(startMove(world, "self", -1, 0, 51).ok, false);
});

Deno.test("expanded authored area has four fixed chunks and solid outer stone", () => {
  const world = createAuthoredWorld(32);
  assertEquals([...world.chunks.keys()], ["0,0", "1,0", "0,1", "1,1"]);
  assertEquals(isSolid(world, 20, 7, 0), false);
  assertEquals(isSolid(world, 20, 20, 0), false);
  assertEquals(isSolid(world, 23, 23, 0), true);
  assertEquals(isSolid(world, 32, 20, 0), true);
  assertEquals(clampCameraAxis(3000, 400, 1, 32), 2184);
});

Deno.test("pillar blocks a ray, terrain is remembered, entities fade", () => {
  const world = createAuthoredWorld();
  assertEquals(
    hasLineOfSight(world, { x: 7, y: 8, z: 0 }, { x: 9, y: 8, z: 0 }),
    false,
  );
  const visibility = createVisibility();
  recomputeVisibility(world, visibility, { x: 7, y: 8, z: 0 });
  assertEquals(tileVisibility(visibility, 6, 8, 0), "visible");
  recomputeVisibility(world, visibility, { x: 9, y: 8, z: 0 });
  assertEquals(tileVisibility(visibility, 6, 8, 0), "remembered");
  const player = addPlayer(world, "other", { x: 7, y: 7, z: 0 });
  assertEquals(startMove(world, "other", 1, 0, 1).ok, true);
  const seen = (x: number) => x === 7;
  assertEquals(entityOpacity(player, 0, seen), 1);
  assertEquals(entityOpacity(player, 2.5, seen), 1);
  assertEquals(entityOpacity(player, 5, seen), 0.5);
  assertEquals(entityOpacity(player, 7.5, seen), 0);
});

Deno.test("lower floors turn blue then disappear beyond five levels", () => {
  const world = createAuthoredWorld();
  const visibility = createVisibility();
  assertEquals(surfaceAt(world, 2, 13, 5, "master", visibility)?.depth, 5);
  assertEquals(surfaceAt(world, 2, 13, 6, "master", visibility), null);
  assertEquals(DEPTH_TINTS[5], [0.2, 0.2, 0.4]);
  const player = addPlayer(world, "self", { x: 8, y: 7, z: 0 });
  assertEquals(playerOccluded(world, player, 1), false);
  player.x = 8;
  player.y = 8;
  assertEquals(playerOccluded(world, player, 1), true);
});

Deno.test("camera keeps a full chunk row or column in view", () => {
  assertEquals(clampCameraAxis(-1000, 400, 1), -136);
  assertEquals(clampCameraAxis(2000, 400, 1), 1160);
});

Deno.test("camera pans past terrain narrower than the view, keeping one column on screen", () => {
  // A 1024 px extent under a 1200 px view: the camera is no longer pinned.
  const left = clampCameraAxis(-5000, 1200, 1, 16, 0);
  const right = clampCameraAxis(5000, 1200, 1, 16, 0);
  assertEquals([left, right], [-536, 1560]);
  assertEquals(clampCameraAxis(100, 1200, 1, 16, 0), 100);
  // At the limits the view still shows one 64 px column of terrain.
  assertEquals(left + 600, 64);
  assertEquals(right - 600, 1024 - 64);
  // Zoomed out to 0.25, the 4x4 chunk start (4096 px) under a 1920 px view.
  assertEquals(clampCameraAxis(-99999, 1920, 0.25, 64, 0) < 0, true);
  assertEquals(clampCameraAxis(99999, 1920, 0.25, 64, 0) > 4096, true);
});

Deno.test("master pan speed on screen is the same at every zoom", () => {
  assertEquals(masterPanStep(1, 100, 1), 100 * MASTER_PAN_SPEED);
  for (const zoom of [0.25, 0.5, 1, 2]) {
    const screen = masterPanStep(1, 1000, zoom) * zoom;
    assertEquals(Math.abs(screen - 1000 * MASTER_PAN_SPEED) < 1e-9, true);
  }
  assertEquals(masterPanStep(-1, 100, 0.25), -4 * 100 * MASTER_PAN_SPEED);
});

Deno.test("master view tiles are the rectangle the camera looks at", () => {
  assertEquals(masterViewTiles({ x: 640, y: 320 }, 1280, 640, 0.5), {
    minX: -10,
    minY: -5,
    maxX: 30,
    maxY: 15,
  });
});
