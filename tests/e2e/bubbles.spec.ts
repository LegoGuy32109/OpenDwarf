import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { clickUi, ready, say as sayLine } from "./ui.ts";

type Odd = {
  __od: {
    scene: {
      sessionId: string;
      localId: string;
      textSize: string;
      chatFeed: {
        id: string;
        text?: string;
        bubbles?: { text: string }[];
      }[];
    };
  };
};

const messages = [
  "Found iron down here",
  "Anyone have a pickaxe?",
  "Meet at the stairs",
];

async function say(page: Page, lines: string[]) {
  for (const line of lines) await sayLine(page, line);
}

async function chooseTextSize(page: Page, size: "small" | "medium" | "large") {
  await page.keyboard.press("Escape");
  await clickUi(page, "btn:settings");
  await clickUi(page, `btn:size:${size}`);
  await expect.poll(() =>
    page.evaluate(() => (globalThis as unknown as Odd).__od.scene.textSize)
  ).toBe(size);
  await clickUi(page, "btn:back");
  await page.keyboard.press("Escape");
}

test("three quick messages show three stacked bubbles on the host and a nearby guest", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    await host.goto("/?harness=1");
    await ready(host);
    const session = await host.evaluate(() =>
      (globalThis as unknown as Odd).__od.scene.sessionId
    );
    await guest.goto(`/join/${session}?harness=1`);
    await ready(guest);
    await expect.poll(() =>
      guest.evaluate(() => (globalThis as unknown as Odd).__od.scene.localId)
    ).toMatch(/^peer-/);
    await say(host, messages);
    // The host speaks one message at a time, so the three bubbles stack up as
    // each starts (ADR 0006).
    await expect.poll(
      () =>
        guest.evaluate(() =>
          (globalThis as unknown as Odd).__od.scene.chatFeed.find((record) =>
            record.id === "self"
          )?.bubbles?.map((bubble) => bubble.text)
        ),
      { timeout: 15_000 },
    ).toEqual(messages);
    await say(host, ["a fourth message"]);
    await expect.poll(
      () =>
        guest.evaluate(() =>
          (globalThis as unknown as Odd).__od.scene.chatFeed.find((record) =>
            record.id === "self"
          )?.bubbles?.map((bubble) => bubble.text)
        ),
      { timeout: 15_000 },
    ).toEqual([...messages.slice(1), "a fourth message"]);
    await evidenceShot(host, "stacked-bubbles-host");
    await evidenceShot(guest, "stacked-bubbles-guest");
  } finally {
    await Promise.all([host.close(), guest.close()]);
  }
});

test("text size changes bubble size and persists across reloads", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/?harness=1");
  await ready(page);
  expect(
    await page.evaluate(() =>
      (globalThis as unknown as Odd).__od.scene.textSize
    ),
  ).toBe("medium");
  for (const size of ["small", "medium", "large"] as const) {
    await chooseTextSize(page, size);
    await say(page, messages);
    // Each message starts when the last is spoken, so wait for the third.
    await page.waitForTimeout(5000);
    await evidenceShot(page, `stacked-bubbles-${size}`);
    await page.waitForTimeout(5500);
  }
  await page.reload();
  await ready(page);
  expect(
    await page.evaluate(() =>
      (globalThis as unknown as Odd).__od.scene.textSize
    ),
  ).toBe("large");
});
