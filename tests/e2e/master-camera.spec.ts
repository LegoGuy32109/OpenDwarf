import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { holdUntil } from "./time.ts";
import { ready, say } from "./ui.ts";
const scene = (page: Page) =>
  readWorld(page, (__world) => {
    const s = __world.scene;
    const cxs = [...s.world.chunks.keys()].map((k) => Number(k.split(",")[0]));
    return {
      x: s.camera.x,
      y: s.camera.y,
      zoom: s.zoom,
      chunks: s.world.chunks.size,
      maxCx: Math.max(...cxs),
      minCx: Math.min(...cxs),
    };
  });
test("master view at zoom 0.25 pans with the keyboard and the host generates terrain under the camera", async ({ page }) => {
  await openWorld(page, "/?harness=1&seed=master-camera");
  await ready(page);
  await say(page, "/master");
  await expect.poll(() => readWorld(page, (__world) => __world.scene.viewMode))
    .toBe("master");
  await readWorld(page, (__world) => {
    __world.scene.zoomTarget = 0.25;
  });
  await expect.poll(async () => (await scene(page)).zoom).toBeLessThan(0.26);
  const before = await scene(page);
  await evidenceShot(page, "master-camera-start");
  // Hold L: the camera pans east at the same screen speed as at any zoom
  // (480 screen px/s), until it has passed the old loaded extent and chunks
  // have followed it east.
  await holdUntil(page, "KeyL", async () => {
    const now = await scene(page);
    return now.x - before.x > 2 * 480 / 0.25 * 0.5 &&
      now.maxCx > before.maxCx + 2 && now.chunks > before.chunks;
  });
  const after = await scene(page);
  expect(after.x - before.x).toBeGreaterThan(2 * 480 / 0.25 * 0.5);
  await expect.poll(async () => {
    const now = await scene(page);
    return now.maxCx * 16 * 64 > now.x;
  }).toBe(true);
  await evidenceShot(page, "master-camera-panned");
  // Pan back west past the start: the camera is not pinned to the center.
  await holdUntil(page, "KeyJ", async () => {
    const now = await scene(page);
    return now.x < before.x && now.minCx < before.minCx;
  });
  const west = await scene(page);
  expect(west.x).toBeLessThan(before.x);
  expect(west.minCx).toBeLessThan(before.minCx);
});
