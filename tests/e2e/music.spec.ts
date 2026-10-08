import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { clickUi, ready, uiRect } from "./ui.ts";

type MusicState = {
  status: string;
  track: string | null;
  skipped: string[];
  cachedTracks: number;
  level: string;
};
type Odd = {
  __od: {
    music: {
      state(): MusicState;
      setMood(tags: string[]): void;
      setRandom(source: () => number): void;
    };
  };
};

const state = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Odd).__od.music.state());
const random = (page: Page, value: number) =>
  page.evaluate(
    (v) => (globalThis as unknown as Odd).__od.music.setRandom(() => v),
    value,
  );

test("music plays after a tap, skips the missing track, and replays from the device cache", async ({ page }) => {
  await page.goto("/?harness=1&music=1");
  await ready(page);
  // The fixture lists A, B and a missing track; 0.99 picks the missing one first.
  await random(page, 0.99);
  expect((await state(page)).track).toBeNull();
  await page.mouse.click(640, 400);
  await expect.poll(async () => (await state(page)).status).toBe("playing");
  const first = await state(page);
  expect(first.skipped).toEqual(["music/Missing.ogg"]);
  expect(first.track).toMatch(/^music\/Tone[AB]\.ogg$/);
  await expect.poll(async () => (await state(page)).cachedTracks)
    .toBeGreaterThanOrEqual(1);

  // A reload: a mood only ToneA fits, played from the cache with no download.
  const downloads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/media/music/")) downloads.push(request.url());
  });
  await page.reload();
  await ready(page);
  await page.evaluate(() =>
    (globalThis as unknown as Odd).__od.music.setMood(["soft"])
  );
  await random(page, 0);
  await page.mouse.click(640, 400);
  await expect.poll(async () => (await state(page)).track).toBe(
    "music/ToneA.ogg",
  );
  await page.waitForTimeout(500);
  expect(downloads).toEqual([]);
});

test("the volume setting persists, and F3 shows the music line", async ({ page }) => {
  await page.goto("/?harness=1&music=1");
  await ready(page);
  await page.keyboard.press("Escape");
  await clickUi(page, "btn:settings");
  await evidenceShot(page, "music-volume-default");
  await clickUi(page, "btn:music:75");
  await evidenceShot(page, "music-volume-menu");
  expect(await page.evaluate(() => localStorage.getItem("open-dwarf-music")))
    .toBe("75");
  await page.reload();
  await ready(page);
  expect((await state(page)).level).toBe("75");
  await page.keyboard.press("Escape");
  await clickUi(page, "btn:settings");
  await page.keyboard.press("Escape");
  await page.mouse.click(640, 400);
  await expect.poll(async () => (await state(page)).status).toBe("playing");
  await page.keyboard.press("F3");
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { ui: { state: { diagnosticsOpen: boolean } } };
      }).__od.ui.state.diagnosticsOpen
    )
  ).toBe(true);
  await evidenceShot(page, "music-f3-line");
});

test("a harness page is silent unless music=1, and music=0 keeps it off", async ({ page }) => {
  await page.goto("/?harness=1");
  await ready(page);
  await page.mouse.click(640, 400);
  await page.waitForTimeout(500);
  expect((await state(page)).track).toBeNull();
  await page.goto("/?harness=1&music=0");
  await ready(page);
  await page.mouse.click(640, 400);
  await page.waitForTimeout(500);
  expect((await state(page)).track).toBeNull();
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });
  test("the music row fits the settings menu", async ({ page }) => {
    await page.goto("/?harness=1&music=1");
    await ready(page);
    await page.keyboard.press("Escape");
    await clickUi(page, "btn:settings");
    await evidenceShot(page, "music-volume-phone");
    const back = await uiRect(page, "btn:back");
    const music = await uiRect(page, "btn:music:50");
    expect(music.y).toBeLessThan(back.y);
    expect(back.y + back.h).toBeLessThanOrEqual(390);
  });
});
