import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { clickUi, ready, uiRect } from "./ui.ts";

type Play = { tags: string[]; key: string; rate: number; gain: number };
type Odd = {
  __od: {
    sfx: {
      state(): {
        status: string;
        samples: number;
        loaded: number;
        level: string;
      };
      log: Play[];
    };
  };
};

const state = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Odd).__od.sfx.state());
const plays = (page: Page) =>
  page.evaluate(() => [...(globalThis as unknown as Odd).__od.sfx.log]);

test("opening the bag plays ui open, skipping the missing sample, and a reload uses the cache", async ({ page }) => {
  await page.goto("/?harness=1&sfx=1");
  await ready(page);
  await page.mouse.click(640, 400);
  await expect.poll(async () => (await state(page)).loaded).toBe(3);
  expect((await state(page)).samples).toBe(4);
  await page.keyboard.press("KeyB");
  await expect.poll(async () => (await plays(page)).map((p) => p.tags))
    .toContainEqual(["ui", "open"]);
  const open = (await plays(page)).find((p) => p.tags[1] === "open")!;
  expect(open.key).toBe("sfx/tock.ogg");
  expect(open.rate).toBeGreaterThanOrEqual(0.9);
  expect(open.rate).toBeLessThanOrEqual(1.1);
  expect(open.gain).toBeGreaterThanOrEqual(0.8);

  const downloads: string[] = [];
  page.on("request", (request) => {
    // The missing sample has no cached copy, so every load asks for it again.
    if (
      request.url().includes("/media/sfx/") &&
      !request.url().includes("missing")
    ) downloads.push(request.url());
  });
  await page.reload();
  await ready(page);
  await page.mouse.click(640, 400);
  await expect.poll(async () => (await state(page)).loaded).toBe(3);
  await page.waitForTimeout(300);
  expect(downloads).toEqual([]);
});

test("the Effects setting persists, and F3 shows the effects line", async ({ page }) => {
  await page.goto("/?harness=1&sfx=1");
  await ready(page);
  await page.keyboard.press("Escape");
  await clickUi(page, "btn:settings");
  expect((await state(page)).level).toBe("75");
  await evidenceShot(page, "effects-row-default");
  await clickUi(page, "btn:effects:50");
  expect(await page.evaluate(() => localStorage.getItem("open-dwarf-effects")))
    .toBe("50");
  await evidenceShot(page, "effects-row-50");
  await page.reload();
  await ready(page);
  expect((await state(page)).level).toBe("50");
  await page.mouse.click(640, 400);
  await expect.poll(async () => (await state(page)).loaded).toBe(3);
  await page.keyboard.press("F3");
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { ui: { state: { diagnosticsOpen: boolean } } };
      }).__od.ui.state.diagnosticsOpen
    )
  ).toBe(true);
  await evidenceShot(page, "effects-f3-line");
});

test("sfx=0 and an Off setting download nothing", async ({ page }) => {
  const downloads: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/media/sfx/") || request.url().includes("sfx.v1")
    ) {
      downloads.push(request.url());
    }
  });
  await page.goto("/?harness=1&sfx=0");
  await ready(page);
  await page.mouse.click(640, 400);
  await page.keyboard.press("KeyB");
  await page.waitForTimeout(500);
  expect(downloads).toEqual([]);
  expect(await plays(page)).toEqual([]);

  await page.evaluate(() => localStorage.setItem("open-dwarf-effects", "off"));
  await page.goto("/?harness=1&sfx=1");
  await ready(page);
  await page.mouse.click(640, 400);
  await page.keyboard.press("KeyB");
  await page.waitForTimeout(500);
  expect(downloads).toEqual([]);
  expect(await plays(page)).toEqual([]);
  expect((await state(page)).status).toBe("off");
});

test("a harness page is silent unless sfx=1", async ({ page }) => {
  const downloads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/media/sfx/")) downloads.push(request.url());
  });
  await page.goto("/?harness=1");
  await ready(page);
  await page.mouse.click(640, 400);
  await page.waitForTimeout(500);
  expect(downloads).toEqual([]);
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });
  test("the Effects row fits the settings menu", async ({ page }) => {
    await page.goto("/?harness=1&sfx=1");
    await ready(page);
    await page.keyboard.press("Escape");
    await clickUi(page, "btn:settings");
    await evidenceShot(page, "effects-row-phone");
    const back = await uiRect(page, "btn:back");
    const effects = await uiRect(page, "btn:effects:50");
    const music = await uiRect(page, "btn:music:50");
    expect(music.y + music.h).toBeLessThanOrEqual(effects.y);
    expect(effects.y).toBeLessThan(back.y);
    expect(back.y + back.h).toBeLessThanOrEqual(390);
  });
});
