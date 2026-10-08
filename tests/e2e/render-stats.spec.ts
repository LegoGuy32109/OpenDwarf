import { expect, test } from "@playwright/test";
import { ready } from "./ui.ts";

type Stats = { tiles: number; quads: number } | null;
type Harness = { __od: { renderStats(): Stats } };

test("the renderer reports the tiles and quads of every frame", async ({ page }) => {
  await page.goto("/?harness=1&layout=room&sw=0");
  await ready(page);
  await expect.poll(() =>
    page.evaluate(() => (globalThis as unknown as Harness).__od.renderStats())
  ).toMatchObject({
    tiles: expect.any(Number),
    quads: expect.any(Number),
  });
  const stats = await page.evaluate(() =>
    (globalThis as unknown as Harness).__od.renderStats()
  );
  expect(stats!.tiles).toBeGreaterThan(0);
  expect(stats!.quads).toBeGreaterThanOrEqual(stats!.tiles);
});
