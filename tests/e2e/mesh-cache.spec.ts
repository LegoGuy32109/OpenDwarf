import { setTile as writeTile } from "./world.ts";
import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { waitFrames } from "./time.ts";
import { ready, say } from "./ui.ts";
const OPEN = 1;
const STONE = 2;
async function openMasterView(page: Page) {
  await openWorld(page, "/?harness=1&seed=snapshot");
  await ready(page);
  await say(page, "/master");
  await expect.poll(() => readWorld(page, (__world) => __world.scene.viewMode))
    .toBe("master");
}
/** A stone tile at the view level, far from the player, and the screen square around it. */
async function aimAtStone(page: Page) {
  return await readWorld(page, (__world) => {
    const terrain = __world.materials;
    const scene = __world.scene;
    const player = scene.world.players[scene.localId];
    scene.zoomTarget = scene.zoom = 0.5;
    const z = scene.viewZ;
    const world = scene.world;
    for (let y = 2; y < 30; y++) {
      for (let x = 2; x < 30; x++) {
        if (Math.hypot(x - player.x, y - player.y) < 8) {
          continue;
        }
        const around = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]];
        if (
          around.every(([dx, dy]) =>
            terrain.readTile(world, x + dx, y + dy, z) === 2 &&
            terrain.readTile(world, x + dx, y + dy, z - 1) === 2
          )
        ) {
          scene.camera.x = (x + 0.5) * 64;
          scene.camera.y = (y + 0.5) * 64;
          return { x, y, z };
        }
      }
    }
    return null;
  });
}
const picture = async (page: Page) => {
  // Wait for a frame that has drawn the latest world.
  await waitFrames(page, 2);
  const size = page.viewportSize()!;
  return await page.screenshot({
    clip: {
      x: size.width / 2 - 48,
      y: size.height / 2 - 48,
      width: 96,
      height: 96,
    },
  });
};
test("master view redraws a mined tile, a placed tile and a level change on the next frame", async ({ page }) => {
  await openMasterView(page);
  const tile = await aimAtStone(page);
  expect(tile, "a stone tile far from the player").not.toBeNull();
  const { x, y, z } = tile!;
  // The cache has drawn the area for a few frames before anything changes.
  const original = await picture(page);
  expect(await picture(page)).toEqual(original);
  await evidenceShot(page, "mesh-cache-before-mining");
  await writeTile(page, x, y, z, OPEN);
  const mined = await picture(page);
  expect(mined).not.toEqual(original);
  await evidenceShot(page, "mesh-cache-after-mining");
  await writeTile(page, x, y, z, STONE);
  expect(await picture(page)).toEqual(original);
  await page.keyboard.press("r");
  await expect.poll(() => readWorld(page, (__world) => __world.scene.viewZ))
    .toBe(z + 1);
  const above = await picture(page);
  expect(above).not.toEqual(original);
  await page.keyboard.press("v");
  await expect.poll(() => readWorld(page, (__world) => __world.scene.viewZ))
    .toBe(z);
  expect(await picture(page)).toEqual(original);
});
