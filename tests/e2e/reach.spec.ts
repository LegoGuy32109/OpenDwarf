import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { ready } from "./ui.ts";

type Entry = { id: string; x: number; y: number; z: number; progress: number };
type Item = { x: number; y: number; z: number };
type Harness = {
  __od: {
    scene: {
      sessionId: string;
      localId: string;
      viewZ: number;
      mining: Entry[];
      items: Item[];
      world: {
        players: Record<string, Record<string, number>>;
      };
    };
  };
};

const DIAMOND = 8; // 4.5 s: long enough to move the cursor while it runs

const mining = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Harness).__od.scene.mining);

const viewZ = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Harness).__od.scene.viewZ);

/**
 * Carve a room on level 1 (x and y 3..9) over a stone floor on level 0, with a
 * stone ceiling on level 2, and stand an entity at (6, 6, 1).
 */
const carve = (page: Page, id?: string) =>
  page.evaluate(async (who) => {
    const terrain = await import("/src/shared/terrain.js");
    const scene = (globalThis as unknown as Harness).__od.scene;
    for (let y = 3; y <= 9; y++) {
      for (let x = 3; x <= 9; x++) {
        terrain.writeTile(scene.world, x, y, 0, terrain.STONE);
        terrain.writeTile(scene.world, x, y, 1, terrain.OPEN);
        terrain.writeTile(scene.world, x, y, 2, terrain.STONE);
      }
    }
    const player = scene.world.players[who ?? scene.localId];
    Object.assign(player, {
      x: 6,
      y: 6,
      z: 1,
      previousX: 6,
      previousY: 6,
    });
  }, id);

const setTile = (page: Page, x: number, y: number, z: number, m: number) =>
  page.evaluate(async ([px, py, pz, pm]) => {
    const terrain = await import("/src/shared/terrain.js");
    const scene = (globalThis as unknown as Harness).__od.scene;
    terrain.writeTile(scene.world, px, py, pz, pm);
  }, [x, y, z, m]);

test("the free cursor keeps mining a tile one level down and one level up", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/?harness=1");
  await ready(page);
  await carve(page);
  await expect.poll(() => viewZ(page)).toBe(1);
  // One level down: the floor tile east of the dwarf, under an open tile.
  await setTile(page, 7, 6, 0, DIAMOND);
  await page.keyboard.press("KeyV");
  await expect.poll(() => viewZ(page)).toBe(0);
  await page.keyboard.down("l");
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await expect.poll(async () => (await mining(page)).length).toBe(1);
  expect((await mining(page))[0]).toMatchObject({ x: 7, y: 6, z: 0 });
  await page.keyboard.up("l");
  // Moving the cursor away does not cancel mining.
  await page.keyboard.down("i");
  await page.waitForTimeout(700);
  await evidenceShot(page, "reach-mining-below-cursor-away");
  expect((await mining(page)).length).toBe(1);
  await page.keyboard.up("i");
  // Interact on the mined tile cancels it.
  await page.keyboard.down("l");
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await expect.poll(async () => (await mining(page)).length).toBe(0);
  await page.keyboard.up("l");
  expect(await mining(page)).toEqual([]);
  // One level up: the tile above the dwarf's east neighbor, with headroom.
  await setTile(page, 7, 6, 2, DIAMOND);
  await setTile(page, 6, 6, 2, 1);
  await page.keyboard.press("KeyR");
  await page.keyboard.press("KeyR");
  await expect.poll(() => viewZ(page)).toBe(2);
  await page.keyboard.down("l");
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await expect.poll(async () => (await mining(page)).length).toBe(1);
  expect((await mining(page))[0]).toMatchObject({ x: 7, y: 6, z: 2 });
  await page.keyboard.up("l");
  await page.keyboard.down("k");
  await page.waitForTimeout(500);
  expect((await mining(page)).length).toBe(1);
  await evidenceShot(page, "reach-mining-above");
  await page.keyboard.up("k");
});

test("a guest sees an item dropped around a corner once its floor is visible", async ({ browser }) => {
  test.setTimeout(60_000);
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await host.goto("/?harness=1");
  await ready(host);
  const session = await host.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.sessionId
  );
  await guest.goto(`/join/${session}?harness=1`);
  await ready(guest);
  await expect.poll(() =>
    guest.evaluate(() => (globalThis as unknown as Harness).__od.scene.localId)
  ).toMatch(/^peer-/);
  const guestId = await guest.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.localId
  );
  await carve(host, guestId);
  // A pillar north of the guest: the open tiles beside it are not in sight, but
  // the floor under them is.
  await setTile(host, 6, 5, 1, 2);
  await host.evaluate(async () => {
    const items = await import("/src/shared/items.js");
    const scene = (globalThis as unknown as Harness).__od.scene;
    items.dropItem(scene.world, { x: 7, y: 5, z: 1 }, "coal", 1);
    items.dropItem(scene.world, { x: 7, y: 3, z: 1 }, "coal", 1);
  });
  const seen = () =>
    guest.evaluate(() =>
      (globalThis as unknown as Harness).__od.scene.items.map((item) =>
        `${item.x},${item.y},${item.z}`
      )
    );
  await expect.poll(seen).toContain("7,5,1");
  expect(await seen()).not.toContain("7,3,1");
  await evidenceShot(guest, "reach-item-around-corner");
  await Promise.all([host.close(), guest.close()]);
});
