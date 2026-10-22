import { dropItems, giveItems, placePlayer } from "./world.ts";
import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { holdUntil, waitFrames } from "./time.ts";
import { hasUi, ready, shopOpen, tapUi, uiRect } from "./ui.ts";
// Every menu shares one navigation model: ESDF keeps walking, IJKL choose,
// Space confirms, and Q, Escape, controller B, or the touch Back button go
// back one level.
const SHOP = { x: 16, y: 12 };
// The controller layout of ADR 0009, with the Nintendo Switch labels.
const B = 0;
const ZR = 7;
const position = (page: Page) =>
  readWorld(page, (__world) => {
    const scene = __world.scene;
    return scene.world.players[scene.localId];
  });
const sceneState = (page: Page) =>
  readWorld(page, (__world) => ({
    menu: __world.scene.menu as boolean,
    page: __world.scene.menuPage as string,
    aim: { ...__world.scene.aim } as { x: number; y: number },
    mining: (__world.scene.mining ?? []).length as number,
    camera: { ...__world.scene.camera } as { x: number; y: number },
  }));
const gridOpen = async (page: Page) =>
  (await readWorld(page, (__world) => __world.scene.pickupCells)).length > 0;
const bagOpen = (page: Page) => hasUi(page, "panel:bag");
/** Whether a menu button shows the selection outline. */
const selectedButton = (page: Page, id: string) =>
  readWorld(
    page,
    (__world, id) => Boolean(__world.ui.layout().byId.get(id)?.sel),
    id,
  );
/** Whether a settings row label shows the selection arrows. */
const selectedLabel = (page: Page, id: string) =>
  readWorld(
    page,
    (__world, id) =>
      (__world.ui.layout().byId.get(id)?.text ?? "").startsWith("<"),
    id,
  );
async function startHost(page: Page, query = "") {
  await openWorld(page, `/?harness=1${query}`);
  await ready(page);
}
/** Walk one tile west with S and wait for the walk to settle. */
async function walkWest(page: Page) {
  const startX = (await position(page))!.x;
  await holdUntil(
    page,
    "s",
    async () => (await position(page))!.x <= startX - 1,
  );
  await expect.poll(async () => (await position(page))?.move ?? null)
    .toBeNull();
  return startX - (await position(page))!.x;
}
/** Hold every look key for some frames and confirm: the menu takes them, not the world. */
async function lookAndConfirm(page: Page) {
  for (const key of ["i", "k", "j", "l"]) {
    await page.keyboard.down(key);
    await waitFrames(page, 3);
    const state = await sceneState(page);
    expect(state.aim).toEqual({ x: 0, y: 0 });
    expect(state.mining).toBe(0);
    await page.keyboard.up(key);
  }
}
async function openGrid(page: Page) {
  await placePlayer(page, 4, 2);
  await dropItems(page, 4, 3, "coal", 1);
  await dropItems(page, 4, 3, "lapis", 2);
  await page.keyboard.down("k");
  await page.keyboard.press("Space");
  await page.keyboard.up("k");
  await expect.poll(() => gridOpen(page)).toBe(true);
  await page.keyboard.up("Space");
}

