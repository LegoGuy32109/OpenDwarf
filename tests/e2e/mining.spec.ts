import {
  facePlayer,
  openWorld,
  placePlayer,
  readWorld,
  setTile,
} from "./world.ts";
import { expect, test } from "./fixtures.ts";
import type { Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { waitFor, waitFrames, waitTicks } from "./time.ts";
import { ready, uiCenter, uiRect } from "./ui.ts";
// Functions sent to readWorld must receive coordinates explicitly.
const material = (page: Page, x: number, y = 1) =>
  readWorld(
    page,
    (w, { x, y }) => w.scene.world.chunks.get("0,0")?.[256 + y * 16 + x],
    { x, y },
  );
const mining = (page: Page) => readWorld(page, (w) => w.scene.mining);
async function setup(page: Page) {
  await openWorld(page, "/?harness=1");
  await ready(page);
  await placePlayer(page, 2, 2);
  await facePlayer(page, 0, -1);
}
test("the host holds to mine stone, then coal, with the breaking decal", {
  tag: "@smoke",
}, async ({ page }) => {
  await setup(page);
  for (const [x, kind] of [[2, 2], [3, 3]]) {
    await placePlayer(page, x, 2);
    expect(await material(page, x)).toBe(kind);
    await page.keyboard.down("Space");
    await waitFor(
      page,
      async () => (await mining(page)).some((e) => e.x === x && e.progress > 0),
      { maxTicks: 40 },
    );
    await evidenceShot(page, `134-mining-${kind}-progress`);
    await waitFor(page, async () => await material(page, x) === 1);
    await page.keyboard.up("Space");
    await expect.poll(() => mining(page)).toEqual([]);
  }
});
test("host and guest share held mining and refuse other levels and distant targets", async ({ page: host, context }) => {
  await setup(host);
  const guest = await context.newPage();
  const session = await readWorld(host, (w) => w.scene.sessionId);
  await openWorld(guest, `/join/${session}?harness=1`);
  await ready(guest);
  await expect.poll(() => readWorld(guest, (w) => w.scene.localId)).toMatch(
    /^peer-/,
  );
  const id = await readWorld(guest, (w) => w.scene.localId);
  await placePlayer(host, 7, 2);
  await placePlayer(host, 8, 2, 1, id);
  await facePlayer(host, 0, -1, id);
  await expect.poll(() =>
    readWorld(guest, (w) => w.scene.world.players[w.scene.localId].facing)
  ).toEqual({ x: 0, y: -1 });
  await host.keyboard.down("Space");
  await waitFor(
    guest,
    async () =>
      (await mining(guest)).some((e) => e.x === 7 && e.progress > 0.2),
  );
  await evidenceShot(guest, "134-guest-mining-decal");
  await waitFor(guest, async () => await material(guest, 7) === 1);
  await host.keyboard.up("Space");
  await guest.keyboard.down("Space");
  await waitFor(
    host,
    async () => (await mining(host)).some((e) => e.id === id),
  );
  await waitFor(guest, async () => await material(guest, 8) === 1);
  await guest.keyboard.up("Space");
  await readWorld(
    guest,
    (w) => w.send({ type: "mine-hold", x: 2, y: 1, z: 0 }),
  );
  await expect.poll(() => readWorld(guest, (w) => w.scene.notice?.text))
    .toContain("plane");
  await readWorld(
    guest,
    (w) => w.send({ type: "mine-hold", x: 2, y: 1, z: 1 }),
  );
  await expect.poll(() => readWorld(guest, (w) => w.scene.notice?.text))
    .toContain("reach");
  expect(await material(host, 2)).toBe(2);
});
test("held mining retargets immediately on turns and tunnels forward without pickup spam", async ({ page }) => {
  await setup(page);
  await placePlayer(page, 6, 6);
  await facePlayer(page, 1, 0);
  await setTile(page, 7, 6, 1, 8);
  await setTile(page, 6, 5, 1, 2);
  await page.keyboard.down("Space");
  await waitFor(page, async () => (await mining(page)).some((e) => e.x === 7));
  await page.keyboard.down("e");
  await waitFor(
    page,
    async () => (await mining(page)).some((e) => e.x === 6 && e.y === 5),
  );
  expect(await material(page, 7, 6)).toBe(8);
  await waitFor(page, async () => await material(page, 6, 5) === 1);
  await page.keyboard.up("Space");
  await page.keyboard.up("e");
  await placePlayer(page, 6, 6);
  await setTile(page, 7, 6, 1, 2);
  await setTile(page, 8, 6, 1, 2);
  await page.keyboard.down("f");
  await page.keyboard.down("Space");
  await waitFor(page, async () => await material(page, 8, 6) === 1);
  await page.keyboard.up("Space");
  await page.keyboard.up("f");
  expect(
    await readWorld(
      page,
      (w) => w.scene.inventory.find((s) => s.kind === "stone")?.count ?? 0,
    ),
  ).toBe(0);
  await evidenceShot(page, "134-forward-tunnel");
});
test.describe("phone held action", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("a held action mines, pickaxe drag never aims, and pointer cancellation stops it", async ({ page, context }) => {
    await setup(page);
    await placePlayer(page, 4, 2);
    await facePlayer(page, 0, -1);
    await setTile(page, 4, 1, 1, 8);
    const action = await uiCenter(page, "btn:interact");
    const rect = await uiRect(page, "btn:interact");
    expect(Math.abs(rect.w - rect.h)).toBeLessThan(12);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, ...action }],
    });
    await waitFor(page, async () => (await mining(page)).length === 1);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ id: 1, x: action.x, y: action.y - 50 }],
    });
    await waitFrames(page);
    expect(await readWorld(page, (w) => w.scene.actionGesture?.aiming)).toBe(
      false,
    );
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await waitTicks(page, 12);
    expect(await material(page, 4)).toBe(8);
    expect(await mining(page)).toEqual([]);
    await evidenceShot(page, "134-portrait-cancelled-mining");
  });
});
