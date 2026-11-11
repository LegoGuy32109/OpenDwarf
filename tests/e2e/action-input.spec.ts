import { expect, test } from "./fixtures.ts";
import type { Page } from "@playwright/test";
import { openWorld, placePlayer, readWorld } from "./world.ts";
import { ready, uiCenter } from "./ui.ts";
import { waitFor, waitFrames, waitTicks } from "./time.ts";
import { evidenceShot } from "./evidence.ts";

async function equip(page: Page, kind: string) {
  await readWorld(page, (world, kind) => {
    world.edit({
      players: [{
        id: world.scene.localId,
        inventory: [{ kind, count: 8 }],
        held: kind,
      }],
    });
  }, kind);
  await waitFrames(page);
}
const gesture = (page: Page) =>
  readWorld(page, (w) => ({ ...w.scene.actionGesture }));
const inventory = (page: Page, kind: string) =>
  readWorld(
    page,
    (w, kind) => w.scene.inventory.find((s) => s.kind === kind)?.count ?? 0,
    kind,
  );
async function setup(page: Page, gamepad = false) {
  await openWorld(page, `/?harness=1${gamepad ? "&gamepad-debug=1" : ""}`);
  await ready(page);
  await placePlayer(page, 6, 6, 1);
  await waitFrames(page);
}

test("keyboard places once on release and cancels for panels and focus loss", async ({ page }) => {
  await setup(page);
  await equip(page, "stone");
  const start = await inventory(page, "stone");
  await page.keyboard.down("Space");
  await waitTicks(page, 8);
  expect(await inventory(page, "stone")).toBe(start);
  expect((await gesture(page)).down).toBe(true);
  await page.keyboard.up("Space");
  await waitTicks(page, 2);
  expect(await inventory(page, "stone")).toBe(start - 1);
  await page.keyboard.down("Space");
  await page.keyboard.press("b");
  await page.keyboard.up("Space");
  await waitFrames(page);
  expect((await gesture(page)).down).toBe(false);
  expect(await inventory(page, "stone")).toBe(start - 1);
  await page.keyboard.press("b");
  await page.keyboard.down("Space");
  await page.evaluate(() => globalThis.dispatchEvent(new Event("blur")));
  await page.keyboard.up("Space");
  await waitFrames(page);
  expect(await inventory(page, "stone")).toBe(start - 1);
  await evidenceShot(page, "132-keyboard-release-placement");
});

test("keyboard aim is temporary, independent of walking, and cancels at neutral", async ({ page }) => {
  await setup(page);
  await equip(page, "coin");
  await page.keyboard.down("Space");
  await page.keyboard.down("i");
  await page.keyboard.down("d");
  await waitTicks(page, 2);
  expect(await readWorld(page, (w) => ({ ...w.scene.aim }))).toEqual({
    x: 0,
    y: -1,
  });
  expect((await gesture(page)).aiming).toBe(true);
  expect(await readWorld(page, (w) => w.scene.world.players[w.scene.localId].y))
    .toBeGreaterThan(6);
  await page.keyboard.up("i");
  await waitFrames(page);
  expect((await gesture(page)).everAimed).toBe(true);
  expect((await gesture(page)).aiming).toBe(false);
  await page.keyboard.up("Space");
  await waitFrames(page);
  expect(await readWorld(page, (w) => ({ ...w.scene.aim }))).toEqual({
    x: 0,
    y: 1,
  });
  expect(await inventory(page, "coin")).toBe(8);
  await page.keyboard.up("d");
});

test("gamepad ZR arms, right stick aims, neutral cancels, disconnect interrupts", async ({ page }) => {
  await page.addInitScript(() => {
    const pad = {
      connected: true,
      index: 0,
      mapping: "standard",
      id: "Input test pad",
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false })),
    };
    Object.defineProperty(navigator, "getGamepads", {
      value: () => pad.connected ? [pad] : [],
    });
    Object.assign(globalThis, { __inputPad: pad });
  });
  await setup(page, true);
  await equip(page, "coin");
  const pad = async (
    change: { down?: boolean; aim?: number; connected?: boolean; id?: string },
  ) => {
    await page.evaluate((change) => {
      const p = (globalThis as unknown as {
        __inputPad: {
          connected: boolean;
          id: string;
          axes: number[];
          buttons: { pressed: boolean }[];
        };
      }).__inputPad;
      if (change.id !== undefined) p.id = change.id;
      if (change.down !== undefined) p.buttons[7].pressed = change.down;
      if (change.aim !== undefined) p.axes[3] = change.aim;
      if (change.connected !== undefined) p.connected = change.connected;
    }, change);
    await waitFrames(page, 3);
  };
  await pad({ down: true, aim: -1 });
  expect((await gesture(page)).aiming).toBe(true);
  await pad({ aim: 0 });
  expect((await gesture(page)).everAimed).toBe(true);
  await pad({ down: false });
  expect(await inventory(page, "coin")).toBe(8);
  await pad({ down: true, aim: -1 });
  await pad({ connected: false });
  expect((await gesture(page)).down).toBe(false);
  await pad({ connected: true });
  expect((await gesture(page)).down).toBe(false);
  await pad({ down: false });
  expect(await inventory(page, "coin")).toBe(8);
  await pad({ down: true, aim: -1 });
  expect((await gesture(page)).aiming).toBe(true);
  await pad({ down: false });
  await waitTicks(page, 2);
  expect(await inventory(page, "coin")).toBe(7);
  await pad({ down: true, aim: -1 });
  await pad({ id: "Replacement test pad" });
  expect((await gesture(page)).down).toBe(false);
  await pad({ down: false });
  expect(await inventory(page, "coin")).toBe(7);
  await pad({ down: true });
  expect((await gesture(page)).down).toBe(true);
  await pad({ down: false });
  await waitTicks(page, 2);
  expect(await inventory(page, "coin")).toBe(6);
  const z = await readWorld(page, (w) => w.scene.viewZ);
  await page.keyboard.press("r");
  await page.keyboard.press("v");
  expect(await readWorld(page, (w) => w.scene.viewZ)).toBe(z);
});

test.describe("touch", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("movement and release placement coexist with two fingers", async ({ page, context }) => {
    await setup(page);
    await equip(page, "stone");
    const move = await uiCenter(page, "stick:move");
    const action = await uiCenter(page, "btn:interact");
    const cdp = await context.newCDPSession(page);
    const finger = (id: number, x: number, y: number) => ({ id, x, y });
    const left = finger(1, move.x, move.y + 30);
    const right = finger(2, action.x, action.y);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [left],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [left, right],
    });
    await waitTicks(page, 2);
    expect((await gesture(page)).down).toBe(true);
    expect(await inventory(page, "stone")).toBe(8);
    await waitFor(
      page,
      async () =>
        await readWorld(page, (w) => w.scene.world.players[w.scene.localId].y) >
          6,
      { maxTicks: 20, message: "touch movement" },
    );
    // Reset the moving footprint to a tile center so this checks release input,
    // without racing the host occupancy refusal at a tile boundary.
    await placePlayer(page, 6, 6);
    // CDP ends the supplied pointer: lift action while movement stays held.
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [right],
    });
    await waitTicks(page, 2);
    expect(await inventory(page, "stone")).toBe(7);
    expect((await gesture(page)).down).toBe(false);
    expect(await readWorld(page, (w) => w.ui.state.sticks.move.active)).toBe(
      true,
    );
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await waitTicks(page, 2);
    expect(await inventory(page, "stone")).toBe(7);
    await evidenceShot(page, "132-touch-move-release");
    await cdp.detach();
  });
});
