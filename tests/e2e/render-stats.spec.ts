import { waitFor } from "./time.ts";
import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { ready } from "./ui.ts";
test("the renderer reports the tiles and quads of every frame", async ({ page }) => {
  await openWorld(page, "/?harness=1&layout=room&sw=0");
  await ready(page);
  await waitFor(page, () =>
    readWorld(page, (world) => {
      const stats = world.renderStats();
      return !!stats && stats.tiles > 0;
    }), { message: "first rendered terrain frame" });
  const stats = await readWorld(page, (__world) => __world.renderStats());
  expect(stats!.tiles).toBeGreaterThan(0);
  expect(stats!.quads).toBeGreaterThanOrEqual(stats!.tiles);
});
