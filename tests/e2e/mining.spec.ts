import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";

type Entry = { id: string; x: number; y: number; z: number; progress: number };
type Harness = {
  __od: {
    scene: {
      sessionId: string;
      localId: string;
      status: string;
      mining: Entry[];
      world: {
        chunks: Map<string, Uint8Array>;
        players: Record<string, { x: number; y: number; z: number }>;
      };
    };
    send: (message: Record<string, unknown>) => boolean;
  };
};

const OPEN = 1;
const STONE = 2;
const COAL = 3;
const REDSTONE = 7;
const DIAMOND = 8;
// The authored ore row at level 0: stone x 2, coal 3, iron 4 ... emerald 9, at y 1.
const ROW_Y = 1;

const tile = (page: Page, x: number, y = ROW_Y) =>
  page.evaluate(
    ([tx, ty]) =>
      (globalThis as unknown as Harness).__od.scene.world.chunks.get("0,0")?.[
        ty * 16 + tx
      ] ?? -1,
    [x, y],
  );

const position = (page: Page) =>
  page.evaluate(() => {
    const scene = (globalThis as unknown as Harness).__od.scene;
    return scene.world.players[scene.localId];
  });

const mining = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Harness).__od.scene.mining);

async function walk(page: Page, key: string, until: () => Promise<boolean>) {
  await page.keyboard.down(key);
  await expect.poll(until, { timeout: 30_000 }).toBe(true);
  await page.keyboard.up(key);
  // Let the walk settle between tile centers.
  await page.waitForTimeout(350);
}

/** Walk north until the player stands against the ore row. */
const goToRow = (page: Page) =>
  walk(page, "e", async () => ((await position(page))?.y ?? 9) < 2.4);

/** Stand the host's player still at a position; walking is covered by the first test. */
const placeAt = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => {
    const scene = (globalThis as unknown as Harness).__od.scene;
    const player = scene.world.players[scene.localId] as Record<string, number>;
    Object.assign(player, { x: px, y: py, previousX: px, previousY: py });
  }, [x, y]);

async function startHost(page: Page) {
  await page.goto("/?harness=1");
  await expect(page.locator("#loading")).toBeHidden();
}

test("the host mines stone, then coal, with the progress square", async ({ page }) => {
  await startHost(page);
  test.setTimeout(90_000);
  await goToRow(page);
  await placeAt(page, 2, 2);
  expect(await tile(page, 2)).toBe(STONE);
  await page.keyboard.down("i"); // aim north at the stone
  await page.waitForTimeout(150);
  await evidenceShot(page, "mining-highlight");
  await page.keyboard.press("Space");
  await expect.poll(async () => (await mining(page)).length).toBe(1);
  await page.waitForTimeout(500);
  await evidenceShot(page, "mining-stone-progress");
  expect((await mining(page))[0].progress).toBeGreaterThan(0.2);
  await expect.poll(() => tile(page, 2), { timeout: 5000 }).toBe(OPEN);
  expect(await mining(page)).toEqual([]);
  await page.keyboard.up("i");
  // Coal is the next tile east and takes 1.5 s.
  await placeAt(page, 3, 2);
  expect(await tile(page, 3)).toBe(COAL);
  await page.keyboard.down("i");
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await page.waitForTimeout(700);
  expect(await tile(page, 3)).toBe(COAL);
  await evidenceShot(page, "mining-coal-progress");
  await expect.poll(() => tile(page, 3), { timeout: 5000 }).toBe(OPEN);
  await page.waitForTimeout(300);
  await evidenceShot(page, "mining-coal-done");
  await page.keyboard.up("i");
});

test("aiming at another tile cancels, and the host rejects bad targets", async ({ page }) => {
  await startHost(page);
  await placeAt(page, 5, 2);
  await page.keyboard.down("i");
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await expect.poll(async () => (await mining(page)).length).toBe(1);
  await page.keyboard.down("j"); // the aim moves to the north-west tile
  await expect.poll(async () => (await mining(page)).length).toBe(0);
  await page.keyboard.up("j");
  await page.keyboard.up("i");
  await page.waitForTimeout(500);
  expect(await tile(page, 5)).not.toBe(OPEN);
  // With no aim the highlight is the entity's own tile, which is not minable.
  await page.keyboard.press("Space");
  await expect.poll(() =>
    page.evaluate(() => (globalThis as unknown as Harness).__od.scene.status)
  ).toContain("aim at a neighboring tile");
  expect(await mining(page)).toEqual([]);
});

test("moving along the wall keeps mining; walking out of reach cancels", async ({ page }) => {
  await startHost(page);
  await placeAt(page, 8, 2);
  expect(await tile(page, 8)).toBe(DIAMOND); // 4.5 s
  await page.keyboard.down("i");
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await expect.poll(async () => (await mining(page)).length).toBe(1);
  // One tile west the diamond is still diagonally adjacent, so mining goes on.
  await placeAt(page, 7, 2);
  await page.waitForTimeout(300);
  expect((await mining(page)).length).toBe(1);
  // Two tiles west it is out of reach.
  await placeAt(page, 6, 2);
  await expect.poll(async () => (await mining(page)).length).toBe(0);
  await page.keyboard.up("i");
  await page.waitForTimeout(300);
  expect(await tile(page, 8)).toBe(DIAMOND);
});

