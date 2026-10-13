import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { clickUi, ready, say as sayLine } from "./ui.ts";
const messages = [
  "Found iron down here",
  "Anyone have a pickaxe?",
  "Meet at the stairs",
];
async function say(page: Page, lines: string[]) {
  for (const line of lines) {
    await sayLine(page, line);
  }
}
/** The bubble texts a page shows for its own player. */
const ownBubbles = (page: Page) =>
  readWorld(
    page,
    (__world) =>
      __world.scene.chatFeed.find((record) =>
        record.id === __world.scene.localId
      )?.bubbles?.map((bubble) => bubble.text) ?? [],
  );
async function chooseTextSize(page: Page, size: "small" | "medium" | "large") {
  await page.keyboard.press("Escape");
  await clickUi(page, "btn:settings");
  await clickUi(page, `btn:size:${size}`);
  await expect.poll(() => readWorld(page, (__world) => __world.scene.textSize))
    .toBe(size);
  await clickUi(page, "btn:back");
  await page.keyboard.press("Escape");
}
test("three quick messages show three stacked bubbles on the host and a nearby guest", async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    await openWorld(host, "/?harness=1");
    await ready(host);
    const session = await readWorld(host, (__world) => __world.scene.sessionId);
    await openWorld(guest, `/join/${session}?harness=1`);
    await ready(guest);
    await expect.poll(() =>
      readWorld(guest, (__world) => __world.scene.localId)
    ).toMatch(/^peer-/);
    await say(host, messages);
    // The host speaks one message at a time, so the three bubbles stack up as
    // each starts (ADR 0006).
    await expect.poll(() =>
      readWorld(
        guest,
        (__world) =>
          __world.scene.chatFeed.find((record) => record.id === "self")?.bubbles
            ?.map((bubble) => bubble.text),
      )
    ).toEqual(messages);
    await say(host, ["a fourth message"]);
    await expect.poll(() =>
      readWorld(
        guest,
        (__world) =>
          __world.scene.chatFeed.find((record) => record.id === "self")?.bubbles
            ?.map((bubble) => bubble.text),
      )
    ).toEqual([...messages.slice(1), "a fourth message"]);
    await evidenceShot(host, "stacked-bubbles-host");
    await evidenceShot(guest, "stacked-bubbles-guest");
  } finally {
    await Promise.all([host.close(), guest.close()]);
  }
});
test("text size changes bubble size and persists across reloads", async ({ page }) => {
  await openWorld(page, "/?harness=1");
  await ready(page);
  expect(await readWorld(page, (__world) => __world.scene.textSize)).toBe(
    "medium",
  );
  for (const size of ["small", "medium", "large"] as const) {
    await chooseTextSize(page, size);
    await say(page, messages);
    // Each message starts when the last is spoken, so wait for the third.
    await expect.poll(() => ownBubbles(page))
      .toEqual(messages);
    await evidenceShot(page, `stacked-bubbles-${size}`);
    // Let the bubbles expire before the next size.
    await expect.poll(() => ownBubbles(page)).toEqual([]);
  }
  await page.reload();
  await ready(page);
  expect(await readWorld(page, (__world) => __world.scene.textSize)).toBe(
    "large",
  );
});
