import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import {
  chatDraft,
  expectChat,
  hasUi,
  ready,
  shopOpen,
  tapKeys,
  tapUi,
  uiCenter,
  uiRect,
  uiState,
} from "./ui.ts";

type Harness = {
  __od: {
    scene: {
      localId: string;
      zoomTarget: number;
      inventory: { kind: string; count: number }[];
      world: {
        players: Record<
          string,
          { x: number; y: number; message: string; typing: boolean }
        >;
      };
    };
  };
};

const scene = (page: Page) =>
  page.evaluate(() => {
    const { scene } = (globalThis as unknown as Harness).__od;
    const me = scene.world.players[scene.localId];
    return {
      message: me.message,
      typing: me.typing,
      zoomTarget: scene.zoomTarget,
    };
  });

/** Elements that take up room on the page, other than the page's own frame. */
const visibleElements = (page: Page) =>
  page.evaluate(() =>
    [...document.body.querySelectorAll("*")].filter((el) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return box.width > 2 && box.height > 2 && style.visibility !== "hidden" &&
        style.display !== "none";
    }).map((el) => el.tagName.toLowerCase())
  );

const noFocus = (page: Page) =>
  page.evaluate(() => ({
    active: document.activeElement?.tagName,
    fields: document.querySelectorAll(
      "input, textarea, select, [contenteditable]",
    ).length,
  }));

// iPhone-like safe areas: a notch and a home indicator in portrait, side cutouts in landscape.
const SCREENS = [
  { name: "portrait", width: 390, height: 844, safe: "47,0,34,0" },
  { name: "landscape", width: 844, height: 390, safe: "0,47,21,47" },
  { name: "landscape-wide", width: 932, height: 430, safe: "0,59,21,59" },
];