test("with Settings open the player walks with ESDF, Q goes back one level, and the parent selection stays", async ({ page }) => {
  await startHost(page);
  await placePlayer(page, 4, 2);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await sceneState(page)).menu).toBe(true);
  expect(await selectedButton(page, "btn:resume")).toBe(true);
  // K selects the Settings row, and Space opens it.
  await page.keyboard.press("k");
  await expect.poll(() => selectedButton(page, "btn:settings")).toBe(true);
  await page.keyboard.press("Space");
  await expect.poll(async () => (await sceneState(page)).page).toBe("settings");
  // A page opened by the confirm needs its own fresh press, and the first row is selected.
  await expect.poll(() => selectedLabel(page, "text:menu-ui-scale")).toBe(true);
  await evidenceShot(page, "settings-selection");
  // K and I choose a row, and J and L change its value.
  await page.keyboard.press("k");
  await expect.poll(() => selectedLabel(page, "text:menu-text-size")).toBe(
    true,
  );
  const scaleBefore = await readWorld(page, (__world) => __world.scene.uiScale);
  await page.keyboard.press("i");
  await page.keyboard.press("l");
  await expect.poll(() => readWorld(page, (__world) => __world.scene.uiScale))
    .toBeGreaterThan(scaleBefore);
  // IJKL never aim, mine, or pan the camera while a menu is open.
  const cameraBefore = (await sceneState(page)).camera;
  await lookAndConfirm(page);
  expect((await sceneState(page)).camera).toEqual(cameraBefore);
  // ESDF keeps moving the player with Settings open.
  expect(await walkWest(page)).toBeGreaterThanOrEqual(1);
  expect((await sceneState(page)).page).toBe("settings");
  await evidenceShot(page, "settings-walking");
  // Q backs out one level at a time, and Settings stays selected in the menu.
  await page.keyboard.press("q");
  await expect.poll(async () => (await sceneState(page)).page).toBe("root");
  expect((await sceneState(page)).menu).toBe(true);
  expect(await selectedButton(page, "btn:settings")).toBe(true);
  await evidenceShot(page, "menu-parent-selection");
  await page.keyboard.press("q");
  await expect.poll(async () => (await sceneState(page)).menu).toBe(false);
});

test("with the bag open the player walks with ESDF and Q closes it", async ({ page }) => {
  await startHost(page);
  await placePlayer(page, 4, 2);
  await giveItems(page, "coal", 3);
  await page.keyboard.press("b");
  await expect.poll(() => bagOpen(page)).toBe(true);
  await lookAndConfirm(page);
  expect(await walkWest(page)).toBeGreaterThanOrEqual(1);
  expect(await bagOpen(page)).toBe(true);
  await page.keyboard.press("q");
  await expect.poll(() => bagOpen(page)).toBe(false);
  expect((await sceneState(page)).menu).toBe(false);
});

test("with the pickup grid open the player walks with ESDF and Q closes it", async ({ page }) => {
  await startHost(page);
  await openGrid(page);
  await lookAndConfirm(page);
  expect(await walkWest(page)).toBeGreaterThanOrEqual(1);
  expect(await gridOpen(page)).toBe(true);
  await page.keyboard.press("q");
  await expect.poll(() => gridOpen(page)).toBe(false);
  expect((await sceneState(page)).menu).toBe(false);
});

test("with the shop open the player walks with ESDF and Q closes it", async ({ page }) => {
  await startHost(page, "&layout=room");
  await placePlayer(page, SHOP.x, SHOP.y);
  await giveItems(page, "coal", 2);
  await waitFrames(page, 2);
  await page.keyboard.press("Space");
  await expect.poll(() => shopOpen(page)).toBe(true);
  await page.keyboard.up("Space");
  await lookAndConfirm(page);
  // ESDF walks south off the shopkeeper's tile, and the panel stays open.
  const startY = (await position(page))!.y;
  await holdUntil(
    page,
    "d",
    async () => (await position(page))!.y >= startY + 1,
  );
  expect(await shopOpen(page)).toBe(true);
  await evidenceShot(page, "shop-walking");
  await page.keyboard.press("q");
  await expect.poll(() => shopOpen(page)).toBe(false);
});

test("a held confirm cannot choose in the menu it just opened", async ({ page }) => {
  await startHost(page);
  await page.keyboard.press("Escape");
  await page.keyboard.press("k");
  // Space opens Settings and stays down; its repeat must not choose the Back row.
  await page.keyboard.down("Space");
  await expect.poll(async () => (await sceneState(page)).page).toBe("settings");
  await page.keyboard.press("i"); // wraps to the Back row
  await waitFrames(page, 3);
  await page.keyboard.down("Space");
  await waitFrames(page, 3);
  expect((await sceneState(page)).page).toBe("settings");
  await page.keyboard.up("Space");
  await page.keyboard.press("Space");
  await expect.poll(async () => (await sceneState(page)).page).toBe("root");
});

