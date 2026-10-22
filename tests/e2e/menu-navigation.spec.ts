import { dropItems, giveItems, placePlayer, setTile } from "./world.ts";
import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { holdUntil, waitFor, waitFrames, waitTicks } from "./time.ts";
import { hasUi, heldSlot, ready, say, shopOpen, tapUi, uiRect } from "./ui.ts";
// Every menu shares one navigation model: ESDF keeps walking, IJKL choose,
// Space confirms, and Q, Escape, controller B, or the touch Back button go
// back one level.
// Ulgar stands at (16, 12); a player talks to it from a neighboring tile.
const SHOP = { x: 16, y: 12 };
const STONE = 2;
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
/** Hold each look key for some frames: the menu takes them, so the world aim stays still. */
async function holdLookKeys(page: Page) {
  for (const key of ["i", "k", "j", "l"]) {
    await page.keyboard.down(key);
    await waitFrames(page, 3);
    expect((await sceneState(page)).aim).toEqual({ x: 0, y: 0 });
    await page.keyboard.up(key);
  }
}
const STONE_TILE = { x: 4, y: 3 };
/** Put stone south of the player at (4, 2), the tile "k" aims at. */
const placeStone = (page: Page) =>
  setTile(page, STONE_TILE.x, STONE_TILE.y, 0, STONE);
const stoneTile = (page: Page) =>
  readWorld(
    page,
    (__world, [x, y]) =>
      __world.scene.world.chunks.get("0,0")?.[y * 16 + x] ?? -1,
    [STONE_TILE.x, STONE_TILE.y],
  );
/** Confirm with the aim held on the stone: the menu acts on it and nothing is mined. */
async function expectNoMining(page: Page, confirm: () => Promise<void>) {
  await page.keyboard.down("k");
  await confirm();
  await waitTicks(page, 6);
  await page.keyboard.up("k");
  expect((await sceneState(page)).mining).toBe(0);
  expect(await stoneTile(page)).toBe(STONE);
}
/** Open Ulgar's shop from the tile south of it. */
async function openShop(page: Page) {
  await placePlayer(page, SHOP.x, SHOP.y + 1);
  await waitFrames(page, 2);
  await page.keyboard.down("i");
  await page.keyboard.press("Space");
  await page.keyboard.up("i");
  await expect.poll(() => shopOpen(page)).toBe(true);
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
  // IJKL never aim while a menu is open, and a confirm with the aim on stone does not mine.
  await holdLookKeys(page);
  await placeStone(page);
  await expectNoMining(page, () => page.keyboard.press("Space"));
  expect((await sceneState(page)).page).toBe("settings");
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
  // ESDF also walks with the Escape menu's first page open.
  expect(await walkWest(page)).toBeGreaterThanOrEqual(1);
  expect((await sceneState(page)).menu).toBe(true);
  await page.keyboard.press("q");
  await expect.poll(async () => (await sceneState(page)).menu).toBe(false);
});

test("with the bag open the player walks with ESDF and Q closes it", async ({ page }) => {
  await startHost(page);
  await placePlayer(page, 4, 2);
  await giveItems(page, "coal", 3);
  await placeStone(page);
  await page.keyboard.press("b");
  await expect.poll(() => bagOpen(page)).toBe(true);
  await holdLookKeys(page);
  // A confirm with the pickaxe held and stone aimed at holds the item; it does not mine.
  await expectNoMining(page, () => page.keyboard.press("Space"));
  await page.keyboard.press("l");
  await page.keyboard.press("Space");
  await expect.poll(() => heldSlot(page)).toBe("coal");
  expect(await walkWest(page)).toBeGreaterThanOrEqual(1);
  expect(await bagOpen(page)).toBe(true);
  await page.keyboard.press("q");
  await expect.poll(() => bagOpen(page)).toBe(false);
  expect((await sceneState(page)).menu).toBe(false);
});

