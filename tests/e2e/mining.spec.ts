import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { holdUntil, waitFrames, waitTicks } from "./time.ts";
import { ready, tapUi, type UiRect, uiRect } from "./ui.ts";
const box = ({ x, y, w, h }: UiRect) => ({ x, y, width: w, height: h });
const OPEN = 1;
const STONE = 2;
const COAL = 3;
const REDSTONE = 7;
const DIAMOND = 8;
// The authored ore row at level 0: stone x 2, coal 3, iron 4 ... emerald 9, at y 1.
const ROW_Y = 1;
const tile = (page: Page, x: number, y = ROW_Y) =>
  readWorld(
    page,
    (__world, [tx, ty]) =>
      __world.scene.world.chunks.get("0,0")?.[ty * 16 + tx] ?? -1,
    [x, y],
  );
const position = (page: Page) =>
  readWorld(page, (__world) => {
    const scene = __world.scene;
    return scene.world.players[scene.localId];
  });
const mining = (page: Page) =>
  readWorld(page, (__world) => __world.scene.mining);
async function walk(page: Page, key: string, until: () => Promise<boolean>) {
  await holdUntil(page, key, until);
  // Let the walk settle on a tile center.
  await expect.poll(async () => (await position(page))?.move ?? null)
    .toBeNull();
}
/** Walk north until the player stands against the ore row. */
const goToRow = (page: Page) =>
  walk(page, "e", async () => ((await position(page))?.y ?? 9) < 2.4);
/** Stand the host's player still at a position; walking is covered by the first test. */
const placeAt = (page: Page, x: number, y: number) =>
  readWorld(page, (__world, [px, py]) => {
    const scene = __world.scene;
    const player = scene.world.players[scene.localId];
    __world.edit({
      players: [{
        id: player.id,
        at: {
          x: px,
          y: py,
          z: player.z,
        },
      }],
    });
  }, [x, y]);
