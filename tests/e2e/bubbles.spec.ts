import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";

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
  for (const line of lines) {
    await page.keyboard.press("t");
    await page.locator("#chat-input").fill(line);
    await page.locator("#chat-input").press("Enter");
  }
}

/** Clicks a settings row using the menu panel's 320 px wide, 300 px tall layout. */
async function clickMenu(page: Page, x: number, y: number) {
  const size = page.viewportSize()!;
  const top = (size.height - Math.min(300, size.height - 20)) / 2;
  await page.mouse.click(size.width / 2 + x, top + y);
}

async function chooseTextSize(page: Page, size: "small" | "medium" | "large") {
  await page.keyboard.press("Escape");
  await clickMenu(page, 0, 90);
  await clickMenu(page, { small: -90, medium: 0, large: 90 }[size], 180);
  await expect.poll(() =>
    page.evaluate(() => (globalThis as unknown as Odd).__od.scene.textSize)
  ).toBe(size);
  await clickMenu(page, 0, 225);
  await page.keyboard.press("Escape");
}

test("three quick messages show three stacked bubbles on the host and a nearby guest", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    await host.goto("/?harness=1");
    await expect(host.locator("#loading")).toBeHidden();
    const session = await host.evaluate(() =>
      (globalThis as unknown as Odd).__od.scene.sessionId
    );
    await guest.goto(`/join/${session}?harness=1`);
    await expect(guest.locator("#loading")).toBeHidden();
    await expect.poll(() =>
      guest.evaluate(() => (globalThis as unknown as Odd).__od.scene.localId)
    ).toMatch(/^peer-/);
    await say(host, messages);
    await expect.poll(() =>
      guest.evaluate(() =>
        (globalThis as unknown as Odd).__od.scene.chatFeed.find((record) =>
          record.id === "self"
        )?.bubbles?.map((bubble) => bubble.text)
      )
    ).toEqual(messages);
    await say(host, ["a fourth message"]);
    await expect.poll(() =>
      guest.evaluate(() =>
        (globalThis as unknown as Odd).__od.scene.chatFeed.find((record) =>
          record.id === "self"
        )?.bubbles?.map((bubble) => bubble.text)
      )
    ).toEqual([...messages.slice(1), "a fourth message"]);
    await evidenceShot(host, "stacked-bubbles-host");
    await evidenceShot(guest, "stacked-bubbles-guest");
  } finally {
    await Promise.all([host.close(), guest.close()]);
  }
});

test("text size changes bubble size and persists across reloads", async ({ page }) => {
  await page.goto("/?harness=1");
  await expect(page.locator("#loading")).toBeHidden();
  expect(
    await page.evaluate(() =>
      (globalThis as unknown as Odd).__od.scene.textSize
    ),
  ).toBe("medium");
  for (const size of ["small", "medium", "large"] as const) {
    await chooseTextSize(page, size);
    await say(page, messages);
    await page.waitForTimeout(300);
    await evidenceShot(page, `stacked-bubbles-${size}`);
    await page.waitForTimeout(5500);
  }
  await page.reload();
  await expect(page.locator("#loading")).toBeHidden();
  expect(
    await page.evaluate(() =>
      (globalThis as unknown as Odd).__od.scene.textSize
    ),
  ).toBe("large");
});
