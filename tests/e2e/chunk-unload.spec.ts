import { openWorld, placePlayer, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { ready, uiState } from "./ui.ts";
const loaded = (page: Page) =>
  readWorld(page, (__world) => __world.scene.world.chunks.size);
const bytes = (page: Page, key: string) =>
  readWorld(page, (__world, key) =>
    [
      ...(__world.scene.world.chunks.get(key) ?? []),
    ].join(), key);
const hasChunk = (page: Page, key: string) =>
  readWorld(page, (__world, key) => __world.scene.world.chunks.has(key), key);
/** Wait until the F3 panel, which refreshes once a second, shows the loaded chunk count. */
const panelShowsChunks = async (page: Page) => {
  await expect.poll(async () =>
    (await uiState(page)).diagnostics.includes(`Chunks ${await loaded(page)} `)
  ).toBe(true);
};
/** Place the host's own player on a tile, as if it had walked there. */
const placeHost = (page: Page, x: number, y: number) => placePlayer(page, x, y);
/** Dig a tunnel along x at level 0 through chunk 5,5 with the host's own write path. */
const digTunnel = (page: Page) =>
  readWorld(
    page,
    (world) =>
      world.edit({
        tiles: [{
          bounds: { minX: 83, maxX: 92, minY: 88, maxY: 88, minZ: 0, maxZ: 0 },
          material: world.materials.OPEN,
        }],
      }),
  );
test("a host that walks away unloads the far chunks and finds its tunnel when it returns", async ({ page }) => {
  await openWorld(page, "/?harness=1&seed=unload&unloadGraceMs=4000&tools=1", {
    npc: true,
  });
  await ready(page);
  await page.keyboard.press("F3");
  await placeHost(page, 8.5 + 16 * 5, 8.5 + 16 * 5);
  await expect.poll(() => hasChunk(page, "5,5")).toBe(true);
  await digTunnel(page);
  const tunnel = await bytes(page, "5,5");
  await placeHost(page, 8.5 + 16 * 15, 8.5 + 16 * 15);
  await expect.poll(() => hasChunk(page, "15,15")).toBe(true);
  const crowded = await loaded(page);
  expect(crowded).toBeGreaterThan(9);
  await panelShowsChunks(page);
  await evidenceShot(page, "chunk-unload-before");
  // Every chunk around the tunnel unloads. The corner NPC keeps the 3×3
  // around the origin loaded, and the host keeps the 3×3 around itself.
  await expect.poll(() => loaded(page)).toBe(18);
  expect(await hasChunk(page, "5,5")).toBe(false);
  // The authored chunk stays.
  expect(await hasChunk(page, "0,0")).toBe(true);
  await panelShowsChunks(page);
  await evidenceShot(page, "chunk-unload-after");
  await placeHost(page, 8.5 + 16 * 5, 8.5 + 16 * 5);
  await expect.poll(() => hasChunk(page, "5,5")).toBe(true);
  expect(await bytes(page, "5,5")).toBe(tunnel);
  // Sight follows the reloaded chunk, though the host did not walk.
  await expect.poll(() =>
    readWorld(
      page,
      (__world) =>
        __world.scene.visibility.visible.has(`${5 * 16 + 9},${5 * 16 + 8},0`),
    )
  ).toBe(true);
  await panelShowsChunks(page);
  await evidenceShot(page, "chunk-unload-returned");
});
