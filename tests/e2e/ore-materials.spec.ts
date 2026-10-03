import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { ready } from "./ui.ts";

type Harness = {
  __od: {
    scene: {
      sessionId: string;
      viewZ: number;
      world: {
        chunks: Map<string, Uint8Array>;
        players: Record<string, { x: number; y: number; z: number }>;
      };
      localId: string;
    };
  };
};

// Stone, then coal, iron ore, gold ore, lapis, redstone, diamond, emerald.
const ROW_MATERIALS = [2, 3, 4, 5, 6, 7, 8, 9];
const ROW_START = 1 * 16 + 2;

const oreRow = (page: Page) =>
  page.evaluate((start) => {
    const chunk = (globalThis as unknown as Harness).__od.scene.world.chunks
      .get("0,0");
    return chunk ? [...chunk.slice(start, start + 8)] : [];
  }, ROW_START);

async function walkNorth(page: Page) {
  await page.keyboard.down("e");
  await expect.poll(() =>
    page.evaluate(() => {
      const scene = (globalThis as unknown as Harness).__od.scene;
      return scene.world.players[scene.localId]?.y;
    })
  ).toBeLessThan(4.5);
  await page.keyboard.up("e");
}

test("stone and every ore draw distinctly at the player's level and from above", async ({ page }) => {
  await page.goto("/?harness=1");
  await ready(page);
  expect(await oreRow(page)).toEqual(ROW_MATERIALS);
  await walkNorth(page);
  await page.waitForTimeout(400);
  await evidenceShot(page, "ores-player-level");
  await page.evaluate(() => {
    (globalThis as unknown as Harness).__od.scene.viewZ = 1;
  });
  await page.waitForTimeout(400);
  await evidenceShot(page, "ores-from-above");
});

test("a joining player receives ore materials", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await host.goto("/?harness=1");
  await ready(host);
  const session = await host.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.sessionId
  );
  await guest.goto(`/join/${session}?harness=1`);
  await ready(guest);
  // The guest spawns at the host's spawn tile and sees the row of tiles.
  await expect.poll(() => oreRow(guest)).toEqual(ROW_MATERIALS);
  await Promise.all([host.close(), guest.close()]);
});
