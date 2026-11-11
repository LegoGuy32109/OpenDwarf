import { expect, test } from "./fixtures.ts";
import { openWorld, readWorld } from "./world.ts";
import { ready } from "./ui.ts";
import { waitFrames, waitTicks } from "./time.ts";
import { evidenceShot } from "./evidence.ts";

test("actual spawn keeps authored paving while natural caves use the stone palette", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openWorld(page, "/?harness=1&layout=room", { npc: true });
  await ready(page);
  await evidenceShot(page, "140-actual-spawn-room");
  const floorClip = { x: 520, y: 300, width: 32, height: 32 };
  const dynamicRoom = await page.screenshot({ clip: floorClip });
  await readWorld(page, (api) => {
    api.scene.viewMode = "master";
  });
  await waitFrames(page, 3);
  expect(await page.screenshot({ clip: floorClip }), "room paving cache parity")
    .toEqual(dynamicRoom);
  await readWorld(page, (api) => {
    api.scene.viewMode = "entity";
  });

  // Teleport into an actual generated cave, without painting a terrain fixture.
  // Search a negative-coordinate region away from every authored overlay.
  const at = await readWorld(page, async (api) => {
    const { ensureChunk, readTile, OPEN } = await import(
      "../../src/shared/terrain.js"
    );
    const { terrainFrame } = await import("../../src/shared/surface.js");
    const world = api.scene.world;
    for (let cy = -8; cy < -2; cy++) {
      for (let cx = -8; cx < -2; cx++) ensureChunk(world, cx, cy);
    }
    for (let y = -112; y < -48; y++) {
      for (let x = -112; x < -48; x++) {
        if (readTile(world, x, y, 1) !== OPEN) continue;
        const frames = new Set<number>();
        let open = 0;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -4; dx <= 4; dx++) {
            frames.add(terrainFrame(x + dx, y + dy, 1));
            if (readTile(world, x + dx, y + dy, 1) === OPEN) open++;
          }
        }
        if (frames.size < 3 || open < 28) continue;
        api.edit({ players: [{ id: api.scene.localId, at: { x, y, z: 1 } }] });
        return { x, y };
      }
    }
    throw new Error(
      "a generated cave with varied natural patches was not found",
    );
  });
  await waitTicks(page, 3);
  await evidenceShot(page, "140-actual-natural-cave");
  const palette = await readWorld(page, async (api, at) => {
    const { surfaceAt, terrainUv, TERRAIN_FRAMES } = await import(
      "../../src/shared/surface.js"
    );
    const frames: number[] = [];
    for (let y = at.y - 4; y <= at.y + 4; y++) {
      for (let x = at.x - 5; x <= at.x + 5; x++) {
        const tile = surfaceAt(
          api.scene.world,
          x,
          y,
          1,
          "master",
          api.scene.visibility,
        )!;
        frames.push(Math.round(terrainUv(tile, x, y)[1] * TERRAIN_FRAMES));
      }
    }
    return [...new Set(frames)];
  }, at);
  expect(palette.every((frame) => frame >= 0 && frame < 4)).toBe(true);
  expect(palette).toContain(0);
  expect(palette.length).toBeGreaterThanOrEqual(3);
  await readWorld(page, (api) => {
    api.scene.viewMode = "master";
    api.scene.zoom = api.scene.zoomTarget = 0.5;
  });
  await waitFrames(page, 3);
  await evidenceShot(page, "140-natural-cave-overview");
  expect(errors).toEqual([]);
});
