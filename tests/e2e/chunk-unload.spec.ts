import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { ready } from "./ui.ts";

type Harness = {
  __od: {
    scene: {
      localId: string;
      world: {
        chunks: Map<string, Uint8Array>;
        players: Record<string, { x: number; y: number; z: number }>;
      };
    };
    ui: { state: { diagnosticsOpen: boolean } };
  };
};

const loaded = (page: Page) =>
  page.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.world.chunks.size
  );

const bytes = (page: Page, key: string) =>
  page.evaluate(
    (key) =>
      [
        ...((globalThis as unknown as Harness).__od.scene.world.chunks.get(
          key,
        ) ?? []),
      ].join(),
    key,
  );

const hasChunk = (page: Page, key: string) =>
  page.evaluate(
    (key) =>
      (globalThis as unknown as Harness).__od.scene.world.chunks.has(key),
    key,
  );

/** Place the host's own player on a tile, as if it had walked there. */
const placeHost = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => {
    const scene = (globalThis as unknown as Harness).__od.scene;
    const player = scene.world.players[scene.localId];
    player.x = x;
    player.y = y;
  }, [x, y]);

/** Dig a tunnel along x at level 0 through chunk 5,5 with the host's own write path. */
const digTunnel = (page: Page) =>
  page.evaluate(async () => {
    const { writeTile, OPEN } = await import("/src/shared/terrain.js");
    const world = (globalThis as unknown as Harness).__od.scene.world;
    for (let x = 0; x < 10; x++) {
      writeTile(
        world as never,
        5 * 16 + 3 + x,
        5 * 16 + 8,
        0,
        OPEN,
      );
    }
  });

test("a host that walks away unloads the far chunks and finds its tunnel when it returns", async ({ page }) => {
  await page.goto("/?harness=1&seed=unload&unloadGraceMs=4000&tools=1");
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
  // The panel text refreshes once a second; the grace period is longer.
  await page.waitForTimeout(1300);
  await evidenceShot(page, "chunk-unload-before");
  // Every chunk around the tunnel unloads. The corner NPC keeps the 3×3
  // around the origin loaded, and the host keeps the 3×3 around itself.
  await expect.poll(() => loaded(page), { timeout: 15_000 }).toBe(18);
  expect(await hasChunk(page, "5,5")).toBe(false);
  // The authored chunk stays.
  expect(await hasChunk(page, "0,0")).toBe(true);
  await page.waitForTimeout(1300);
  await evidenceShot(page, "chunk-unload-after");

  await placeHost(page, 8.5 + 16 * 5, 8.5 + 16 * 5);
  await expect.poll(() => hasChunk(page, "5,5")).toBe(true);
  expect(await bytes(page, "5,5")).toBe(tunnel);
  await page.waitForTimeout(1300);
  await evidenceShot(page, "chunk-unload-returned");
});