test("a controller moves with the left stick, chooses with the right stick, and B backs out one level", async ({ page }) => {
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
    (globalThis as unknown as { __pad: typeof pad }).__pad = pad;
  });
  const pad = {
    press: (button: number) =>
      page.evaluate((b) =>
        new Promise<void>((resolve) => {
          const p = (globalThis as unknown as {
            __pad: { buttons: { pressed: boolean }[] };
          }).__pad;
          p.buttons[b].pressed = true;
          requestAnimationFrame(() => {
            p.buttons[b].pressed = false;
            requestAnimationFrame(() => resolve());
          });
        }), button),
    stick: (x: number, y: number, axes: [number, number]) =>
      page.evaluate(([ax, ay, [i, j]]) => {
        const p = (globalThis as unknown as { __pad: { axes: number[] } })
          .__pad;
        p.axes[i] = ax;
        p.axes[j] = ay;
      }, [x, y, axes] as const),
  };
  await startHost(page, "&gamepad-debug=1");
  await placePlayer(page, 4, 2);
  await waitFrames(page, 2);
  // The bag opens by key, and B backs out of it.
  await page.keyboard.press("b");
  await expect.poll(() => bagOpen(page)).toBe(true);
  await pad.press(B);
  await expect.poll(() => bagOpen(page)).toBe(false);
  // The menu: B goes back one level at a time, and the right stick chooses a row.
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await sceneState(page)).menu).toBe(true);
  await pad.stick(0, 1, [2, 3]);
  await waitFrames(page, 2);
  await pad.stick(0, 0, [2, 3]);
  await expect.poll(() => selectedButton(page, "btn:settings")).toBe(true);
  await pad.press(ZR);
  await expect.poll(async () => (await sceneState(page)).page).toBe("settings");
  // The left stick walks while the menu is open.
  const startX = (await position(page))!.x;
  await pad.stick(-1, 0, [0, 1]);
  await expect.poll(async () => (await position(page))!.x).toBeLessThan(
    startX - 0.5,
  );
  await pad.stick(0, 0, [0, 1]);
  expect((await sceneState(page)).page).toBe("settings");
  await pad.press(B);
  await expect.poll(async () => (await sceneState(page)).page).toBe("root");
  expect((await sceneState(page)).menu).toBe(true);
  await pad.press(B);
  await expect.poll(async () => (await sceneState(page)).menu).toBe(false);
  // The B that went back did not zoom out.
  const zoom = await readWorld(page, (__world) => __world.scene.zoomTarget);
  await waitFrames(page, 5);
  expect(await readWorld(page, (__world) => __world.scene.zoomTarget)).toBe(
    zoom,
  );
});

test("on a phone the Back button shows while a menu is open and goes back one level", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 780 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const phone = await context.newPage();
  try {
    await startHost(phone);
    expect(await hasUi(phone, "btn:nav-back")).toBe(false);
    await tapUi(phone, "btn:menu");
    await expect.poll(() => hasUi(phone, "btn:nav-back")).toBe(true);
    await evidenceShot(phone, "phone-menu-back");
    await tapUi(phone, "btn:settings");
    await expect.poll(async () => (await sceneState(phone)).page).toBe(
      "settings",
    );
    await evidenceShot(phone, "phone-settings-back");
    // The first Back goes up to the menu; the second returns to the world.
    await tapUi(phone, "btn:nav-back");
    await expect.poll(async () => (await sceneState(phone)).page).toBe("root");
    expect((await sceneState(phone)).menu).toBe(true);
    expect(await selectedButton(phone, "btn:settings")).toBe(true);
    await tapUi(phone, "btn:nav-back");
    await expect.poll(async () => (await sceneState(phone)).menu).toBe(false);
    await expect.poll(() => hasUi(phone, "btn:nav-back")).toBe(false);
    // With the bag open the same button closes it, and it stays inside the safe area.
    await tapUi(phone, "btn:bag");
    await expect.poll(() => bagOpen(phone)).toBe(true);
    const back = await uiRect(phone, "btn:nav-back");
    expect(back.x).toBeGreaterThanOrEqual(0);
    expect(back.y).toBeGreaterThanOrEqual(0);
    await evidenceShot(phone, "phone-bag-back");
    await tapUi(phone, "btn:nav-back");
    await expect.poll(() => bagOpen(phone)).toBe(false);
    await expect.poll(() => hasUi(phone, "btn:nav-back")).toBe(false);
  } finally {
    await context.close();
  }
});
