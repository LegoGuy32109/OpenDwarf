import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { hasUi, ready, shopOpen } from "./ui.ts";

type Pad = { axes: number[]; buttons: { pressed: boolean }[] };
type Harness = {
  __od: {
    stamina: { sprint: boolean };
    scene: {
      localId: string;
      zoomTarget: number;
      menu: boolean;
      mining: unknown[];
      world: { players: Record<string, Record<string, number>> };
    };
  };
};

// The controller layout of ADR 0009, with the Nintendo Switch labels.
const B = 0;
const A = 1;
const Y = 2;
const X = 3;
const ZL = 6;
const ZR = 7;

async function fakePad(page: Page) {
  await page.addInitScript(() => {
    const pad = {
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false })),
      connected: true,
      id: "Test Switch controller",
      index: 0,
      mapping: "standard",
    };
    Object.defineProperty(navigator, "getGamepads", { value: () => [pad] });
    (globalThis as unknown as { __pad: Pad }).__pad = pad;
  });
}

/** Hold a button for a moment, then release it. */
async function tap(page: Page, button: number) {
  await hold(page, button, true);
  await page.waitForTimeout(250);
  await hold(page, button, false);
  await page.waitForTimeout(250);
}

const hold = (page: Page, button: number, pressed: boolean) =>
  page.evaluate(([b, down]) => {
    (globalThis as unknown as { __pad: Pad }).__pad.buttons[b].pressed = down;
  }, [button, pressed] as const);

const scene = <T>(page: Page, read: (s: Harness["__od"]["scene"]) => T) =>
  page.evaluate(
    `(${read.toString()})(globalThis.__od.scene)`,
  ) as Promise<T>;

const placeAt = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => {
    const s = (globalThis as unknown as Harness).__od.scene;
    Object.assign(s.world.players[s.localId], {
      x: px,
      y: py,
      previousX: px,
      previousY: py,
    });
  }, [x, y]);

test("the world buttons: ZR interacts, ZL sprints, A and B zoom, Y bags", async ({ page }) => {
  test.setTimeout(60_000);
  await fakePad(page);
  await page.goto("/?harness=1&gamepad-debug=1");
  await ready(page);
  await page.locator("#world").click();
  // Stand under the stone at (2, 1) and aim north with the look stick.
  await placeAt(page, 2, 2);
  await page.evaluate(() => {
    (globalThis as unknown as { __pad: Pad }).__pad.axes[3] = -1;
  });
  await page.waitForTimeout(300);
  // B is not interact.
  await tap(page, B);
  expect(await scene(page, (s) => s.mining.length)).toBe(0);
  // ZR mines.
  await hold(page, ZR, true);
  await expect.poll(() => scene(page, (s) => s.mining.length)).toBeGreaterThan(
    0,
  );
  await hold(page, ZR, false);
  await page.evaluate(() => {
    (globalThis as unknown as { __pad: Pad }).__pad.axes[3] = 0;
  });
  // ZL toggles sprint.
  const sprint = () =>
    page.evaluate(() => (globalThis as unknown as Harness).__od.stamina.sprint);
  expect(await sprint()).toBe(false);
  await tap(page, ZL);
  expect(await sprint()).toBe(true);
  await tap(page, ZL);
  expect(await sprint()).toBe(false);
  // A zooms in while held, B zooms out.
  const zoom = () => scene(page, (s) => s.zoomTarget);
  const start = await zoom();
  await hold(page, A, true);
  await expect.poll(zoom).toBeGreaterThan(start);
  await hold(page, A, false);
  const zoomedIn = await zoom();
  await hold(page, B, true);
  await expect.poll(zoom).toBeLessThan(zoomedIn);
  await hold(page, B, false);
  // Y opens and closes the bag; with it open, A and B do not zoom.
  await tap(page, Y);
  await expect.poll(() => hasUi(page, "panel:bag")).toBe(true);
  await evidenceShot(page, "gamepad-bag-open");
  const inBag = await zoom();
  await hold(page, A, true);
  await page.waitForTimeout(400);
  await hold(page, A, false);
  expect(await zoom()).toBe(inBag);
  await tap(page, Y);
  await expect.poll(() => hasUi(page, "panel:bag")).toBe(false);
  // X opens the menu with no panel open, and closes the bag when it is open.
  await tap(page, Y);
  await expect.poll(() => hasUi(page, "panel:bag")).toBe(true);
  await tap(page, X);
  await expect.poll(() => hasUi(page, "panel:bag")).toBe(false);
  expect(await scene(page, (s) => s.menu)).toBe(false);
  await tap(page, X);
  await expect.poll(() => scene(page, (s) => s.menu)).toBe(true);
});

test("X closes the shop, and B does not", async ({ page }) => {
  test.setTimeout(60_000);
  await fakePad(page);
  await page.goto("/?harness=1&layout=room&gamepad-debug=1");
  await ready(page);
  await page.locator("#world").click();
  await placeAt(page, 16, 12);
  await page.waitForTimeout(400);
  await tap(page, ZR);
  await expect.poll(() => shopOpen(page)).toBe(true);
  await evidenceShot(page, "gamepad-shop-open");
  await tap(page, B);
  await tap(page, A);
  expect(await shopOpen(page)).toBe(true);
  await tap(page, X);
  await expect.poll(() => shopOpen(page)).toBe(false);
  expect(await scene(page, (s) => s.menu)).toBe(false);
});