test("a joining player sees the breaking decal and the tile change, and can mine", async ({ browser }) => {
  test.setTimeout(90_000);
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await startHost(host);
  const session = await host.evaluate(() =>
    (globalThis as unknown as Harness).__od.scene.sessionId
  );
  await guest.goto(`/join/${session}?harness=1`);
  await expect(guest.locator("#loading")).toBeHidden();
  await expect.poll(() => tile(guest, 7)).toBe(REDSTONE);
  await goToRow(host);
  await goToRow(guest);
  const hostX = (await position(host))?.x ?? 0;
  const guestX = (await position(guest))?.x ?? 0;
  expect(Math.round(hostX)).toBe(7);
  expect(Math.round(guestX)).toBe(8);
  // The host mines redstone (3 s). The guest sees a decal, not a square.
  await host.keyboard.down("i");
  await host.waitForTimeout(150);
  await host.keyboard.press("Space");
  await expect.poll(async () => (await mining(guest)).length, {
    timeout: 5000,
  }).toBe(1);
  await guest.waitForTimeout(1900);
  const seen = (await mining(guest))[0];
  expect(seen.id).not.toBe(
    await guest.evaluate(() =>
      (globalThis as unknown as Harness).__od.scene.localId
    ),
  );
  expect(seen.progress).toBeGreaterThan(0.4);
  await evidenceShot(guest, "guest-breaking-decal");
  await expect.poll(() => tile(guest, 7), { timeout: 6000 }).toBe(OPEN);
  expect(await tile(host, 7)).toBe(OPEN);
  expect(await mining(guest)).toEqual([]);
  await host.keyboard.up("i");
  // The guest mines the diamond (4.5 s) in front of it.
  expect(await tile(guest, 8)).toBe(DIAMOND);
  await guest.keyboard.down("i");
  await guest.waitForTimeout(150);
  await guest.keyboard.press("Space");
  await expect.poll(async () => (await mining(host)).length, { timeout: 5000 })
    .toBe(1);
  await expect.poll(async () => (await mining(guest)).length).toBe(1);
  await expect.poll(() => tile(host, 8), { timeout: 8000 }).toBe(OPEN);
  await expect.poll(() => tile(guest, 8), { timeout: 3000 }).toBe(OPEN);
  await guest.keyboard.up("i");
  // The host refuses a tile out of the guest's reach.
  await guest.evaluate(() =>
    (globalThis as unknown as Harness).__od.send({
      type: "mine",
      x: 2,
      y: 1,
      z: 0,
    })
  );
  await expect.poll(() =>
    guest.evaluate(() => (globalThis as unknown as Harness).__od.scene.status)
  ).toContain("out of reach");
  expect(await tile(host, 2)).toBe(STONE);
  await Promise.all([host.close(), guest.close()]);
});

test.describe("phone interact button", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    // A plain pixel ratio keeps the software renderer at a full frame rate.
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });

  test("sits beside the move stick without touching it, and mines on tap", async ({ page }) => {
    await startHost(page);
    const button = (await page.locator("#interact-button").boundingBox())!;
    const sprint = (await page.locator("#sprint-button").boundingBox())!;
    const move = (await page.locator("[data-stick=move]").boundingBox())!;
    const view = page.viewportSize()!;
    // The move stick is a circle: its edge must stay clear of the button box.
    const radius = move.width / 2;
    const nearestX = Math.max(
      button.x,
      Math.min(move.x + radius, button.x + button.width),
    );
    const nearestY = Math.max(
      button.y,
      Math.min(move.y + radius, button.y + button.height),
    );
    expect(Math.hypot(nearestX - move.x - radius, nearestY - move.y - radius))
      .toBeGreaterThan(radius);
    expect(button.x).toBeGreaterThanOrEqual(move.x + move.width);
    expect(button.x + button.width).toBeLessThanOrEqual(sprint.x);
    expect(button.y + button.height).toBeLessThan(view.height);
    // It mirrors the sprint button across the middle of the screen.
    expect(Math.abs(button.y - sprint.y)).toBeLessThan(2);
    await evidenceShot(page, "interact-portrait");
    await page.setViewportSize({ width: 844, height: 390 });
    const landscape = (await page.locator("#interact-button").boundingBox())!;
    const landscapeMove =
      (await page.locator("[data-stick=move]").boundingBox())!;
    expect(landscape.x).toBeGreaterThanOrEqual(
      landscapeMove.x + landscapeMove.width,
    );
    await evidenceShot(page, "interact-landscape");
    await page.setViewportSize({ width: 390, height: 844 });
    await placeAt(page, 3, 2);
    expect(await tile(page, 3)).toBe(COAL);
    await page.keyboard.down("i");
    await page.waitForTimeout(150);
    await page.locator("#interact-button").tap();
    await expect.poll(async () => (await mining(page)).length).toBe(1);
    await page.waitForTimeout(500);
    await evidenceShot(page, "interact-mining-phone");
    await expect.poll(() => tile(page, 3), { timeout: 5000 }).toBe(OPEN);
    await page.keyboard.up("i");
  });
});