async function startHost(page: Page) {
  await openWorld(page, "/?harness=1");
  await ready(page);
}
test("the host mines stone, then coal, with the breaking decal", {
  tag: "@smoke",
}, async ({ page }) => {
  await startHost(page);
  await goToRow(page);
  await placeAt(page, 2, 2);
  expect(await tile(page, 2)).toBe(STONE);
  await page.keyboard.down("i"); // aim north at the stone
  await evidenceShot(page, "mining-highlight");
  await page.keyboard.press("Space");
  await expect.poll(async () => (await mining(page)).length).toBe(1);
  // Stone takes 20 ticks.
  await waitTicks(page, 8);
  await evidenceShot(page, "mining-stone-progress");
  expect((await mining(page))[0].progress).toBeGreaterThan(0.2);
  await expect.poll(() => tile(page, 2)).toBe(OPEN);
  expect(await mining(page)).toEqual([]);
  await page.keyboard.up("i");
  // Coal is the next tile east and takes 30 ticks.
  await placeAt(page, 3, 2);
  expect(await tile(page, 3)).toBe(COAL);
  await page.keyboard.down("i");
  await page.keyboard.press("Space");
  await expect.poll(async () => (await mining(page)).length).toBe(1);
  await waitTicks(page, 14);
  expect(await tile(page, 3)).toBe(COAL);
  await evidenceShot(page, "mining-coal-progress");
  await expect.poll(() => tile(page, 3)).toBe(OPEN);
  await evidenceShot(page, "mining-coal-done");
  await page.keyboard.up("i");
});
test("a joining player sees the breaking decal and the tile change, and can mine", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await startHost(host);
  const session = await readWorld(host, (__world) => __world.scene.sessionId);
  await openWorld(guest, `/join/${session}?harness=1`);
  await ready(guest);
  await expect.poll(() => tile(guest, 7)).toBe(REDSTONE);
  await goToRow(host);
  await goToRow(guest);
  const hostX = (await position(host))?.x ?? 0;
  const guestX = (await position(guest))?.x ?? 0;
  expect(Math.round(hostX)).toBe(7);
  expect(Math.round(guestX)).toBe(8);
  // The host mines redstone (60 ticks). The guest sees a decal, not a square.
  await host.keyboard.down("i");
  await host.keyboard.press("Space");
  await expect.poll(async () => (await mining(guest)).length).toBe(1);
  await expect.poll(async () => (await mining(guest))[0]?.progress ?? 0)
    .toBeGreaterThan(0.4);
  const seen = (await mining(guest))[0];
  expect(seen.id).not.toBe(
    await readWorld(guest, (__world) => __world.scene.localId),
  );
  expect(seen.progress).toBeGreaterThan(0.4);
  await evidenceShot(guest, "guest-breaking-decal");
  await expect.poll(() => tile(guest, 7)).toBe(OPEN);
  expect(await tile(host, 7)).toBe(OPEN);
  // The tile change and the end of the decal can arrive in different updates.
  await expect.poll(() => mining(guest)).toEqual([]);
  await host.keyboard.up("i");
  // The guest mines the diamond (90 ticks) in front of it.
  expect(await tile(guest, 8)).toBe(DIAMOND);
  await guest.keyboard.down("i");
  await guest.keyboard.press("Space");
  await expect.poll(async () => (await mining(host)).length).toBe(1);
  await expect.poll(async () => (await mining(guest)).length).toBe(1);
  await expect.poll(() => tile(host, 8)).toBe(OPEN);
  await expect.poll(() => tile(guest, 8)).toBe(OPEN);
  await guest.keyboard.up("i");
  // The host refuses a tile out of the guest's reach.
  await readWorld(guest, (__world) =>
    __world.send({
      type: "mine",
      x: 2,
      y: 1,
      z: 0,
    }));
  await expect.poll(() =>
    readWorld(guest, (__world) => __world.scene.notice?.text ?? "")
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
  test("sits between the sticks without touching them, and mines on tap", async ({ page }) => {
    await startHost(page);
    const button = box(await uiRect(page, "btn:interact"));
    const sprint = box(await uiRect(page, "btn:sprint"));
    const move = box(await uiRect(page, "stick:move"));
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
    const look = box(await uiRect(page, "stick:look"));
    expect(button.x).toBeGreaterThanOrEqual(move.x + move.width);
    expect(button.x + button.width).toBeLessThanOrEqual(look.x);
    expect(button.y + button.height).toBeLessThan(view.height);
    // It is at least as large as sprint (ADR 0009 phone layout).
    expect(button.width).toBeGreaterThanOrEqual(sprint.width);
    await evidenceShot(page, "interact-portrait");
    await page.setViewportSize({ width: 844, height: 390 });
    const landscape = box(await uiRect(page, "btn:interact"));
    const landscapeMove = box(await uiRect(page, "stick:move"));
    expect(landscape.x).toBeGreaterThanOrEqual(
      landscapeMove.x + landscapeMove.width,
    );
    await evidenceShot(page, "interact-landscape");
    await page.setViewportSize({ width: 390, height: 844 });
    await placeAt(page, 3, 2);
    expect(await tile(page, 3)).toBe(COAL);
    await page.keyboard.down("i");
    await tapUi(page, "btn:interact");
    await expect.poll(async () => (await mining(page)).length).toBe(1);
    await waitTicks(page, 10);
    await evidenceShot(page, "interact-mining-phone");
    await expect.poll(() => tile(page, 3)).toBe(OPEN);
    await page.keyboard.up("i");
  });
  test("a tap mines while a thumb holds the look stick, and letting go keeps mining", async ({ page }) => {
    await startHost(page);
    await placeAt(page, 4, 2);
    expect(await tile(page, 4)).not.toBe(OPEN);
    const look = box(await uiRect(page, "stick:look"));
    const button = box(await uiRect(page, "btn:interact"));
    // Aim north: one finger near the top of the look stick.
    const aim = {
      x: look.x + look.width / 2,
      y: look.y + look.height * 0.15,
      id: 1,
    };
    const tap = {
      x: button.x + button.width / 2,
      y: button.y + button.height / 2,
      id: 2,
    };
    const touch = await page.context().newCDPSession(page);
    const send = (type: "touchStart" | "touchEnd", points: typeof aim[]) =>
      touch.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    await send("touchStart", [aim]);
    // Let the frame loop read the aim before the tap.
    await waitFrames(page, 3);
    // A second finger taps interact while the first still holds the stick.
    await send("touchStart", [aim, tap]);
    await send("touchEnd", [aim]);
    await expect.poll(async () => (await mining(page)).length).toBe(1);
    // The aim thumb lifts: the aim rests, and mining goes on.
    await send("touchEnd", []);
    await waitTicks(page, 6);
    expect((await mining(page)).length).toBe(1);
    await expect.poll(() => tile(page, 4)).toBe(OPEN);
  });
});
