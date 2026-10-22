import type { TestWorld } from "./world.ts";
import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { waitFrames } from "./time.ts";
import { hasUi, ready, shopOpen } from "./ui.ts";
type Pad = {
  axes: number[];
  buttons: {
    pressed: boolean;
  }[];
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
    (globalThis as unknown as {
      __pad: Pad;
    }).__pad = pad;
  });
}
/** Hold a button for a few frames, then release it, so the frame loop reads both edges. */
/**
 * Press a button for exactly one drawn frame, then let it go. A held D-pad
 * repeats after a real-time delay, so a longer hold can count twice on a slow
 * machine.
 */
async function tap(page: Page, button: number) {
  await page.evaluate((b) =>
    new Promise<void>((resolve) => {
      const pad = (globalThis as unknown as {
        __pad: Pad;
      }).__pad;
      pad.buttons[b].pressed = true;
      requestAnimationFrame(() => {
        pad.buttons[b].pressed = false;
        requestAnimationFrame(() => resolve());
      });
    }), button);
}
const hold = (page: Page, button: number, pressed: boolean) =>
  page.evaluate(([b, down]) => {
    (globalThis as unknown as {
      __pad: Pad;
    }).__pad.buttons[b].pressed = down;
  }, [button, pressed] as const);
const scene = <T>(page: Page, read: (s: TestWorld["scene"]) => T) =>
  readWorld(
    page,
    (world, source) =>
      new Function("scene", `return (${source})(scene)`)(world.scene) as T,
    read.toString(),
  );
const placeAt = (page: Page, x: number, y: number) =>
  readWorld(page, (__world, [px, py]) => {
    const s = __world.scene;
    __world.edit({
      players: [{
        id: s.world.players[s.localId].id,
        at: {
          x: px,
          y: py,
          z: s.world.players[s.localId].z,
        },
      }],
    });
  }, [x, y]);
test("the world buttons: ZR interacts, ZL sprints, A and B zoom, Y bags", async ({ page }) => {
  await fakePad(page);
  await openWorld(page, "/?harness=1&gamepad-debug=1");
  await ready(page);
  await page.locator("#world").click();
  // Stand under the stone at (2, 1) and aim north with the look stick.
  await placeAt(page, 2, 2);
  await page.evaluate(() => {
    (globalThis as unknown as {
      __pad: Pad;
    }).__pad.axes[3] = -1;
  });
  await expect.poll(() => scene(page, (s) => ({ ...s.aim }))).toEqual({
    x: 0,
    y: -1,
  });
  // B is not interact.
  await tap(page, B);
  expect(await scene(page, (s) => s.mining.length)).toBe(0);
  // ZR mines.
  await hold(page, ZR, true);
  await expect.poll(() => scene(page, (s) => s.world.chunks.get("0,0")?.[18]))
    .toBe(1);
  await hold(page, ZR, false);
  await page.evaluate(() => {
    (globalThis as unknown as {
      __pad: Pad;
    }).__pad.axes[3] = 0;
  });
  // ZL toggles sprint.
  const sprint = () => readWorld(page, (__world) => __world.stamina.sprint);
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
  await waitFrames(page, 10);
  await hold(page, A, false);
  expect(await zoom()).toBe(inBag);
  await tap(page, Y);
  await expect.poll(() => hasUi(page, "panel:bag")).toBe(false);
  // X opens the menu, and with the bag open it replaces the bag.
  await tap(page, Y);
  await expect.poll(() => hasUi(page, "panel:bag")).toBe(true);
  await tap(page, X);
  await expect.poll(() => hasUi(page, "panel:bag")).toBe(false);
  expect(await scene(page, (s) => s.menu)).toBe(true);
  // Y replaces the menu with the bag.
  await tap(page, Y);
  await expect.poll(() => hasUi(page, "panel:bag")).toBe(true);
  expect(await scene(page, (s) => s.menu)).toBe(false);
});
test("B backs out of the shop, and X replaces it with the menu", async ({ page }) => {
  await fakePad(page);
  await openWorld(page, "/?harness=1&layout=room&gamepad-debug=1");
  await ready(page);
  await page.locator("#world").click();
  await placeAt(page, 16, 13);
  await waitFrames(page, 3);
  await page.evaluate(() => {
    (globalThis as unknown as { __pad: { axes: number[] } }).__pad.axes[3] = -1;
  });
  await tap(page, ZR);
  await page.evaluate(() => {
    (globalThis as unknown as { __pad: { axes: number[] } }).__pad.axes[3] = 0;
  });
  await expect.poll(() => shopOpen(page)).toBe(true);
  await evidenceShot(page, "gamepad-shop-open");
  await tap(page, A);
  expect(await shopOpen(page)).toBe(true);
  await tap(page, B);
  await expect.poll(() => shopOpen(page)).toBe(false);
  expect(await scene(page, (s) => s.menu)).toBe(false);
  await tap(page, ZR);
  await expect.poll(() => shopOpen(page)).toBe(true);
  await tap(page, X);
  await expect.poll(() => shopOpen(page)).toBe(false);
  expect(await scene(page, (s) => s.menu)).toBe(true);
});