test("in play the only visible HTML element is the canvas", async ({ page }) => {
  await page.goto("/?harness=1&tools=1");
  await ready(page);
  expect(await visibleElements(page)).toEqual(["main", "canvas"]);
  // One hidden live region repeats the status text for a screen reader.
  await expect(page.locator("#live-status")).toHaveText(/Local world|world/);
  expect(await page.locator("#live-status").getAttribute("aria-live")).toBe(
    "polite",
  );
  expect(await noFocus(page)).toEqual({ active: "BODY", fields: 0 });
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  test("A opens the in-game keyboard, and typing hello then Send chats without any focus", async ({ page }) => {
    await page.goto("/?harness=1&safe=47,0,34,0");
    await ready(page);
    await tapUi(page, "btn:chat");
    await expectChat(page, true);
    await tapKeys(page, "hello");
    expect(await chatDraft(page)).toBe("hello");
    // Others see the typing bubble, and no element takes focus, so no system keyboard opens.
    await expect.poll(async () => (await scene(page)).typing).toBe(true);
    expect(await noFocus(page)).toEqual({ active: "BODY", fields: 0 });
    await tapUi(page, "key:send");
    await expect.poll(async () => (await scene(page)).message).toBe("hello");
    await expectChat(page, false);
    expect(await noFocus(page)).toEqual({ active: "BODY", fields: 0 });
  });

  test("shift, the symbols page, backspace, and the 120 character limit", async ({ page }) => {
    await page.goto("/?harness=1");
    await ready(page);
    await tapUi(page, "btn:chat");
    await tapUi(page, "key:shift");
    expect((await uiState(page)).chatShift).toBe(true);
    await tapKeys(page, "hi ");
    // Shift is one-shot: the second letter is lowercase.
    expect(await chatDraft(page)).toBe("Hi ");
    await tapUi(page, "key:page");
    await tapUi(page, "key:1");
    await tapUi(page, "key:/");
    expect(await chatDraft(page)).toBe("Hi 1/");
    await tapUi(page, "key:backspace");
    expect(await chatDraft(page)).toBe("Hi 1");
    await tapUi(page, "key:page");
    for (let i = 0; i < 130; i++) await tapUi(page, "key:a");
    expect((await chatDraft(page)).length).toBe(120);
    await tapUi(page, "key:close");
    await expectChat(page, false);
    // Close drops the draft.
    expect(await chatDraft(page)).toBe("");
  });

  test("two fingers press two keys at once", async ({ page }) => {
    await page.goto("/?harness=1");
    await ready(page);
    await tapUi(page, "btn:chat");
    await expectChat(page, true);
    const h = await uiCenter(page, "key:h");
    const i = await uiCenter(page, "key:i");
    const touch = await page.context().newCDPSession(page);
    const send = (
      type: "touchStart" | "touchEnd",
      points: { x: number; y: number; id: number }[],
    ) => touch.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    await send("touchStart", [{ ...h, id: 1 }]);
    await send("touchStart", [{ ...h, id: 1 }, { ...i, id: 2 }]);
    // Both keys show pressed while both fingers are down.
    expect(await chatDraft(page)).toBe("hi");
    await send("touchEnd", []);
  });

  test("a finger that starts on a control never joins a world pinch", async ({ page }) => {
    await page.goto("/?harness=1");
    await ready(page);
    const stick = await uiCenter(page, "stick:look");
    const touch = await page.context().newCDPSession(page);
    const send = (
      type: "touchStart" | "touchMove" | "touchEnd",
      points: { x: number; y: number; id: number }[],
    ) => touch.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    const world = { x: 100, y: 300 };
    await send("touchStart", [{ ...stick, id: 1 }]);
    await send("touchStart", [{ ...stick, id: 1 }, { ...world, id: 2 }]);
    await send("touchMove", [
      { x: stick.x + 20, y: stick.y, id: 1 },
      { x: world.x - 80, y: world.y, id: 2 },
    ]);
    await page.waitForTimeout(200);
    expect((await scene(page)).zoomTarget).toBe(1);
    await send("touchEnd", []);
    // Two fingers on the world still pinch.
    await send("touchStart", [{ x: 150, y: 300, id: 3 }, {
      x: 250,
      y: 300,
      id: 4,
    }]);
    await send("touchMove", [{ x: 80, y: 300, id: 3 }, {
      x: 320,
      y: 300,
      id: 4,
    }]);
    await expect.poll(async () => (await scene(page)).zoomTarget)
      .toBeGreaterThan(1.5);
    await send("touchEnd", []);
  });

  test("the UI scale setting grows the controls", async ({ page }) => {
    await page.goto("/?harness=1");
    await ready(page);
    const before = await uiRect(page, "icon:held");
    await tapUi(page, "btn:menu");
    await tapUi(page, "btn:settings");
    await tapUi(page, "btn:scale-up");
    await tapUi(page, "btn:scale-up");
    await tapUi(page, "btn:back");
    await tapUi(page, "btn:resume");
    expect(await hasUi(page, "panel:menu")).toBe(false);
    const after = await uiRect(page, "icon:held");
    expect(after.w).toBeGreaterThan(before.w);
  });

  for (const screen of SCREENS) {
    test(`the layout fits the safe area in ${screen.name}, with insets`, async ({ page }) => {
      await page.setViewportSize({
        width: screen.width,
        height: screen.height,
      });
      await page.goto(`/?harness=1&safe=${screen.safe}`);
      await ready(page);
      const [top, right, bottom, left] = screen.safe.split(",").map(Number);
      for (
        const id of [
          "stick:move",
          "stick:look",
          "btn:interact",
          "btn:sprint",
          "btn:chat",
          "btn:log",
          "btn:menu",
          "btn:bag",
          "btn:fullscreen",
          "icon:held",
          "text:status",
        ]
      ) {
        const rect = await uiRect(page, id);
        expect(rect.x, id).toBeGreaterThanOrEqual(left);
        expect(rect.y, id).toBeGreaterThanOrEqual(top);
        expect(rect.x + rect.w, id).toBeLessThanOrEqual(screen.width - right);
        expect(rect.y + rect.h, id).toBeLessThanOrEqual(screen.height - bottom);
      }
      await page.waitForTimeout(300);
      await evidenceShot(page, `ui-phone-${screen.name}`);
      await tapUi(page, "btn:chat");
      await expectChat(page, true);
      const keys = ["key:q", "key:p", "key:space", "key:send", "key:close"];
      for (const id of keys) {
        const rect = await uiRect(page, id);
        expect(rect.h, id).toBeGreaterThanOrEqual(36);
        expect(rect.x, id).toBeGreaterThanOrEqual(left);
        expect(rect.x + rect.w, id).toBeLessThanOrEqual(screen.width - right);
        expect(rect.y + rect.h, id).toBeLessThanOrEqual(screen.height - bottom);
      }
      await page.waitForTimeout(300);
      await evidenceShot(page, `ui-keyboard-${screen.name}`);
    });
  }

  test("evidence: chatting with the in-game keyboard", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/?harness=1&safe=47,0,34,0");
    await ready(page);
    await page.waitForTimeout(600);
    await tapUi(page, "btn:chat");
    await expectChat(page, true);
    await page.waitForTimeout(500);
    await tapUi(page, "key:shift");
    await tapKeys(page, "hello dwarf");
    await page.waitForTimeout(500);
    await evidenceShot(page, "keyboard-typing");
    await tapUi(page, "key:send");
    await expect.poll(async () => (await scene(page)).message).toBe(
      "Hello dwarf",
    );
    await page.waitForTimeout(1500);
    await evidenceShot(page, "keyboard-sent");
  });

  test("evidence: the inventory and shop panels on a phone", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/?harness=1&layout=room&safe=47,0,34,0");
    await ready(page);
    await page.evaluate(async () => {
      const items = await import("/src/shared/items.js");
      const { scene } = (globalThis as unknown as Harness).__od;
      const player = scene.world.players[scene.localId] as never;
      for (
        const [kind, count] of [["coal", 12], ["gold ore", 3], [
          "diamond",
          2,
        ], ["stone", 5]] as const
      ) items.addStack(items.inventoryOf(player), kind, count);
    });
    await page.waitForTimeout(500);
    await tapUi(page, "btn:bag");
    await expect.poll(() => hasUi(page, "panel:bag")).toBe(true);
    await page.waitForTimeout(700);
    await tapUi(page, "slot:diamond");
    await page.waitForTimeout(700);
    await evidenceShot(page, "inventory-panel-phone");
    await tapUi(page, "btn:bag-close");
    // Stand on the shopkeeper's tile, so interact opens the shop.
    await page.evaluate(() => {
      const { scene } = (globalThis as unknown as Harness).__od;
      Object.assign(scene.world.players[scene.localId], {
        x: 16,
        y: 12,
        previousX: 16,
        previousY: 12,
      });
    });
    await page.waitForTimeout(400);
    await tapUi(page, "btn:interact");
    await expect.poll(() => shopOpen(page)).toBe(true);
    await page.waitForTimeout(700);
    await evidenceShot(page, "shop-panel-phone");
    await tapUi(page, "row:gold ore");
    await page.waitForTimeout(700);
    await tapUi(page, "row:all");
    await expect.poll(async () =>
      (await page.evaluate(() =>
        (globalThis as unknown as Harness).__od.scene.inventory
      )).find((stack) => stack.kind === "coin")?.count
    ).toBe(24 + 12 + 40);
    await page.waitForTimeout(700);
    await evidenceShot(page, "shop-sold-phone");
    await tapUi(page, "btn:shop-close");
  });
});