test("with the pickup grid open the player walks with ESDF and Q closes it", async ({ page }) => {
  await startHost(page);
  await openGrid(page);
  await holdLookKeys(page);
  expect(await walkWest(page)).toBeGreaterThanOrEqual(1);
  expect(await gridOpen(page)).toBe(true);
  await page.keyboard.press("q");
  await expect.poll(() => gridOpen(page)).toBe(false);
  expect((await sceneState(page)).menu).toBe(false);
});

test("with the shop open the player walks with ESDF, the panel closes out of range, and Q closes it", async ({ page }) => {
  await startHost(page, "&layout=room");
  await giveItems(page, "coal", 2);
  await openShop(page);
  await page.keyboard.up("Space");
  await holdLookKeys(page);
  // A confirm sells the selected row and does not mine.
  await page.keyboard.press("Space");
  await expect.poll(async () => {
    const stacks = await readWorld(page, (w) => w.scene.inventory);
    return stacks.find((stack) => stack.kind === "coin")?.count ?? 0;
  }).toBe(2);
  // ESDF walks along the wall to a tile still next to Ulgar, and the panel stays open.
  await holdUntil(
    page,
    "f",
    async () => (await position(page))!.x >= SHOP.x + 1,
  );
  await expect.poll(async () => (await position(page))?.move ?? null)
    .toBeNull();
  expect(await shopOpen(page)).toBe(true);
  await evidenceShot(page, "shop-walking");
  // One more tile and Ulgar is out of range: the panel closes.
  await holdUntil(
    page,
    "f",
    async () => (await position(page))!.x >= SHOP.x + 2,
  );
  await expect.poll(() => shopOpen(page)).toBe(false);
  // Back in range, it opens again and Q closes it.
  await placePlayer(page, SHOP.x, SHOP.y + 1);
  await waitFrames(page, 2);
  await page.keyboard.down("i");
  await page.keyboard.press("Space");
  await page.keyboard.up("i");
  await expect.poll(() => shopOpen(page)).toBe(true);
  await page.keyboard.press("q");
  await expect.poll(() => shopOpen(page)).toBe(false);
});

test("a Space repeat does not choose in the menu it just opened", async ({ page }) => {
  await startHost(page);
  await page.keyboard.press("Escape");
  await page.keyboard.press("k");
  // Space opens Settings and stays down; its key repeat must not choose the Back row.
  // (The fresh-press gate itself is covered by unit tests: no input path reaches it yet.)
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
  await placeStone(page);
  // ZR confirms in the bag with the aim on stone: it holds the item and mines nothing.
  await expectNoMining(page, () => pad.press(ZR));
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
  await waitFor(page, async () => (await position(page))!.x < startX - 0.5, {
    message: "the left stick walking",
  });
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
  // B closes the pickup grid too, without zooming out.
  await placePlayer(page, 4, 2);
  await openGrid(page);
  await pad.press(B);
  await expect.poll(() => gridOpen(page)).toBe(false);
  await waitFrames(page, 5);
  expect(await readWorld(page, (__world) => __world.scene.zoomTarget)).toBe(
    zoom,
  );
});

test("in master view a menu stops IJKL from panning the camera", async ({ page }) => {
  await startHost(page);
  await say(page, "/master");
  await expect.poll(() => readWorld(page, (__world) => __world.scene.viewMode))
    .toBe("master");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await sceneState(page)).menu).toBe(true);
  await waitFrames(page, 3);
  const before = (await sceneState(page)).camera;
  await page.keyboard.down("l");
  await waitFrames(page, 10);
  await page.keyboard.up("l");
  expect((await sceneState(page)).camera).toEqual(before);
  // With the menu closed the same key pans.
  await page.keyboard.press("q");
  await expect.poll(async () => (await sceneState(page)).menu).toBe(false);
  await page.keyboard.down("l");
  await waitFrames(page, 10);
  await page.keyboard.up("l");
  expect((await sceneState(page)).camera.x).toBeGreaterThan(before.x);
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
