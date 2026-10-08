import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { ready, say } from "./ui.ts";

type Harness = {
  __od: {
    scene: {
      viewMode: string;
      zoom: number;
      zoomTarget: number;
      camera: { x: number; y: number };
      world: { chunks: Map<string, Uint8Array> };
    };
  };
};

const scene = (page: Page) =>
  page.evaluate(() => {
    const s = (globalThis as unknown as Harness).__od.scene;
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
  await page.goto("/?harness=1&seed=master-camera");
  await ready(page);
  await say(page, "/master");
  await expect.poll(() =>
    page.evaluate(() => (globalThis as unknown as Harness).__od.scene.viewMode)
  ).toBe("master");
  await page.evaluate(() => {
    (globalThis as unknown as Harness).__od.scene.zoomTarget = 0.25;
  });
  await expect.poll(async () => (await scene(page)).zoom).toBeLessThan(0.26);
  const before = await scene(page);
  await evidenceShot(page, "master-camera-start");
  // Hold L: the camera pans east at the same screen speed as at any zoom.
  await page.keyboard.down("KeyL");
  await page.waitForTimeout(2500);
  await page.keyboard.up("KeyL");
  const after = await scene(page);
  // 0.48 px/ms is 480 screen px/s at any zoom, so 2.5 s is well over 2 s of it.
  expect(after.x - before.x).toBeGreaterThan(2 * 480 / 0.25 * 0.5);
  // The camera passed the old loaded extent, and chunks followed it east.
  expect(after.maxCx).toBeGreaterThan(before.maxCx + 2);
  expect(after.chunks).toBeGreaterThan(before.chunks);
  await expect.poll(async () => {
    const now = await scene(page);
    return now.maxCx * 16 * 64 > now.x;
  }).toBe(true);
  await evidenceShot(page, "master-camera-panned");
  // Pan back west past the start: the camera is not pinned to the center.
  await page.keyboard.down("KeyJ");
  await page.waitForTimeout(3000);
  await page.keyboard.up("KeyJ");
  const west = await scene(page);
  expect(west.x).toBeLessThan(before.x);
  expect(west.minCx).toBeLessThan(before.minCx);
});
